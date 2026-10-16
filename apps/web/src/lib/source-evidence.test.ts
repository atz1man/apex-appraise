import { describe, expect, it } from 'vitest';
import { sourceEvidenceLines, sourceEvidencePages, wrapEvidence, type SourceEvidence } from './source-evidence';
const review: SourceEvidence = { reviewerName: 'Reviewer', reviewedAt: '2026-10-10T12:00:00Z', inputsUnchanged: true, sample: false,
  documents: [{ id: 'doc-1', name: 'Drawing revision B.pdf', status: 'superseded', addedAt: '2026-10-01T12:00:00Z' }],
  omissions: [{ name: 'Costs.xlsx', reason: 'Sheet 11 omitted' }],
  references: [{ unitIndex: 0, unitLabel: 'Apartments', documentId: 'doc-1', page: 2, locator: 'Drawing A102' }],
};
describe('portable source evidence', () => {
  it('compares saved values and withholds them for dirty or unverifiable exports', () => {
    const compared = { ...review, extractionComparison: [{ field: 'efficiency', label: 'NIA / GIA efficiency %', originalValue: 90, savedValue: 85, changed: true, originalOrigin: 'Worked example — not project evidence' }] };
    expect(sourceEvidenceLines(compared).join(' ')).toContain('original 90; saved 85 — Changed');
    expect(sourceEvidenceLines(compared).join(' ')).toContain('Unit schedules, build cost lines, CIL, S106');
    expect(sourceEvidenceLines(compared, 'recorded', true).join(' ')).toContain('Comparison withheld');
    expect(sourceEvidenceLines(compared, 'recorded', true).join(' ')).not.toContain('saved 85');
    expect(sourceEvidenceLines(compared, 'unverified').join(' ')).not.toContain('saved 85');
    expect(sourceEvidenceLines(review).join(' ')).not.toContain('ORIGINAL VERSUS SAVED');
  });
  it('exports reported origins without inferring missing history or hiding stale inputs', () => {
    expect(sourceEvidenceLines(review).join(' ')).toContain('Assumption origins were not recorded');
    const text = sourceEvidenceLines({ ...review, inputsUnchanged: false, assumptionOrigins: { efficiency: 'application-default', 'finance.rate': 'user-entered', asking: 'model-supplied' } }).join(' ');
    expect(text).toContain('INPUTS CHANGED');
    expect(text).toContain('NIA / GIA efficiency %: Application default');
    expect(text).toContain('Annual interest rate %: User-entered or corrected');
    expect(text).toContain('Asking land price £: Model-supplied — not verified');
    expect(text).toContain('CIL £ per sq m: Origin not recorded');
    expect(text).toContain('not independently verified source citations');
  });
  it('exports recorded upload fingerprints and explicitly marks legacy absence', () => {
    const hash = 'a'.repeat(64);
    const text = sourceEvidenceLines({ ...review, documents: [{ ...review.documents[0], sha256: hash }] }).join('\n');
    expect(text).toContain(`Upload SHA-256: ${hash}`);
    expect(text).toContain('stored bytes are not rechecked at export');
    expect(sourceEvidenceLines(review).join('\n')).toContain('Upload SHA-256: Not recorded');
  });
  it('carries warnings, source identities, page references and omissions without URLs', () => {
    const text = sourceEvidenceLines({ ...review, url: 'SECRET' } as SourceEvidence).join('\n');
    expect(text).toContain('SOURCE WARNING'); expect(text).toContain('PDF page 2');
    expect(text).toContain('Sheet 11 omitted'); expect(text).toContain('doc-1'); expect(text).not.toContain('SECRET');
  });
  it('refuses a matching-input claim for unsaved edits and retains worked-example labels', () => {
    const text = sourceEvidenceLines({ ...review, sample: true }, 'recorded', true).join('\n');
    expect(text).toContain('INPUTS CHANGED'); expect(text).toContain('WORKED EXAMPLE'); expect(text).not.toContain('Exported inputs match');
  });
  it('withholds cached claims when the editor snapshot cannot be verified', () => {
    const text = sourceEvidenceLines(review, 'unverified').join(' ');
    expect(text).toContain('SOURCE REVIEW UNVERIFIED');
    expect(text).not.toContain('Exported inputs match');
    expect(text).not.toContain('Reviewed by');
    expect(sourceEvidenceLines(null, 'unverified')[0]).not.toContain('No source input review');
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

  it('directs capped field evidence to the correct complete workbook sheet', () => {
    const pages = sourceEvidencePages(Array.from({ length: 1000 }, (_, i) => `Field note ${i}`), 'Field evidence');
    expect(pages).toHaveLength(12);
    expect(pages.flat()[0]).toContain('Excel Field evidence sheet');
    expect(pages.flat().at(-1)).toContain('complete Field evidence sheet');
    expect(pages.flat()).toContain('500 additional evidence lines are not printed in this PDF.');
    expect(pages.flat().join('')).not.toContain('Source evidence sheet');
  });

});

it('exports original receipt identity without claiming current input verification', () => {
  expect(sourceEvidenceLines(review).join(' ')).toContain('No server-issued extraction receipt');
  const text = sourceEvidenceLines({ ...review, inputsUnchanged: false, extractionReceipt: { id: 'receipt-1', createdAt: '2026-10-16T12:00:00Z', mode: 'worked-example', outputHash: 'a'.repeat(64) } }).join(' ');
  expect(text).toContain('Server-issued receipt: receipt-1');
  expect(text).toContain('Original extracted inputs SHA-256: ' + 'a'.repeat(64));
  expect(text).toContain('before user corrections');
  expect(text).toContain('INPUTS CHANGED');
});
