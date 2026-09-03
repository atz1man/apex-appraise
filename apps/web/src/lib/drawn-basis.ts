/**
 * Where the "Drawn" column in a funding pack actually came from.
 *
 * `cash.ts` computes `drawnSource` for every position and says, in as many
 * words, why: "The funding pack says which, because a figure derived from
 * invoices and one taken from a bank statement do not deserve the same
 * confidence." The pack did not say which. `drawnSource` was computed in the
 * engine, carried through `deals.exposure`, declared on `ExposurePosition` —
 * and read by nothing.
 *
 * What the pack printed instead was one unconditional sentence: "drawn is
 * committed spend from cost monitoring." So a firm that had connected its bank
 * feed — which is the entire point of the open-banking integration — sent its
 * lender a document disclaiming figures it had actually taken from statements,
 * and a firm with feeds on some schemes and not others sent a document that was
 * wrong about half its own rows with no way to tell them apart.
 *
 * Understating your own evidence is the safe direction of the two, and the
 * mixed book is not: there the sentence is false about every bank-sourced row,
 * and a lender reading "committed spend" against a scheme whose figure came
 * from a statement is being told the pack is weaker than it is on one row and,
 * with no marker anywhere, has no way to find the rows where it is right.
 *
 * Kept out of the component because the interesting part is a three-way
 * classification with boundaries — none, some, all — and a component that
 * renders an A4 page is not where a boundary can be tested.
 */

export type DrawnSource = 'bank' | 'committed';

export interface DrawnBasis {
  /** how many positions took their drawn figure from a bank statement */
  bank: number;
  /** how many fell back to committed spend from cost monitoring */
  committed: number;
  /** 'none' when the pack has no positions at all — there is nothing to describe */
  kind: 'none' | 'bank' | 'committed' | 'mixed';
  /**
   * The sentence the pack prints about its own provenance, or null when there
   * is nothing to say. Null rather than an empty string so a caller cannot
   * render a stray full stop.
   */
  sentence: string | null;
  /**
   * Whether individual rows need marking. Only on a mixed book: where every row
   * shares one basis the sentence has already said so, and marking all of them
   * is noise on a document that is read once.
   */
  markRows: boolean;
}

export function drawnBasis(positions: Array<{ drawnSource?: DrawnSource }>): DrawnBasis {
  const bank = positions.filter((p) => p.drawnSource === 'bank').length;
  /**
   * Anything that is not explicitly 'bank' counts as the proxy, including a
   * position whose source is missing. `drawnSource` is optional on
   * `ExposurePosition`, and the safe reading of an absent provenance is the
   * weaker one — a pack must never claim bank evidence it cannot show.
   */
  const committed = positions.length - bank;

  if (positions.length === 0) return { bank, committed, kind: 'none', sentence: null, markRows: false };

  if (committed === 0) {
    return {
      bank,
      committed,
      kind: 'bank',
      sentence: 'Drawn is taken from each scheme’s bank statements, counting only credits classified as facility drawdowns.',
      markRows: false,
    };
  }
  if (bank === 0) {
    return {
      bank,
      committed,
      kind: 'committed',
      sentence:
        'Drawn is committed spend from cost monitoring, not advances confirmed by a bank statement — no scheme in this pack has a mapped account.',
      markRows: false,
    };
  }
  return {
    bank,
    committed,
    kind: 'mixed',
    sentence: `Drawn is taken from bank statements on ${bank} of ${positions.length} schemes; on the remaining ${committed} it is committed spend from cost monitoring, marked † in the table.`,
    markRows: true,
  };
}

/**
 * What the exceptions list should call the figure it compared against the works.
 *
 * The line read "£X committed against £Y of works" for every scheme. On a
 * bank-fed one that is wrong twice over: the drawdown verdict was reached from
 * money PAID out of the account (`deals.exposure` passes `cash.paid` as
 * `actualToDate`), while the number printed beside the word "committed" was
 * `drawn` — classified drawdown credits, a third figure again. One sentence,
 * three quantities, in the exceptions section of a lender pack.
 */
export const drawnAgainstWorksLabel = (source: DrawnSource | undefined): string =>
  source === 'bank' ? 'paid' : 'committed';
