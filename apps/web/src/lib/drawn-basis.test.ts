import { describe, expect, it } from 'vitest';
import { drawnAgainstWorksLabel, drawnBasis } from './drawn-basis';

/**
 * `cash.ts` says why `drawnSource` exists: "The funding pack says which,
 * because a figure derived from invoices and one taken from a bank statement
 * do not deserve the same confidence."
 *
 * The pack did not say which. It printed one unconditional sentence — "drawn is
 * committed spend from cost monitoring" — over every book, and `drawnSource`
 * was computed, carried through `deals.exposure`, declared on
 * `ExposurePosition`, and read by nothing.
 */

const bank = { drawnSource: 'bank' as const };
const proxy = { drawnSource: 'committed' as const };

describe('what the pack says about where Drawn came from', () => {
  it('does not disclaim figures it took from a bank statement', () => {
    const b = drawnBasis([bank, bank, bank]);
    expect(b.kind).toBe('bank');
    expect(b.sentence, 'a bank-sourced book was described as committed spend').not.toMatch(/committed spend/);
    expect(b.sentence).toMatch(/bank statements/i);
    // nothing to mark: the sentence has already said it of every row
    expect(b.markRows).toBe(false);
  });

  it('still says so plainly when nothing is bank-sourced', () => {
    const b = drawnBasis([proxy, proxy]);
    expect(b.kind).toBe('committed');
    expect(b.sentence).toMatch(/committed spend from cost monitoring/);
    expect(b.markRows).toBe(false);
  });

  /**
   * The case the old sentence was worst on, and the reason a row marker exists
   * rather than a better sentence alone: on a mixed book, one sentence cannot
   * be true of every row, so the rows it is not true of have to be findable.
   */
  it('names the split on a mixed book and marks the rows', () => {
    const b = drawnBasis([bank, proxy, proxy, bank, proxy]);
    expect(b.kind).toBe('mixed');
    expect(b.bank).toBe(2);
    expect(b.committed).toBe(3);
    expect(b.sentence, 'the reader is not told how the book splits').toContain('2 of 5');
    expect(b.sentence).toContain('remaining 3');
    expect(b.markRows, 'a mixed book left the reader no way to tell the rows apart').toBe(true);
  });

  /**
   * Both boundaries, because "some" is decided by two counts reaching zero and
   * an off-by-one at either end reports a mixed book as a pure one — which is
   * the original defect, restored on a narrower set of books.
   */
  it('does not call a book pure when a single row differs', () => {
    expect(drawnBasis([bank, bank, proxy]).kind, 'one proxy row among banks').toBe('mixed');
    expect(drawnBasis([proxy, proxy, bank]).kind, 'one bank row among proxies').toBe('mixed');
    expect(drawnBasis([bank]).kind).toBe('bank');
    expect(drawnBasis([proxy]).kind).toBe('committed');
  });

  /**
   * `drawnSource` is optional on `ExposurePosition`. An absent provenance must
   * read as the weaker one: a pack may understate its evidence, never claim
   * bank confirmation it cannot show.
   */
  it('treats a position with no stated source as the proxy, not as bank', () => {
    const b = drawnBasis([{}, {}]);
    expect(b.bank).toBe(0);
    expect(b.kind, 'a missing provenance was read as bank evidence').toBe('committed');
  });

  it('says nothing rather than a stray sentence over an empty book', () => {
    const b = drawnBasis([]);
    expect(b.kind).toBe('none');
    expect(b.sentence).toBeNull();
    expect(b.markRows).toBe(false);
  });
});

/**
 * The exceptions line read "£X committed against £Y of works" for every scheme.
 * On a bank-fed one the verdict was reached from money PAID out of the account
 * (`deals.exposure` passes `cash.paid` as `actualToDate`), so the word was
 * wrong — and the number printed beside it was `drawn`, the classified drawdown
 * credits, a third quantity again.
 */
describe('what the exceptions line calls the figure it compared', () => {
  it('says paid where the verdict came from the bank, committed where it did not', () => {
    expect(drawnAgainstWorksLabel('bank')).toBe('paid');
    expect(drawnAgainstWorksLabel('committed')).toBe('committed');
    expect(drawnAgainstWorksLabel(undefined), 'an unstated source claimed bank evidence').toBe('committed');
  });
});
