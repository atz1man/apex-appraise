import { describe, expect, it } from 'vitest';
import { PACK_LAYOUT, firstPageRows, laterPageRows, paginatePositions } from './pack-pagination';

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
      for (const p of pages.slice(1, -1)) expect(p.length).toBe(laterPageRows());
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
