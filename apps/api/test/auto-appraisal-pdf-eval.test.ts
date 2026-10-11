import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfCases, gradePdf, preparePdfFixture } from '../scripts/auto-appraisal-pdf-eval.js';
const correct = () => ({ cases: pdfCases.map(c => ({ id: c.id, asking: c.asking, s106: c.s106, units: c.units.map(u => ({ ...u, source: `${c.id}: page 2: current schedule` })) })) });
const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'apex-pdf-test-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
describe('multi-page PDF fixture', () => {
  it('replays the recorded model response against the exact PDF fixture', () => {
    const record = JSON.parse(readFileSync(new URL('./fixtures/auto-appraisal/pdf-run-2026-10-11.json', import.meta.url), 'utf8'));
    const bytes = readFileSync(new URL('./fixtures/auto-appraisal/revision-pack.pdf', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.pdf.sha256);
    expect(record.pdf.pages.map((p: { page: number }) => p.page)).toEqual([1, 2]);
    expect(gradePdf(record.response)).toEqual(record.cases);
    expect(record.cases.every((c: { passed: boolean }) => c.passed)).toBe(true);
  });
  it('accepts current values and page identity', () => expect(gradePdf(correct()).every(c => c.passed)).toBe(true));
  it.each(['page 1: current schedule', 'page 20: current schedule', 'page 2', 'page 2: ', 'page 2:   '])('rejects incorrect or incomplete locator %s', page => {
    const output = correct(); output.cases[0]!.units[0]!.source = `pdf-revision: ${page}`;
    expect(gradePdf(output)[0]!.passed).toBe(false);
  });
  it('rejects superseded values even with a current-page citation', () => {
    const output = correct(); output.cases[0]!.units[0]!.count = 6;
    expect(gradePdf(output)[0]!.passed).toBe(false);
  });
  it('rejects invented sales values from the later-page cost note', () => {
    const output = correct(); output.cases[1]!.units.push({ label: 'houses', count: 3, area: 1100, value: 220, source: 'pdf-missing-value: page 2: cost note' });
    expect(gradePdf(output)[1]!.passed).toBe(false);
  });
  it.each(['Pages: 1', 'Pages: 3', 'Pages: 20', 'not a PDF'])('refuses incomplete/unexpected PDF extent %s', info => {
    const commands: string[] = [];
    expect(() => preparePdfFixture(dir(), command => { commands.push(command); return info; })).toThrow(/two PDF/);
    expect(commands).toEqual(['pdfinfo']);
  });
  it('fails closed when Poppler is unavailable', () => expect(() => preparePdfFixture(dir(), () => { throw new Error('ENOENT'); })).toThrow(/No model request/));
  it('fails closed when rendering fails', () => expect(() => preparePdfFixture(dir(), command => { if (command === 'pdfinfo') return 'Pages: 2'; throw new Error('timeout'); })).toThrow(/No model request/));
  it('requires both rendered pages before returning model inputs', () => {
    const d = dir();
    expect(() => preparePdfFixture(d, () => 'Pages: 2')).toThrow();
  });
  it('returns numeric page order and hashes even if output creation is reversed', () => {
    const d = dir();
    const input = preparePdfFixture(d, command => {
      if (command === 'pdfinfo') return 'Pages: 2';
      for (const n of [2, 1]) writeFileSync(join(d, `page-${n}.png`), Buffer.from('89504e470d0a1a0a', 'hex'));
      return '';
    });
    expect(input.pages.map(p => p.page)).toEqual([1, 2]);
    expect(input.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
