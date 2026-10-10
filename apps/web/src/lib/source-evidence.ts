/** Portable evidence text: never export expiring download credentials. */
export interface SourceEvidence {
  reviewerName: string; reviewedAt: string; inputsUnchanged: boolean; sample: boolean;
  documents: Array<{ id: string; name: string; status: string; addedAt: string; supersededById?: string | null }>;
  omissions: Array<{ name: string; reason: string }>;
  references?: Array<{ unitIndex: number; unitLabel: string; documentId: string; page: number | null; locator: string }>;
}
export function sourceEvidenceLines(review: SourceEvidence | null | undefined, state?: string, dirty = false): string[] {
  if (!review) return [state === 'unreadable' ? 'The stored source input review could not be read. Its status cannot be confirmed.' : 'No source input review is recorded for this version.'];
  const lines = [
    review.inputsUnchanged && !dirty ? 'Exported inputs match the recorded input review.' : 'INPUTS CHANGED: the recorded review does not cover these inputs.',
    `Reviewed by ${review.reviewerName} on ${new Date(review.reviewedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (London time).`,
    'Input acknowledgement only; not professional approval or independently verified evidence.',
    'Source identities are metadata snapshots. Page and sheet/cell references are user-entered and have not been independently verified.',
  ];
  if (review.sample) lines.push('WORKED EXAMPLE: these inputs were not extracted from project documents.');
  if (review.documents.some(d => d.status !== 'unchanged')) lines.push('SOURCE WARNING: a reviewed document is superseded, changed or missing.');
  lines.push('SOURCE REGISTER');
  if (!review.documents.length) lines.push('No uploaded source documents were recorded.');
  for (const d of review.documents) lines.push(`${d.name} | Document ID: ${d.id} | Uploaded: ${d.addedAt} | Status: ${d.status}${d.supersededById ? ` | Superseded by document ID: ${d.supersededById}` : ''}`);
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
export function sourceEvidencePages(lines: string[]): string[][] {
  let wrapped = wrapEvidence(lines);
  // Bound the shared PDF renderer, while making omitted print content explicit.
  // The workbook uses wrapEvidence directly and retains the complete record.
  const capacity = 12 * 42;
  if (wrapped.length > capacity) {
    const retained = capacity - 4;
    const omitted = wrapped.length - retained;
    wrapped = ['EVIDENCE PRINT LIMIT: full text is in the Excel Source evidence sheet.',
      ...wrapped.slice(0, retained), '', `${omitted} additional evidence lines are not printed in this PDF.`,
      'Read the complete Source evidence sheet in the Excel workbook.'];
  }
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += 42) pages.push(wrapped.slice(i, i + 42));
  return pages;
}
