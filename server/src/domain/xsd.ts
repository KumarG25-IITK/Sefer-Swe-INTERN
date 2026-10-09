import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateXML } from 'xmllint-wasm';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schemas');
let cache: { entry: string; data: string } | null = null;

/** Validate against NetCHB's published entry.xsd (plus the data_type.xsd it imports). */
export async function validateAgainstXsd(xml: string): Promise<{ valid: boolean; errors: string[] }> {
  cache ??= { entry: readFileSync(path.join(dir, 'entry.xsd'), 'utf8'), data: readFileSync(path.join(dir, 'data_type.xsd'), 'utf8') };
  try {
    const res = await validateXML({
      xml: [{ fileName: 'entry.xml', contents: xml }],
      schema: [{ fileName: 'entry.xsd', contents: cache.entry }],
      preload: [{ fileName: 'data_type.xsd', contents: cache.data }],
    });
    return { valid: res.valid, errors: (res.errors ?? []).map((e) => e.message ?? e.rawMessage) };
  } catch (err) {
    return { valid: false, errors: [`Schema check could not run: ${(err as Error).message}`] };
  }
}
