import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Always load the .env at the project root, whatever folder the process was started from.
// override: true so the file wins over a stale GEMINI_* variable set elsewhere on the machine.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'), override: true });