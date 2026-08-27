/**
 * The figures a Red Book report reports, as opposed to the figures the
 * appraisal computes.
 *
 * A development appraisal produces a GDV to the penny. A valuation certificate
 * reports a Market Value to the nearest £1,000, and an analysed rate over the
 * net internal area — and both of those are derived quantities with a house
 * rule behind them, which makes them money maths and puts them here.
 *
 * They were derived twice, in two packages, from two independent copies of the
 * same rounding rule: the certificate's own copy in `RedBookReport.tsx`, and
 * the API's copy in `draftNarrativeSections`, which feeds the narrative printed
 * ON THE SAME PAGE. The two agreed, so nothing was visibly wrong; the exposure
 * is that nothing made them agree.
 *
 * The sharp end is `narrative-guard.ts`. Its whole premise is "check the model
 * wrote the figures the engine produced" — but the engine never produced this
 * figure, so the API was checking the model against a number it had computed
 * itself. Had the two copies drifted, the guard would have certified the
 * narrative's Market Value as correct while the certificate above it printed a
 * different one, which is the exact failure the guard exists to prevent.
 *
 * Third time for this class: `c1631ab` (the scenario compare kept two copies of
 * itself) and `4ae2ba9` (retention worked out twice, neither copy in the
 * engine).
 */

/**
 * A reported valuation figure, to the nearest £1,000.
 *
 * The house rule behind every certified figure on a Red Book report: a valuer
 * does not certify to the penny. It had three private copies — `round1k` in
 * `RedBookReport.tsx`, another in `valuation-confidence.ts`, and an inline one
 * in the API's narrative drafter — which the sweep in `one-engine-sweep.test.ts`
 * found once this file existed to point them at.
 */
export function toNearestThousand(pounds: number): number {
  return Math.round(pounds / 1000) * 1000;
}

/**
 * Market Value as this product reports it: the appraisal's GDV, to the nearest
 * £1,000. The rounding IS the reporting convention, so it belongs with the
 * figure rather than beside each place that prints it.
 */
export function reportedMarketValue(gdv: number): number {
  return toNearestThousand(gdv);
}

/**
 * The analysed rate a Market Value implies over a net internal area, £/ft².
 *
 * Zero for a scheme with no floor area rather than Infinity or NaN: a rate over
 * nothing is not a rate, and a non-finite number reaching a signed valuation is
 * what `7b9f2d5` exists to stop.
 */
export function analysedPsf(marketValue: number, netInternalArea: number): number {
  return netInternalArea > 0 ? Math.round(marketValue / netInternalArea) : 0;
}
