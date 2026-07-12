import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dev convenience: load the repo-root .env (compose injects env in prod).
// Imported FIRST from main.ts so it runs before any module reads process.env.
// Never overrides variables already set in the environment.
for (const envPath of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  break;
}
