import { GoogleGenAI } from '@google/genai';
import { ExtractionSchema, type Extraction } from '../../../shared/extraction';
import { EXTRACTION_PROMPT } from './prompt';

const SUPPORTED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Pull an HTTP-style status code out of whatever the SDK threw. */
export function errorCode(err: unknown): number | null {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const msg = String(e?.message ?? '');
  const m = msg.match(/"code"\s*:\s*(\d{3})/) ?? msg.match(/\b([45]\d\d)\b/);
  return m ? Number(m[1]) : null;
}

export const isRetryable = (err: unknown): boolean => {
  const c = errorCode(err);
  return c !== null && RETRYABLE.has(c);
};

/** Retry only for temporary failures (busy, rate limited). Waits longer each time. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = [2000, 5000, 12000],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || i >= delaysMs.length) throw err;
      await sleep(delaysMs[i]);
    }
  }
}

/** At most 2 model calls at once, so three uploads do not hammer a busy model. */
let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function friendlyError(fileName: string, err: unknown, models: string[]): string {
  const c = errorCode(err);
  if (c !== null && RETRYABLE.has(c)) return `${fileName}: Gemini is busy or rate limited right now (code ${c}), even after retrying. Wait a minute and upload again, or set another model in GEMINI_MODEL.`;
  if (c === 404) return `${fileName}: none of these models are available to your key: ${models.join(', ')}. Run npm run models and set GEMINI_MODEL to one from the list.`;
  if (c === 400 || c === 401 || c === 403) return `${fileName}: Gemini rejected the request (code ${c}). Check GEMINI_API_KEY, and that the file is a valid PDF or image.`;
  return `${fileName}: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/** Extract one uploaded file. Throws a readable Error on failure. */
export async function extractWithGemini(file: { name: string; mimeType: string; data: Buffer }): Promise<Extraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set. Add it to .env, or use the sample shipment.');
  if (!SUPPORTED.has(file.mimeType)) throw new Error(`${file.name}: ${file.mimeType} is not supported. Upload a PDF, PNG, JPEG or WebP.`);

  const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const models = [...new Set([primary, ...fallbacks])];
  const ai = new GoogleGenAI({ apiKey });

  const generate = async (extra: string): Promise<string> => {
    let lastErr: unknown;
    for (const model of models) {
      try {
        return await withRetry(async () => {
          const res = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType: file.mimeType, data: file.data.toString('base64') } }, { text: EXTRACTION_PROMPT + extra }] }],
            config: { responseMimeType: 'application/json', temperature: 0 },
          });
          return res.text ?? '';
        });
      } catch (err) {
        lastErr = err;
        const c = errorCode(err);
        if (c === 400 || c === 401 || c === 403) break; // another model will not fix a bad key or bad file
        // 404 (model not available) or busy after retries: try the next model, if any
      }
    }
    throw new Error(friendlyError(file.name, lastErr, models));
  };

  return limited(async () => {
    let raw = await generate('');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const parsed = JSON.parse(stripFences(raw));
        const result = ExtractionSchema.parse({ ...parsed, fileName: file.name });
        if (result.documentType === 'unknown' && !result.invoice && !result.packingList && !result.billOfLading) {
          result.extractionNotes.push('The model could not identify this document.');
        }
        return result;
      } catch (err) {
        if (attempt === 1) throw new Error(`${file.name}: the model returned something that could not be read (${(err as Error).message.slice(0, 120)}). Try again.`);
        raw = await generate('\n\nYour previous reply was not valid JSON for the schema. Reply with the JSON object only.');
      }
    }
    throw new Error('unreachable');
  });
}

