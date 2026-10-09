import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtractionSchema, type Extraction } from '../../../shared/extraction';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/sample-extractions.json');

/** Hand-transcribed extraction of the assignment's sample shipment. Used for the demo button and tests. */
export function loadSampleExtractions(): Extraction[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
  return raw.map((r) => ExtractionSchema.parse(r));
}
