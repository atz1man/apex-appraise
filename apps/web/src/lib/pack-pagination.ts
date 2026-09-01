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
  /**
   * The chrome of an Exceptions box carried onto a later sheet — its margin,
   * border, padding and "Exceptions (continued)" heading — before the first
   * line in it. Measured at 52px, budgeted at 56.
   */
  exceptionBoxPx: number;
}

export const PACK_LAYOUT: PackLayout = {
  pageContentPx: 924,
  rowPx: 32,
  tableHeadPx: 34,
  totalPx: 36,
  summaryPx: 420,
  exceptionLinePx: 19,
  notePx: 44,
  exceptionBoxPx: 56,
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
  return paginatePack(positions, Array.from({ length: exceptionLines }, (_, i) => i), L, reservePx).map((s) => s.rows);
}

/** One A4 sheet of the pack: the exception lines it carries, then the position rows. */
export interface PackSheet<T, E> {
  exceptions: E[];
  /** a later sheet's box is headed "Exceptions (continued)" */
  continued: boolean;
  rows: T[];
}

/**
 * The pack, split into sheets — exceptions first, then the positions.
 *
 * The Exceptions box lived on page one and only page one, and grew with the
 * book: one line per covenant breach, one per overspending scheme. Page one's
 * row budget shrank to make room, and once the lines alone filled the sheet
 * it carried no rows at all — but the LINES still had to fit, and nothing
 * checked that they did. Measured with a forty-scheme book under a 20%
 * loan-to-GDV limit: 43 breach lines, page one 1,424px against 1,122 — 300px
 * of the exceptions a lender reads the pack for, printed off the bottom of
 * the first sheet. The post-render reserve could not help: it reclaims rows,
 * and there were none left to reclaim.
 *
 * So the box paginates like the table does. Page one carries the summary and
 * as many lines as fit beside it; each later sheet carries a continued box of
 * as many as fit; and the table starts on the sheet the exceptions end on if
 * there is room for its head, a row and the totals, else on the next. A sheet
 * that is not the last always makes progress — a line or a row — so a book
 * of any size terminates; the reserve then trims whatever the arithmetic
 * still misses.
 */
export function paginatePack<T, E>(positions: T[], exceptions: E[], L: PackLayout = PACK_LAYOUT, reservePx = 0): PackSheet<T, E>[] {
  const budget = L.pageContentPx - reservePx;
  // rows that fit in `avail` beside the table head, the totals and, on the closing sheet, the note
  const rowsIn = (avail: number, last: boolean) => Math.floor((avail - L.tableHeadPx - L.totalPx - (last ? L.notePx : 0)) / L.rowPx);
  const sheets: PackSheet<T, E>[] = [];
  let ei = 0;
  let pi = 0;
  for (;;) {
    const first = sheets.length === 0;
    let avail = budget - (first ? L.summaryPx : 0);
    let ex: E[] = [];
    if (ei < exceptions.length) {
      // the summary budget already holds the box and its first line; a later sheet's box is its own chrome
      if (!first) avail -= L.exceptionBoxPx;
      const cap = first ? 1 + Math.floor(avail / L.exceptionLinePx) : Math.max(1, Math.floor(avail / L.exceptionLinePx));
      const take = Math.min(Math.max(1, cap), exceptions.length - ei);
      ex = exceptions.slice(ei, ei + take);
      ei += take;
      avail -= (first ? Math.max(0, take - 1) : take) * L.exceptionLinePx;
    }
    let rows: T[] = [];
    let closes = false;
    if (ei >= exceptions.length) {
      const remaining = positions.length - pi;
      // a later sheet with nothing else on it always takes a row, or a huge reserve would never terminate
      const floor = !first && ex.length === 0 ? 1 : 0;
      // the closing sheet must also hold the table's chrome and the note, even over no rows: a first
      // sheet the exceptions have filled cannot be the last, however few positions there are
      closes = remaining <= (floor ? Math.max(floor, rowsIn(avail, true)) : rowsIn(avail, true));
      if (closes) {
        rows = positions.slice(pi);
      } else {
        // a sheet that is not the last leaves at least one row for the sheet that is
        rows = positions.slice(pi, pi + Math.max(0, Math.min(Math.max(floor, rowsIn(avail, false)), remaining - 1)));
      }
      pi += rows.length;
    }
    sheets.push({ exceptions: ex, continued: !first && ex.length > 0, rows });
    // the book is done only when a sheet CLOSED it — held the totals and the note as
    // well as whatever was left; a first sheet the exceptions filled to the edge has
    // placed everything and still needs a sheet after it for the close
    if (closes) return sheets;
  }
}
