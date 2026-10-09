import type { Extraction } from '../../shared/extraction';
import type { BrokerInputs, EntryResult } from '../../shared/result';

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export const getHealth = () => fetch('/api/health').then((r) => asJson<{ geminiConfigured: boolean; model: string }>(r));
export const getSample = () => fetch('/api/sample').then((r) => asJson<{ extractions: Extraction[] }>(r));

export function extractFiles(files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  return fetch('/api/extract', { method: 'POST', body: form }).then((r) => asJson<{ extractions: Extraction[]; errors: string[] }>(r));
}

export const buildEntry = (extractions: Extraction[], inputs: BrokerInputs) =>
  fetch('/api/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extractions, inputs }) }).then((r) => asJson<EntryResult>(r));
