import './env';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ExtractionSchema, type Extraction } from '../../shared/extraction';
import type { BrokerInputs } from '../../shared/result';
import { extractWithGemini } from './extraction/gemini';
import { loadSampleExtractions } from './extraction/fixtures';
import { buildEntry } from './domain/pipeline';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 8 } });

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
});

/** Step 1: read the documents. Slow (one model call per file); the UI caches the result. */
app.post('/api/extract', upload.array('files'), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: 'Upload at least one file.' });
  const settled = await Promise.allSettled(files.map((f) => extractWithGemini({ name: f.originalname, mimeType: f.mimetype, data: f.buffer })));
  const extractions: Extraction[] = [];
  const errors: string[] = [];
  settled.forEach((s, i) => (s.status === 'fulfilled' ? extractions.push(s.value) : errors.push(`${files[i].originalname}: ${(s.reason as Error).message}`)));
  if (!extractions.length) return res.status(502).json({ error: errors.join('\n') });
  res.json({ extractions, errors });
});

app.get('/api/sample', (_req, res) => res.json({ extractions: loadSampleExtractions() }));

/** Step 2: pure and fast. Called again whenever the user edits a field. */
const BuildBody = z.object({ extractions: z.array(ExtractionSchema), inputs: z.record(z.any()).default({}) });
app.post('/api/entry', async (req, res) => {
  const parsed = BuildBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad request body.' });
  res.json(await buildEntry(parsed.data.extractions, parsed.data.inputs as BrokerInputs));
});

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
