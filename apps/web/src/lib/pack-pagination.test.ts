import { describe, expect, it } from 'vitest';
import { PACK_LAYOUT, firstPageRows, laterPageRows, paginatePack, paginatePositions } from './pack-pagination';

/**
 * The funding pack's first sheet budgets for its exceptions. It did not:
 * twelve breach lines put 220px of the pack off the bottom of an A4 page.
 */
const book = (n: number) => Array.from({ length: n }, (_, i) => `Scheme ${i + 1}`);

describe('rows on page one', () => {
  it('is the old constant budget when the Exceptions box has its one line', () => {
    const { pageContentPx, summaryPx, tableHeadPx, totalPx, rowPx } = PACK_LAYOUT;
    expect(firstPageRows(0)).toBe(Math.floor((pageContentPx - summaryPx - tableHeadPx - totalPx) / rowPx));
    // one exception replaces the "no breaches" line rather than adding to it
    expect(firstPageRows(1)).toBe(firstPageRows(0));
  });

  it('fits the sheet with its exceptions, and one more row would not', () => {
    const { pageContentPx, summaryPx, tableHeadPx, totalPx, rowPx, exceptionLinePx } = PACK_LAYOUT;
    for (const lines of [0, 1, 2, 5, 12, 20]) {
      const rows = firstPageRows(lines);
      const used = summaryPx + Math.max(0, lines - 1) * exceptionLinePx + tableHeadPx + totalPx + rows * rowPx;
      expect(used, `${lines} exception lines: page one overflows`).toBeLessThanOrEqual(pageContentPx);
      // the boundary: the budget is not merely safe, it is tight
      if (rows > 0) expect(used + rowPx).toBeGreaterThan(pageContentPx);
    }
    // the measured case, twelve lines, costs rows — it used to cost none
    expect(firstPageRows(12)).toBeLessThan(firstPageRows(0));
  });

  it('carries no rows at all once the exceptions fill the sheet, rather than a negative count', () => {
    expect(firstPageRows(60)).toBe(0);
    const pages = paginatePositions(book(5), 60);
    expect(pages[0]).toEqual([]);
    expect(pages.slice(1).flat()).toEqual(book(5));
  });
});

describe('the sheet that closes the book', () => {
  const { pageContentPx, summaryPx, tableHeadPx, totalPx, rowPx, notePx } = PACK_LAYOUT;
  const fitsAsLast = (rows: number, first: boolean) =>
    (first ? summaryPx : 0) + tableHeadPx + totalPx + notePx + rows * rowPx <= pageContentPx;

  it('has room for the totals and the closing note, so a full sheet is never also the last', () => {
    // thirteen rows fill a first sheet; with the note beside them it overran by 31px
    const full = firstPageRows(0);
    expect(fitsAsLast(full, true)).toBe(false);
    const pages = paginatePositions(book(full), 0);
    expect(pages).toHaveLength(2);
    expect(fitsAsLast(pages[1]!.length, false)).toBe(true);
  });

  it('keeps a book that fits beside the note on one sheet', () => {
    const n = firstPageRows(0, PACK_LAYOUT, true);
    expect(fitsAsLast(n, true)).toBe(true);
    expect(paginatePositions(book(n), 0)).toHaveLength(1);
    expect(paginatePositions(book(n + 1), 0)).toHaveLength(2);
  });

  it('applies the same rule to a later sheet', () => {
    const first = firstPageRows(0);
    const later = laterPageRows();
    // a second sheet exactly full cannot also close the book
    const pages = paginatePositions(book(first + later), 0);
    expect(pages).toHaveLength(3);
    expect(fitsAsLast(pages[2]!.length, false)).toBe(true);
    // but one that fits beside the note does
    expect(paginatePositions(book(first + laterPageRows(PACK_LAYOUT, true)), 0)).toHaveLength(2);
  });
});

describe('height the arithmetic did not know about', () => {
  it('comes off every sheet, and the split still loses nothing', () => {
    const { rowPx } = PACK_LAYOUT;
    // a dagger footnote's worth
    expect(firstPageRows(0, PACK_LAYOUT, false, rowPx)).toBe(firstPageRows(0) - 1);
    expect(laterPageRows(PACK_LAYOUT, false, rowPx)).toBe(laterPageRows() - 1);
    const pages = paginatePositions(book(60), 0, PACK_LAYOUT, 3 * rowPx);
    expect(pages.flat()).toEqual(book(60));
    expect(pages[0]!.length).toBe(firstPageRows(0) - 3);
  });

  it('cannot squeeze a later sheet below one row, so a large reserve still terminates', () => {
    const pages = paginatePositions(book(7), 0, PACK_LAYOUT, 10_000);
    expect(pages.flat()).toEqual(book(7));
    // page one may carry none — its summary alone can fill a sheet — but every sheet after it carries a row
    expect(pages.slice(1).every((p) => p.length >= 1)).toBe(true);
  });
});

describe('the split', () => {
  it('loses nothing and repeats nothing, whatever the exceptions', () => {
    for (const lines of [0, 1, 4, 12, 30]) {
      const pages = paginatePositions(book(152), lines);
      expect(pages.flat()).toEqual(book(152));
      expect(pages[0]!.length).toBe(firstPageRows(lines));
      // once the exceptions have ended, every full sheet holds the same count;
      // the sheet the exceptions END on holds fewer, because it carries them too
      const firstLines = 1 + Math.floor((PACK_LAYOUT.pageContentPx - PACK_LAYOUT.summaryPx) / PACK_LAYOUT.exceptionLinePx);
      const spill = lines > firstLines ? 1 : 0;
      for (const p of pages.slice(1 + spill, -1)) expect(p.length).toBe(laterPageRows());
    }
  });

  it('is one empty page for an empty book', () => {
    expect(paginatePositions([], 0)).toEqual([[]]);
    expect(paginatePositions([], 12)).toEqual([[]]);
  });

  it('later pages are unaffected by page one’s exceptions', () => {
    expect(paginatePositions(book(100), 12).slice(1, -1).every((p) => p.length === laterPageRows())).toBe(true);
  });
});

/**
 * The Exceptions box paginates. It lived on page one only, and once its lines
 * alone filled the sheet page one carried no rows — but the lines still had
 * to fit, and nothing checked that they did. Measured on a forty-scheme book
 * under a 20% loan-to-GDV limit: 43 breach lines, page one 1,424px against
 * an A4 sheet of 1,122.
 */
describe('the exceptions, across sheets', () => {
  const L = PACK_LAYOUT;
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `breach ${i + 1}`);
  const firstLines = 1 + Math.floor((L.pageContentPx - L.summaryPx) / L.exceptionLinePx);
  const laterLines = Math.floor((L.pageContentPx - L.exceptionBoxPx) / L.exceptionLinePx);

  /** the height a sheet's contents come to, by the same budget the layout uses */
  const heightOf = (s: { exceptions: unknown[]; rows: unknown[]; continued: boolean }, first: boolean, last: boolean) =>
    (first ? L.summaryPx + Math.max(0, s.exceptions.length - 1) * L.exceptionLinePx : 0) +
    (s.continued ? L.exceptionBoxPx + s.exceptions.length * L.exceptionLinePx : 0) +
    (s.rows.length > 0 || last ? L.tableHeadPx + L.totalPx + s.rows.length * L.rowPx : 0) +
    (last ? L.notePx : 0);

  it('spills the measured case onto a second sheet instead of off the first', () => {
    const sheets = paginatePack(book(43), lines(43));
    expect(sheets[0]!.exceptions).toHaveLength(firstLines);
    expect(sheets[0]!.rows).toEqual([]);
    expect(sheets[1]!.continued).toBe(true);
    expect(sheets[1]!.exceptions).toHaveLength(43 - firstLines);
    // and the table begins on the sheet the exceptions end on
    expect(sheets[1]!.rows.length).toBeGreaterThan(0);
  });

  it('fits every sheet, loses nothing and repeats nothing, at every size', () => {
    for (const n of [0, 1, 26, 27, 28, 43, 80, 200]) {
      for (const rows of [0, 1, 5, 40, 152]) {
        const sheets = paginatePack(book(rows), lines(n));
        expect(sheets.flatMap((s) => s.exceptions), `${n} lines, ${rows} rows: exceptions`).toEqual(lines(n));
        expect(sheets.flatMap((s) => s.rows), `${n} lines, ${rows} rows: rows`).toEqual(book(rows));
        sheets.forEach((s, i) => {
          expect(heightOf(s, i === 0, i === sheets.length - 1), `${n} lines, ${rows} rows: sheet ${i + 1} overflows`).toBeLessThanOrEqual(L.pageContentPx);
          // a sheet never carries rows above the end of the exceptions
          if (s.rows.length > 0) expect(sheets.slice(i + 1).every((t) => t.exceptions.length === 0)).toBe(true);
        });
        // a continued box is never on page one, and never empty
        expect(sheets[0]!.continued).toBe(false);
        expect(sheets.slice(1).every((s) => s.continued === s.exceptions.length > 0)).toBe(true);
      }
    }
  });

  it('is tight at the boundary: one more line on page one would not fit', () => {
    const { summaryPx, exceptionLinePx, pageContentPx } = L;
    expect(summaryPx + (firstLines - 1) * exceptionLinePx).toBeLessThanOrEqual(pageContentPx);
    expect(summaryPx + firstLines * exceptionLinePx).toBeGreaterThan(pageContentPx);
    const sheets = paginatePack(book(1), lines(firstLines + 1));
    expect(sheets[1]!.exceptions).toHaveLength(1);
  });

  it('fills a later sheet with lines before it starts another', () => {
    const sheets = paginatePack([], lines(firstLines + laterLines + 1));
    expect(sheets.map((s) => s.exceptions.length)).toEqual([firstLines, laterLines, 1]);
  });

  it('terminates under a reserve larger than the sheet', () => {
    const sheets = paginatePack(book(9), lines(9), L, L.pageContentPx + 100);
    expect(sheets.flatMap((s) => s.rows)).toEqual(book(9));
    expect(sheets.flatMap((s) => s.exceptions)).toEqual(lines(9));
  });

  it('is what paginatePositions has always answered when the lines fit page one', () => {
    for (const n of [0, 1, 12]) {
      expect(paginatePack(book(30), lines(n)).map((s) => s.rows)).toEqual(paginatePositions(book(30), n));
    }
  });
});
