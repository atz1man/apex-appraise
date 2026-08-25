/**
 * The capital stack — senior debt, mezzanine, equity and land.
 *
 * This lived in a `useMemo` on the appraisal page, under the comment "display
 * model per the prototype". Two consequences:
 *
 * Its inputs were component state. Changing the mezzanine rate did not mark the
 * appraisal dirty, so the Save button stayed disabled and the value was gone on
 * reload. `Appraisal.mezzToPct`, `mezzRatePct` and `drawFactorPct` had columns
 * — written by the seed, read by nothing.
 *
 * And it was money maths outside the engine, which this project does not do:
 * "One shared calculation engine for every surface (screen, export, report,
 * portal)." Nothing but that one panel could show a capital stack, and nothing
 * could test it.
 *
 * The arithmetic is unchanged from the panel. What is new is that it is here.
 */

export interface StackInputs {
  /** senior loan-to-cost, % */
  ltcPct: number;
  /** senior rate, % pa — for the blended figure */
  seniorRatePct: number;
  /** peak senior facility, £ (engine result) */
  facility: number;
  /** construction cost the facility is geared against, £ */
  constructionCost: number;
  /** land in the stack, £ (engine result) */
  landGross: number;
  /** months the debt is outstanding — build plus sales */
  months: number;
  mezz?: { toPct: number; ratePct: number; drawFactorPct: number };
}

export interface CapitalStack {
  senior: number;
  mezzanine: number;
  /** equity, including the land */
  equity: number;
  total: number;
  /**
   * Indicative mezzanine interest over the term, £.
   *
   * NOT included in the appraisal's finance cost — the engine's `interest` is
   * senior only, compounding monthly on the drawn balance. This is a simple
   * drawn-factor figure for the stack panel, and the screen says so.
   */
  mezzanineInterest: number;
  /** senior and mezzanine blended by amount, % pa */
  blendedRatePct: number;
}

export function capitalStack(inp: StackInputs): CapitalStack {
  const ltc = inp.ltcPct;
  // a mezzanine cannot gear BELOW the senior it sits on top of
  const mezzTo = inp.mezz ? Math.max(inp.mezz.toPct, ltc) : ltc;
  const construction = ltc > 0 ? inp.facility / (ltc / 100) : inp.constructionCost;
  const senior = (construction * ltc) / 100;
  const mezzanine = (construction * (mezzTo - ltc)) / 100;
  const equity = Math.max(0, construction * (1 - mezzTo / 100) + inp.landGross);
  const years = inp.months / 12;
  const drawn = (inp.mezz?.drawFactorPct ?? 0) / 100;
  const mezzanineInterest = inp.mezz ? ((mezzanine * inp.mezz.ratePct) / 100) * years * drawn : 0;
  const debt = senior + mezzanine;
  return {
    senior,
    mezzanine,
    equity,
    total: senior + mezzanine + equity || 1,
    mezzanineInterest,
    blendedRatePct: debt > 0 ? (senior * inp.seniorRatePct + mezzanine * (inp.mezz?.ratePct ?? 0)) / debt : 0,
  };
}
