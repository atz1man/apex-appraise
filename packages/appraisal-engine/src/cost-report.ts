/**
 * Construction cost monitoring, against the cost the scheme was appraised at.
 *
 * The rollup measured the packages against THEMSELVES. "Appraised cost" was the
 * sum of the budget field on each package row — typed on the same screen — and
 * the variance was `forecast − that`. Four places on the page claimed otherwise:
 * the card's own subtitle said "from current appraisal", the panel header said
 * "Forecast vs appraised budget", the stat was labelled "Variance to appraisal",
 * and the page copy said "budgets, contractor commitments and variance alerts
 * all flow from the appraisal". None of them touched the appraisal.
 *
 * Measured on the demo workspace, on Harbour Reach: seven construction packages
 * forecasting £9,877,000 against an appraisal whose build cost is £6,855,195.
 * The screen reported **+£167,000 over**. The scheme is **£3.02m** over the cost
 * it was appraised at — and the packages were already £2.85m above it before a
 * single forecast overrun. The appraisal row was being fetched on that request
 * and used for nothing but a boolean.
 */

export interface CostPackageLike {
  /** £ the package was budgeted at */
  budget: number;
  /** £ placed under contract */
  committed: number;
  /** £ certified and paid */
  spent: number;
  /** £ expected on completion */
  forecast: number;
  /**
   * Percentage of the contract sum withheld until the works are accepted.
   *
   * A package the accounting feed created carries 0 — `syncXero` knows what was
   * invoiced, not what a contract withholds.
   */
  retentionPct?: number;
  /** payment certificates issued against the package so far */
  certificates?: number;
  /** how far the package has got, 0–100 */
  progressPct?: number;
}

export interface CostBaseline {
  /**
   * The construction cost from the current appraisal, £. Null when the deal has
   * no appraisal saved — in which case there is no baseline and nothing to
   * measure a variance against, which the screen must say rather than show a
   * zero.
   */
  appraisedBuild: number | null;
  /** The contingency the appraisal set aside, £ — headroom before the variance bites profit. */
  contingency?: number | null;
}

export interface CostRollup {
  /** what the packages themselves were budgeted at, £ — NOT the appraisal */
  packageBudgets: number;
  committed: number;
  spent: number;
  forecast: number;
  appraisedBuild: number | null;
  contingency: number | null;
  /** forecast over the appraised construction cost; + is over. Null with no appraisal. */
  variance: number | null;
  /** what the overrun costs profit once contingency is used up. Null with no appraisal. */
  profitImpact: number | null;
  /**
   * Appraised construction not yet broken into packages, £.
   *
   * Negative means the packages already exceed what the scheme was appraised to
   * cost — the state Harbour Reach was in while the screen read "on budget".
   */
  unallocated: number | null;
  /**
   * £ withheld from contractors until the works are accepted.
   *
   * Real money the firm owes and a builder is chasing. It was worked out on the
   * cost monitor screen AND again in the contractor list on the server, one
   * edit away from the two disagreeing about what is owed.
   */
  retentionHeld: number;
  /** payment certificates issued across the job */
  certificates: number;
  /**
   * Progress across the job, weighted by what each package is worth.
   *
   * Weighted, because a £900k package at 10% beside a £100k package at 100% is
   * a job barely started; averaging the percentages calls it 55%. Null when
   * there is nothing costed to weight by — an absence, not a zero.
   */
  weightedProgressPct: number | null;
  /** spend as a percentage of the forecast — what will actually be drawn. Null with nothing costed. */
  drawdownPct: number | null;
}

/** What one contractor is owed, withheld and certified across their packages. */
export interface ContractorTotals {
  contractValue: number;
  retention: number;
  certificates: number;
}

/**
 * The same rule per contractor as `costRollup` applies per deal.
 *
 * Separate function, one source: the contractor list on the server used to
 * carry its own copy of `committed × retentionPct`, so a change to how
 * retention is calculated would have moved one screen and not the other.
 */
export function contractorTotals(packages: CostPackageLike[]): ContractorTotals {
  return {
    contractValue: packages.reduce((a, p) => a + p.committed, 0),
    retention: retentionOf(packages),
    certificates: packages.reduce((a, p) => a + (p.certificates ?? 0), 0),
  };
}

const retentionOf = (packages: CostPackageLike[]) =>
  packages.reduce((a, p) => a + p.committed * ((p.retentionPct ?? 0) / 100), 0);

export function costRollup(packages: CostPackageLike[], baseline: CostBaseline): CostRollup {
  const sum = (pick: (p: CostPackageLike) => number) => packages.reduce((a, p) => a + pick(p), 0);
  const packageBudgets = sum((p) => p.budget);
  const forecast = sum((p) => p.forecast);
  const appraisedBuild = baseline.appraisedBuild;
  const contingency = baseline.contingency ?? null;
  const spent = sum((p) => p.spent);
  const base = {
    packageBudgets,
    committed: sum((p) => p.committed),
    spent,
    forecast,
    appraisedBuild,
    contingency,
    retentionHeld: retentionOf(packages),
    certificates: sum((p) => p.certificates ?? 0),
    // null rather than 0 when there is nothing to divide by: "nobody has costed
    // this" and "nothing has been drawn" are different sentences
    weightedProgressPct:
      packageBudgets > 0 ? sum((p) => p.budget * (p.progressPct ?? 0)) / packageBudgets : null,
    drawdownPct: forecast > 0 ? (spent / forecast) * 100 : null,
  };

  /**
   * Two states with nothing to compare, and they are different sentences.
   *
   * No appraisal: there is no baseline, so no variance exists — the screen says
   * "save an appraisal to measure against".
   *
   * No packages: the baseline stands and is worth showing, but nobody has
   * costed anything, so it is "not started" rather than "under budget by the
   * whole build". Without this a deal with an appraisal and an empty cost plan
   * reported a variance of minus its entire construction cost — measured on
   * Northgate: −£4,223,333, and a profit impact of +£4.2m, on a scheme where
   * nobody had entered a single package.
   */
  if (appraisedBuild == null || packages.length === 0) {
    return { ...base, variance: null, profitImpact: null, unallocated: appraisedBuild };
  }

  const variance = forecast - appraisedBuild;
  return {
    ...base,
    variance,
    /**
     * Contingency exists to absorb exactly this, so an overrun inside it costs
     * no profit. Beyond it, every pound comes off the bottom line. An underrun
     * is reported in full — it is real money back, not "negative contingency".
     */
    // `|| 0` because -Math.max(0, 0) is negative zero, which formats as −£0
    profitImpact: (variance > 0 ? -Math.max(0, variance - (contingency ?? 0)) : -variance) || 0,
    unallocated: appraisedBuild - packageBudgets,
  };
}
