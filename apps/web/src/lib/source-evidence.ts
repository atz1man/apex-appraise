import { ASSUMPTION_FIELDS, ORIGIN_LABELS, type AssumptionField, type AssumptionOrigins } from '@apex/types/assumption-origins';
/** Portable evidence text: never export expiring download credentials. */
export interface SourceEvidence {
  assumptionOrigins?: AssumptionOrigins;
  originalExtractedUnits?: Array<{ label: string; count: number; area: number; value: number; conf: 'high' | 'med' | 'low'; source: string }>;
  extractionComparison?: Array<{ field: string; label: string; originalValue: number; savedValue: number; changed: boolean; originalOrigin: string }>;
  extractionReceipt?: { id: string; createdAt: string; mode: 'model' | 'worked-example'; outputHash: string };
  reviewerName: string; reviewedAt: string; inputsUnchanged: boolean; sample: boolean;
  documents: Array<{ id: string; name: string; status: string; addedAt: string; supersededById?: string | null; sha256?: string | null }>;
  omissions: Array<{ name: string; reason: string }>;
  references?: Array<{ unitIndex: number; unitLabel: string; documentId: string; page: number | null; locator: string }>;
}
export function sourceEvidenceLines(review: SourceEvidence | null | undefined, state?: string, dirty = false): string[] {
  if (state === 'unverified') return ['SOURCE REVIEW UNVERIFIED: matching source review data could not be confirmed for these exported inputs. Refresh the source review before relying on its status.'];
  if (!review) return [state === 'unreadable' ? 'The stored source input review could not be read. Its status cannot be confirmed.' : 'No source input review is recorded for this version.'];
  const lines = [
    review.inputsUnchanged && !dirty ? 'Exported inputs match the recorded input review.' : 'INPUTS CHANGED: the recorded review does not cover these inputs.',
    `Reviewed by ${review.reviewerName} on ${new Date(review.reviewedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (London time).`,
    'Input acknowledgement only; not professional approval or independently verified evidence.',
    'Source identities include upload-time SHA-256 fingerprints where recorded; stored bytes are not rechecked at export. Page and sheet/cell references are user-entered and have not been independently verified.',
  ];
  if (review.sample) lines.push('WORKED EXAMPLE: these inputs were not extracted from project documents.');
  if (review.documents.some(d => d.status !== 'unchanged')) lines.push('SOURCE WARNING: a reviewed document is superseded, changed or missing.');
  lines.push('ORIGINAL EXTRACTION RECEIPT');
  if (review.extractionReceipt) {
    const receipt = review.extractionReceipt;
    lines.push(`Server-issued receipt: ${receipt.id} | ${receipt.createdAt} | ${receipt.mode}`);
    lines.push(`Original extracted inputs SHA-256: ${receipt.outputHash}`);
    lines.push('Records the original server output before user corrections. It does not verify source accuracy, page citations or professional acceptance.');
  } else lines.push('No server-issued extraction receipt was recorded for this review.');
  if (review.extractionComparison) {
    lines.push('ORIGINAL VERSUS SAVED ASSUMPTIONS');
    lines.push('Compares original server output with the last saved inputs, not unsaved edits. Differences do not establish who changed a value or whether it is correct.');
    lines.push('Scope: directly mapped scheme assumptions only. Unit schedules, build cost lines, CIL, S106 and later-added inputs are not compared.');
    if (dirty) lines.push('Comparison withheld because this export includes unsaved edits. Save and refresh before comparing.');
    else for (const row of review.extractionComparison) lines.push(`${row.label}: original ${row.originalValue}; saved ${row.savedValue} — ${row.changed ? 'Changed' : 'Same'} | Original origin: ${row.originalOrigin}`);
  }
  lines.push('ORIGINAL EXTRACTED UNIT SCHEDULE');
  lines.push('Historical server output before corrections, not the current unit schedule. Row numbers refer only to this original extraction; no match to current units is inferred. Values, confidence and source text are not independently verified.');
  if (!review.originalExtractedUnits) lines.push('No original extracted unit schedule was recorded for this review.');
  else if (!review.originalExtractedUnits.length) lines.push('The original extraction contained no unit rows.');
  else review.originalExtractedUnits.forEach((unit, index) => {
    lines.push(`Original row ${index + 1}: ${unit.label} | Count: ${unit.count} | Area per unit (sq ft): ${unit.area} | Sales value (£ per sq ft): ${unit.value}`);
    lines.push(`Original confidence label: ${unit.conf} | Original source text (unverified): ${unit.source}`);
  });
  lines.push('ASSUMPTION ORIGINS AT REVIEW');
  lines.push('Origin labels were submitted with the input acknowledgement; they are not independently verified source citations. Changed inputs are not covered by this historical record.');
  if (!review.assumptionOrigins) lines.push('Assumption origins were not recorded for this review.');
  else for (const key of Object.keys(ASSUMPTION_FIELDS) as AssumptionField[]) lines.push(`${ASSUMPTION_FIELDS[key]}: ${ORIGIN_LABELS[review.assumptionOrigins[key] ?? 'unknown']}`);
  lines.push('SOURCE REGISTER');
  if (!review.documents.length) lines.push('No uploaded source documents were recorded.');
  for (const d of review.documents) lines.push(`${d.name} | Document ID: ${d.id} | Uploaded: ${d.addedAt} | Status: ${d.status}${d.supersededById ? ` | Superseded by document ID: ${d.supersededById}` : ''} | Upload SHA-256: ${d.sha256 ?? 'Not recorded'}`);
  lines.push('INPUT REFERENCES');
  if (!review.references?.length) lines.push('No structured page or sheet/cell references were recorded.');
  for (const ref of review.references ?? []) {
    const doc = review.documents.find(d => d.id === ref.documentId);
    lines.push(`Unit ${ref.unitIndex + 1}: ${ref.unitLabel} | ${doc?.name ?? 'Source unavailable'} | Document ID: ${ref.documentId} | Status: ${doc?.status ?? 'unavailable'} | ${ref.page !== null ? `PDF page ${ref.page}` : ''}${ref.locator ? ` | ${ref.locator}` : ''}`);
  }
  lines.push('REPORTED OMISSIONS');
  if (!review.omissions.length) lines.push('No omissions were reported with the acknowledgement. This is not a completeness certification.');
  for (const omission of review.omissions) lines.push(`${omission.name}: ${omission.reason}`);
  return lines;
}
/** Bound printed line width without truncating evidence, including long filenames. */
export function wrapEvidence(lines: string[], width = 90): string[] {
  return lines.flatMap(line => {
    const chars = Array.from(line.replace(/\r\n?/g, '\n'));
    const result: string[] = [];
    let current = '';
    for (const char of chars) {
      if (char === '\n') { result.push(current); current = ''; continue; }
      const weight = (value: string) => Array.from(value).reduce((sum, glyph) => sum + ((glyph.codePointAt(0) ?? 0) > 255 ? 2 : 1), 0);
      if (current && weight(current) + weight(char) > width) {
        const glyphs = Array.from(current);
        const space = glyphs.lastIndexOf(' ');
        const split = space >= glyphs.length / 2 ? space + 1 : glyphs.length;
        result.push(glyphs.slice(0, split).join(''));
        current = glyphs.slice(split).join('');
      }
      current += char;
    }
    result.push(current);
    return result;
  });
}
export function sourceEvidencePages(lines: string[], sheetName: 'Source evidence' | 'Field evidence' = 'Source evidence'): string[][] {
  let wrapped = wrapEvidence(lines);
  // Bound the shared PDF renderer, while making omitted print content explicit.
  // The workbook uses wrapEvidence directly and retains the complete record.
  const capacity = 12 * 42;
  if (wrapped.length > capacity) {
    const retained = capacity - 4;
    const omitted = wrapped.length - retained;
    wrapped = [`EVIDENCE PRINT LIMIT: full text is in the Excel ${sheetName} sheet.`,
      ...wrapped.slice(0, retained), '', `${omitted} additional evidence lines are not printed in this PDF.`,
      `Read the complete ${sheetName} sheet in the Excel workbook.`];
  }
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += 42) pages.push(wrapped.slice(i, i + 42));
  return pages;
}
