import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { drawingCases } from '../scripts/auto-appraisal-drawing-eval.js';
import { grade } from '../scripts/auto-appraisal-eval.js';
const correct = () => ({ cases: drawingCases.map(c => ({ id: c.id, asking: c.asking, s106: c.s106, units: c.units.map(u => ({ ...u, source: `${c.id}: annotated schedule` })) })) });
describe('annotated drawing evaluation', () => {
  it('replays the real model response against the exact raster used for that run', () => {
    const record = JSON.parse(readFileSync(new URL('./fixtures/auto-appraisal/drawing-run-2026-10-11.json', import.meta.url), 'utf8'));
    const image = readFileSync(new URL('./fixtures/auto-appraisal/drawing-sheet.png', import.meta.url));
    expect(createHash('sha256').update(image).digest('hex')).toBe(record.imageSha256);
    expect(grade(record.response, drawingCases)).toEqual(record.cases);
    expect(record.cases.every((c: { passed: boolean }) => c.passed)).toBe(true);
  });
  it('accepts the visually checked sheet transcription', () => expect(grade(correct(), drawingCases).every(c => c.passed)).toBe(true));
  it('refuses the superseded schedule', () => {
    const output = correct(); output.cases[1]!.units[0]!.count = 8;
    expect(grade(output, drawingCases)[1]!.passed).toBe(false);
  });
  it('refuses build cost substituted for missing sales evidence', () => {
    const output = correct(); output.cases[2]!.units.push({ label: 'flats', count: 2, area: 680, value: 210, source: 'drawing-missing-value: cost' });
    expect(grade(output, drawingCases)[2]!.passed).toBe(false);
  });
  it('refuses site area or total area in place of the stated per-unit area', () => {
    const output = correct(); output.cases[0]!.units[0]!.area = 1450;
    expect(grade(output, drawingCases)[0]!.passed).toBe(false);
  });
  it('does not accept a text-suite answer for the drawing suite', () => expect(() => grade(correct())).toThrow());
});
