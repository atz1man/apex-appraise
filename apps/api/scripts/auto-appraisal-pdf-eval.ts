import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grade } from './auto-appraisal-eval.js';
export const pdfCases = [
  { id: 'pdf-revision', notes: 'Read this case across both attached PDF pages; reconcile the revisions.', units: [{ label: 'flats', count: 4, area: 775, value: 425 }], asking: 510000, s106: null },
  { id: 'pdf-missing-value', notes: 'Read this case across both attached PDF pages; do not confuse costs and sales values.', units: [], asking: null, s106: null },
];
export function gradePdf(raw: unknown) {
  const scores = grade(raw, pdfCases);
  if (!scores.find(c => c.id === 'pdf-revision')?.passed) return scores;
  const row = (raw as { cases: { id: string; units: { source: string }[] }[] }).cases.find(c => c.id === 'pdf-revision')!;
  // Exact page boundary: "page 20" must not satisfy "page 2".
  const currentPage = row.units.every(u => /^pdf-revision: page 2: \S/.test(u.source));
  return scores.map(c => c.id === 'pdf-revision' ? { ...c, passed: c.passed && currentPage } : c);
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Run = (command: string, args: string[]) => string;
const runBounded: Run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
/** Only the fixed synthetic two-page fixture is supported; not an upload parser. */
export function preparePdfFixture(dir: string, run: Run = runBounded) {
  const source = fileURLToPath(new URL('../test/fixtures/auto-appraisal/revision-pack.pdf', import.meta.url));
  const pdfSha256 = hash(readFileSync(source));
  let info: string;
  try { info = run('pdfinfo', [source]); }
  catch { throw new Error('PDF evaluation requires working Poppler pdfinfo and pdftoppm commands. No model request was made.'); }
  if (!/^Pages:\s+2\s*$/m.test(info)) throw new Error('Expected exactly two PDF fixture pages; refuse partial evaluation');
  try { run('pdftoppm', ['-r', '100', '-f', '1', '-l', '2', '-png', source, join(dir, 'page')]); }
  catch { throw new Error('PDF rasterisation failed or timed out. No model request was made.'); }
  const pages = [1, 2].map(page => {
    const path = join(dir, `page-${page}.png`);
    const bytes = readFileSync(path);
    if (bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid PDF page raster; refuse partial evaluation');
    return { page, path, sha256: hash(bytes) };
  });
  return { pdfSha256, pages };
}
