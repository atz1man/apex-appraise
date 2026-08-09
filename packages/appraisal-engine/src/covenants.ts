/**
 * Facility covenants.
 *
 * A covenant is a promise a borrower made to a lender, and the only person who
 * knows what was promised is the firm. So nothing here has a default. An unset
 * limit is not tested and reports nothing — because a "breach" measured against a
 * threshold nobody agreed to is not a finding, it is an accusation, and the first
 * time a panel cries wolf about an invented limit is the last time anyone reads
 * it.
 *
 * The ratios themselves are always available: a firm with no limits set still
 * sees where it stands, it just is not told whether that is allowed.
 */

export interface CovenantLimits {
  /** maximum loan as a share of GDV, in percent — null means no covenant */
  ltgdvMaxPct?: number | null;
  /** maximum loan as a share of total cost, in percent */
  ltcMaxPct?: number | null;
  /** minimum profit on cost the facility requires, in percent */
  minProfitOnCostPct?: number | null;
}

export interface CovenantMetrics {
  facility: number;
  totalCost: number;
  gdv: number;
  profit: number;
}

export interface CovenantTest {
  key: 'ltgdv' | 'ltc' | 'profitOnCost';
  label: string;
  /** the measured value, as a percentage */
  actualPct: number;
  limitPct: number;
  /** 'max' covenants breach above the limit, 'min' covenants breach below it */
  direction: 'max' | 'min';
  breached: boolean;
  /** percentage points of room before breach — negative once breached */
  headroomPts: number;
}

export interface CovenantResult {
  tests: CovenantTest[];
  breaches: CovenantTest[];
  /** true when the firm has set no limits at all — nothing was tested */
  untested: boolean;
}

export function testCovenants(m: CovenantMetrics, limits: CovenantLimits): CovenantResult {
  const tests: CovenantTest[] = [];

  const push = (
    key: CovenantTest['key'],
    label: string,
    actualPct: number,
    limitPct: number | null | undefined,
    direction: 'max' | 'min',
  ) => {
    if (limitPct === null || limitPct === undefined) return;
    const headroomPts = direction === 'max' ? limitPct - actualPct : actualPct - limitPct;
    tests.push({ key, label, actualPct, limitPct, direction, breached: headroomPts < 0, headroomPts });
  };

  // guarded: a deal with no GDV or no cost has an undefined ratio, and reporting
  // it as 0% would look like an exceptionally safe loan
  if (m.gdv > 0) push('ltgdv', 'Loan to GDV', (m.facility / m.gdv) * 100, limits.ltgdvMaxPct, 'max');
  if (m.totalCost > 0) {
    push('ltc', 'Loan to cost', (m.facility / m.totalCost) * 100, limits.ltcMaxPct, 'max');
    push('profitOnCost', 'Profit on cost', (m.profit / m.totalCost) * 100, limits.minProfitOnCostPct, 'min');
  }

  return {
    tests,
    breaches: tests.filter((t) => t.breached),
    untested: tests.length === 0,
  };
}

/**
 * Market-standard figures for UK development finance, offered as a STARTING
 * POINT in the UI and never applied on their own. They are here so a firm setting
 * covenants for the first time has somewhere sensible to start, not so the
 * software can pretend to know the terms of someone else's loan.
 */
export const COVENANT_SUGGESTIONS = {
  ltgdvMaxPct: 65,
  ltcMaxPct: 70,
  minProfitOnCostPct: 15,
} as const;
