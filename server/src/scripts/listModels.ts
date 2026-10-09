import '../env';
import { GoogleGenAI } from '@google/genai';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Set GEMINI_API_KEY in .env first.'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: key });
const pager = await ai.models.list();
for await (const m of pager) {
  const actions = (m as { supportedActions?: string[] }).supportedActions ?? [];
  if (actions.includes('generateContent')) console.log(m.name?.replace('models/', ''));
}
console.log('\nPut one of these in GEMINI_MODEL (a "flash" model is usually the right cost/speed trade-off).');
