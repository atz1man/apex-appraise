import { describe, expect, it } from 'vitest';
import { sourceEvidenceLines, sourceEvidencePages, wrapEvidence, type SourceEvidence } from './source-evidence';
const review: SourceEvidence = { reviewerName: 'Reviewer', reviewedAt: '2026-10-10T12:00:00Z', inputsUnchanged: true, sample: false,
  documents: [{ id: 'doc-1', name: 'Drawing revision B.pdf', status: 'superseded', addedAt: '2026-10-01T12:00:00Z' }],
  omissions: [{ name: 'Costs.xlsx', reason: 'Sheet 11 omitted' }],
  references: [{ unitIndex: 0, unitLabel: 'Apartments', documentId: 'doc-1', page: 2, locator: 'Drawing A102' }],
};
describe('portable source evidence', () => {
  it('carries warnings, source identities, page references and omissions without URLs', () => {
    const text = sourceEvidenceLines({ ...review, url: 'SECRET' } as SourceEvidence).join('\n');
    expect(text).toContain('SOURCE WARNING'); expect(text).toContain('PDF page 2');
    expect(text).toContain('Sheet 11 omitted'); expect(text).toContain('doc-1'); expect(text).not.toContain('SECRET');
  });
  it('refuses a matching-input claim for unsaved edits and retains worked-example labels', () => {
    const text = sourceEvidenceLines({ ...review, sample: true }, 'recorded', true).join('\n');
    expect(text).toContain('INPUTS CHANGED'); expect(text).toContain('WORKED EXAMPLE'); expect(text).not.toContain('Exported inputs match');
  });
  it('distinguishes unreadable records from absent ones', () => {
    expect(sourceEvidenceLines(null, 'unreadable')[0]).toContain('could not be read');
    expect(sourceEvidenceLines(null, 'absent')[0]).toContain('No source input review');
  });
  it('paginates long multilingual evidence without dropping text or overflowing line budgets', () => {
    const text = 'Long drawing name 🏢界'.repeat(400);
    const wrapped = wrapEvidence([text]);
    expect(wrapped.join('')).toBe(text); expect(wrapped.every(s => Array.from(s).reduce((sum, c) => sum + ((c.codePointAt(0) ?? 0) > 255 ? 2 : 1), 0) <= 90)).toBe(true);
    const pages = sourceEvidencePages([text]); expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(p => p.length <= 42)).toBe(true); expect(pages.flat().join('')).toBe(text);
  });
  it('caps printed evidence explicitly while leaving the complete workbook text available', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `Evidence line ${i}`);
    const pages = sourceEvidencePages(lines);
    expect(pages).toHaveLength(12);
    expect(pages.flat()[0]).toContain('PRINT LIMIT');
    expect(pages.flat().at(-1)).toContain('complete Source evidence sheet');
    expect(pages.flat()).toContain('500 additional evidence lines are not printed in this PDF.');
    expect(wrapEvidence(lines)).toEqual(lines);
  });

});
