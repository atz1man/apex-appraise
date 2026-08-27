import { describe, expect, it } from 'vitest';
import { analysedPsf, reportedMarketValue, toNearestThousand } from '../src/index.js';

/**
 * Market Value and the analysed rate were derived twice, in two packages, from
 * two independent copies of the same rule — the certificate's copy in
 * `RedBookReport.tsx` and the API's in `draftNarrativeSections`, which feeds the
 * narrative printed on the same page as the certificate.
 *
 * They agreed, so nothing was visibly wrong. The exposure is that nothing made
 * them agree, and `narrative-guard.ts` — whose premise is that every figure in
 * a draft came from the engine — was checking the model against a number the
 * API had computed for itself.
 */
describe('the figures a certificate reports', () => {
  it('rounds the appraisal GDV to the nearest £1,000', () => {
    expect(reportedMarketValue(4_278_000)).toBe(4_278_000);
    expect(reportedMarketValue(4_278_499)).toBe(4_278_000);
    expect(reportedMarketValue(4_278_500)).toBe(4_279_000);
    expect(reportedMarketValue(0)).toBe(0);
  });

  it('does not move a figure that has already been reported', () => {
    /**
     * Two surfaces round in sequence — the narrative is drafted from a Market
     * Value and the certificate prints one — so rounding an already-reported
     * figure has to be a no-op, or the same valuation drifts by £1,000 for
     * every hop it takes.
     */
    for (const gdv of [4_278_000, 4_278_499, 4_278_500, 3_150_000, 999_501]) {
      const once = reportedMarketValue(gdv);
      expect(reportedMarketValue(once)).toBe(once);
    }
  });

  it('rounds any reported figure the same way, which is why it is one function', () => {
    /**
     * The comparable-derived value range on the same certificate is rounded by
     * this rule too. It had its own copy until `one-engine-sweep.test.ts` found
     * it, which is the whole argument for the sweep: the copies agreed, and
     * nothing made them.
     */
    expect(toNearestThousand(2_849_600)).toBe(2_850_000);
    expect(reportedMarketValue(4_278_499)).toBe(toNearestThousand(4_278_499));
    /**
     * Pinned because it is asymmetric and surprising: JavaScript rounds a tie
     * toward +∞, not away from zero, so −£1,500 reports as −£1,000 while
     * £1,500 reports as £2,000. Every figure this currently rounds is
     * non-negative; a negative residual reaching it would want a decision, and
     * this records which one is in force rather than leaving it to be
     * rediscovered.
     */
    expect(toNearestThousand(1_500)).toBe(2_000);
    expect(toNearestThousand(-1_500)).toBe(-1_000);
  });

  it('analyses the rate over the net internal area', () => {
    expect(analysedPsf(4_278_000, 10_000)).toBe(428);
    // rounded to the pound, like every rate this product prints
    expect(analysedPsf(4_278_499, 10_000)).toBe(428);
  });

  it('reports no rate at all for a scheme with no floor area', () => {
    // a rate over nothing is not a rate, and Infinity must never reach a report
    expect(analysedPsf(4_278_000, 0)).toBe(0);
    expect(Number.isFinite(analysedPsf(4_278_000, 0))).toBe(true);
  });
});
