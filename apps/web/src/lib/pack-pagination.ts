/**
 * How the funding pack's positions split across A4 sheets.
 *
 * Page one carries the summary and the Exceptions box, so it holds fewer rows
 * than the sheets after it. The budget for page one was a CONSTANT — 420px for
 * the summary blocks, which assumed the Exceptions box held its one line of
 * "No covenant breaches". Every breach and every overspend adds a line, and
 * none of them were budgeted for. Measured on the demo book with a 20% loan-
 * to-GDV limit: twelve exception lines, page one 1,342px tall against an A4
 * sheet of 1,123 — 220px of the pack printed off the bottom of the page, on
 * the sheet whose exceptions are the reason a lender reads it. Found by CI
 * rendering the pack while a neighbouring spec had produced exceptions; the
 * first firm with three overspending schemes would have found it in print.
 *
 * So the rows page one may hold are computed from the exception count, and
 * when the exceptions alone fill the sheet page one carries none — the table
 * starts on the next sheet, which is what a person laying it out would do.
 */
export interface PackLayout {
  /** printable height of an A4 sheet's content area */
  pageContentPx: number;
  rowPx: number;
  tableHeadPx: number;
  totalPx: number;
  /** the summary blocks on page one, INCLUDING an Exceptions box with one line in it */
  summaryPx: number;
  /** one further line in the Exceptions box — measured at 18.3px, budgeted at 19 */
  exceptionLinePx: number;
  /**
   * The closing "Prepared for information…" note, printed on the LAST sheet
   * only. It was budgeted nowhere: a book whose rows exactly filled a sheet
   * put the totals row and this note on the same sheet and overran it —
   * measured, thirteen schemes on one sheet came to 1,153px against 1,123.
   * Twelve fitted with no slack at all, so one exception line tipped it.
   */
  notePx: number;
}

export const PACK_LAYOUT: PackLayout = {
  pageContentPx: 924,
  rowPx: 32,
  tableHeadPx: 34,
  totalPx: 36,
  summaryPx: 420,
  exceptionLinePx: 19,
  notePx: 44,
};

/**
 * Rows page one can hold beside a summary and `exceptionLines` lines of
 * exceptions. `last` is whether this sheet also closes the book — the totals
 * row is budgeted on every sheet as slack, the closing note only where it prints.
 */
export function firstPageRows(exceptionLines: number, L: PackLayout = PACK_LAYOUT, last = false, reservePx = 0): number {
  // the box always has one line — "No covenant breaches…" or the first exception — and the summary budget already carries it
  const extra = Math.max(0, exceptionLines - 1) * L.exceptionLinePx;
  const note = last ? L.notePx : 0;
  return Math.max(0, Math.floor((L.pageContentPx - reservePx - L.summaryPx - extra - L.tableHeadPx - L.totalPx - note) / L.rowPx));
}

export function laterPageRows(L: PackLayout = PACK_LAYOUT, last = false, reservePx = 0): number {
  const note = last ? L.notePx : 0;
  return Math.max(1, Math.floor((L.pageContentPx - reservePx - L.tableHeadPx - L.totalPx - note) / L.rowPx));
}

/**
 * The positions, split into the rows each sheet carries. Always at least one
 * page, even for an empty book; every position appears exactly once; and the
 * sheet that closes the book has room for the totals and the closing note —
 * a page is the last one only if what remains fits beside them.
 */
/**
 * `reservePx` is height the arithmetic did not know about, taken off EVERY
 * sheet's budget. The pack measures its own sheets after render and, where one
 * overruns A4, asks for that many pixels back and lays out again — because
 * the sheet is a fixed box and the content is not: a long scheme name wraps,
 * a mixed book prints a dagger footnote, and each of those was once a
 * constant nobody had budgeted. The arithmetic gets close; the measurement
 * makes it true.
 */
export function paginatePositions<T>(positions: T[], exceptionLines: number, L: PackLayout = PACK_LAYOUT, reservePx = 0): T[][] {
  if (!positions.length) return [positions];
  if (positions.length <= firstPageRows(exceptionLines, L, true, reservePx)) return [positions];
  // a sheet that is not the last must leave at least one row for the sheet that is
  const out: T[][] = [positions.slice(0, Math.min(firstPageRows(exceptionLines, L, false, reservePx), positions.length - 1))];
  let i = out[0]!.length;
  while (i < positions.length) {
    const remaining = positions.length - i;
    const take = remaining <= laterPageRows(L, true, reservePx) ? remaining : Math.min(laterPageRows(L, false, reservePx), remaining - 1);
    out.push(positions.slice(i, i + take));
    i += take;
  }
  return out;
}
