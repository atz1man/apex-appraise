import type {
  AppraisalInput,
  AppraisalResult,
  AutoAppraisalInput,
  AutoAppraisalResult,
  CashflowRow,
  ComparableInput,
  ComparablesSummary,
  CostTiming,
  DcfInput,
  DcfResult,
  DcfSensitivityCell,
  DcfYear,
  IncomeInput,
  IncomeLineResult,
  IncomeMethod,
  IncomeResult,
  JvInput,
  JvResult,
  MonteCarloOptions,
  MonteCarloResult,
  SensitivityCell,
  SensitivityMetric,
  SpendProfileKey,
} from './types.js';

const SQFT_PER_SQM = 10.764;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Monthly spend weights summing to 1.
 * scurve = smoothstep increments; even/linear = flat; front/back = linear ramp down/up.
 */
export function buildSpendProfile(months: number, profile: SpendProfileKey = 'scurve'): number[] {
  const P = Math.max(1, Math.round(months));
  const w: number[] = [];
  for (let i = 0; i < P; i++) {
    if (profile === 'even' || profile === 'linear') w.push(1);
    else if (profile === 'front') w.push(P - i);
    else if (profile === 'back') w.push(i + 1);
    else {
      const t = (i + 1) / P;
      const c = t * t * (3 - 2 * t);
      const tp = i / P;
      const cp = tp * tp * (3 - 2 * tp);
      w.push(c - cp);
    }
  }
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / sum);
}

/**
 * IRR by bisection on [-0.95, 2.0]; returns the PER-PERIOD rate (monthly for monthly cashflows),
 * or null when there is no sign change in the bracket. Annualise at the call site.
 */
export function irr(cashflows: number[]): number | null {
  const npv = (r: number) => cashflows.reduce((a, c, t) => a + c / Math.pow(1 + r, t), 0);
  let lo = -0.95;
  let hi = 2.0;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1) return mid;
    if (flo * f < 0) hi = mid;
    else {
      lo = mid;
      flo = f;
    }
  }
  return (lo + hi) / 2;
}

export const annualise = (monthlyRate: number | null): number | null =>
  monthlyRate == null ? null : Math.pow(1 + monthlyRate, 12) - 1;

/**
 * SDLT — UK non-residential/mixed slice bands as specified in CALCULATIONS.md §8.
 * Centralised so rates can be updated against current HMRC bands in one place.
 */
export function sdltCommercial(landPrice: number): number {
  let L = landPrice;
  let sdlt = 0;
  if (L > 250_000) {
    sdlt += (L - 250_000) * 0.05;
    L = 250_000;
  }
  if (L > 150_000) sdlt += (L - 150_000) * 0.02;
  return sdlt;
}

/** CIL = £/sqm × (GIA sqft → sqm). */
export function cilCharge(giaSqFt: number, ratePerSqm: number): number {
  return ratePerSqm * (giaSqFt / SQFT_PER_SQM);
}

/**
 * SDLT — residential slice bands (England & NI, from 1 April 2025). Centralised
 * so rates can be updated against current HMRC bands in one place. The
 * additional-dwelling surcharge (companies / second homes — the usual case for
 * developers and landlords) adds a flat 5% on the whole price. MDR was
 * abolished 1 June 2024 and is deliberately not modelled.
 */
export function sdltResidential(price: number, opts: { additionalDwelling?: boolean } = {}): number {
  const bands: Array<[number, number]> = [
    [125_000, 0],
    [250_000, 0.02],
    [925_000, 0.05],
    [1_500_000, 0.1],
    [Infinity, 0.12],
  ];
  let sdlt = 0;
  let prev = 0;
  for (const [upTo, rate] of bands) {
    if (price <= prev) break;
    const slice = Math.min(price, upTo) - prev;
    sdlt += slice * rate;
    prev = upTo;
  }
  if (opts.additionalDwelling) sdlt += price * 0.05;
  return sdlt;
}

/** UK market standard: SDLT 5% + agent + legal, applied to the price a purchaser pays. */
export const DEFAULT_PURCHASER_COSTS_PCT = 6.8;

/**
 * Investment method (RICS) — capitalise the net rent of the held element into a
 * capital value.
 *
 *   gross rent − voids − non-recoverables − fixed deductions = net rent (NOI)
 *   net rent × YP (= 100 / yield) = gross capital value
 *   less the let-up void, then divided by (1 + purchaser's costs) = net capital value
 *
 * The net capital value is what the developer receives — purchaser's costs sit on
 * top of it, so the costs-inclusive price is what the yield is measured against.
 * The let-up deduction is the plain undiscounted rent forgone while the space is
 * being let; it is not a discounted-cashflow term, and it pushes the net initial
 * yield above the capitalisation yield.
 */
/** Years purchase in perpetuity at yield i (fraction). */
export const ypPerpetuity = (i: number) => (i > 0 ? 1 / i : 0);
/** Years purchase for n years at yield i — the annuity factor. */
export const ypYears = (n: number, i: number) => (i > 0 ? (1 - Math.pow(1 + i, -n)) / i : Math.max(0, n));
/** Present value of £1 receivable in n years at yield i. */
export const pvOfPound = (n: number, i: number) => (i > -1 ? Math.pow(1 + i, -n) : 0);

export function capitaliseIncome(input: IncomeInput): IncomeResult {
  const method: IncomeMethod = input.method ?? 'perpetuity';
  const pc = input.purchaserCostsPct ?? DEFAULT_PURCHASER_COSTS_PCT;

  // ---- rent analysis, line by line ----
  const raw = input.lines.map((l) => {
    const totalArea = l.count * l.area;
    const grossRent = totalArea * l.rentPsf;
    const grossErv = totalArea * (l.ervPsf ?? l.rentPsf);
    const voidRate = (l.voidPct ?? 0) / 100;
    return {
      line: l,
      totalArea,
      grossRent,
      grossErv,
      voidAllowance: grossRent * voidRate,
      rentAfterVoid: grossRent * (1 - voidRate),
      ervAfterVoid: grossErv * (1 - voidRate),
    };
  });

  const totalArea = raw.reduce((a, r) => a + r.totalArea, 0);
  const grossRent = raw.reduce((a, r) => a + r.grossRent, 0);
  const grossErv = raw.reduce((a, r) => a + r.grossErv, 0);
  const voidAllowance = raw.reduce((a, r) => a + r.voidAllowance, 0);
  const rentAfterVoid = grossRent - voidAllowance;
  const nonRecoverable = (rentAfterVoid * input.nonRecoverablePct) / 100;
  const deductions = input.annualDeductions ?? 0;
  const netRent = rentAfterVoid - nonRecoverable - deductions;

  // Fixed deductions are a property-level charge, so they are shared across the
  // tenancies in proportion to the rent each contributes.
  const share = (r: (typeof raw)[number]) => (rentAfterVoid > 0 ? r.rentAfterVoid / rentAfterVoid : 0);
  const netOf = (afterVoid: number, s: number) => afterVoid * (1 - input.nonRecoverablePct / 100) - deductions * s;

  const lines: IncomeLineResult[] = raw.map((r) => {
    const s = share(r);
    const netPassing = netOf(r.rentAfterVoid, s);
    const netErv = netOf(r.ervAfterVoid, s);
    const yieldUsed = r.line.yieldPct ?? input.yieldPct;
    const reversionYieldUsed = input.reversionYieldPct ?? yieldUsed;
    const i = yieldUsed / 100;
    const j = reversionYieldUsed / 100;
    const n = Math.max(0, r.line.yearsToReview ?? 0);
    const uplift = netErv - netPassing;
    const reversionary = method !== 'perpetuity' && n > 0 && Math.abs(uplift) > 1e-9;

    let termValue: number;
    let reversionValue: number;
    if (!reversionary) {
      // nothing to revert to (or the perpetuity method) — capitalise what is passing
      termValue = netPassing * ypPerpetuity(i);
      reversionValue = 0;
    } else if (method === 'termReversion') {
      // vertical split: the passing rent for the term, then the ERV in perpetuity
      // deferred to the review date
      termValue = netPassing * ypYears(n, i);
      reversionValue = netErv * ypPerpetuity(j) * pvOfPound(n, j);
    } else {
      // horizontal split: the passing rent in perpetuity as the bottom slice,
      // the uplift as a deferred top slice
      termValue = netPassing * ypPerpetuity(i);
      reversionValue = uplift * ypPerpetuity(j) * pvOfPound(n, j);
    }

    return {
      label: r.line.label,
      count: r.line.count,
      area: r.line.area,
      totalArea: r.totalArea,
      grossRent: r.grossRent,
      grossErv: r.grossErv,
      voidAllowance: r.voidAllowance,
      rentAfterVoid: r.rentAfterVoid,
      netPassing,
      netErv,
      yearsToReview: n,
      yieldUsed,
      reversionYieldUsed,
      termValue,
      reversionValue,
      value: termValue + reversionValue,
      isReversionary: reversionary,
    };
  });

  const netErv = lines.reduce((a, l) => a + l.netErv, 0);
  const grossCapitalValue = lines.reduce((a, l) => a + l.value, 0);
  const letUpDeduction = (netRent * (input.letUpMonths ?? 0)) / 12;
  const capitalValueBeforeCosts = grossCapitalValue - letUpDeduction;
  const netCapitalValue = capitalValueBeforeCosts / (1 + pc / 100);
  const purchaserCosts = capitalValueBeforeCosts - netCapitalValue;

  /**
   * Equivalent yield: the single rate that reproduces this valuation when
   * applied to both the term and the reversion. Solved by bisection because
   * there is no closed form; it collapses to the initial yield when nothing is
   * reversionary, which the tests assert.
   */
  const valueAtSingleYield = (i: number) =>
    lines.reduce((a, l) => {
      if (!l.isReversionary) return a + l.netPassing * ypPerpetuity(i);
      if (method === 'termReversion') {
        return a + l.netPassing * ypYears(l.yearsToReview, i) + l.netErv * ypPerpetuity(i) * pvOfPound(l.yearsToReview, i);
      }
      return a + l.netPassing * ypPerpetuity(i) + (l.netErv - l.netPassing) * ypPerpetuity(i) * pvOfPound(l.yearsToReview, i);
    }, 0);

  let equivalentYield = 0;
  if (grossCapitalValue > 0) {
    let lo = 0.001;
    let hi = 0.4;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      // value falls as the yield rises, so bracket accordingly
      if (valueAtSingleYield(mid) > grossCapitalValue) lo = mid;
      else hi = mid;
    }
    equivalentYield = (lo + hi) / 2;
  }

  return {
    lines,
    totalArea,
    grossRent,
    grossErv,
    voidAllowance,
    nonRecoverable,
    deductions,
    netRent,
    netErv,
    method,
    yearsPurchase: ypPerpetuity(input.yieldPct / 100),
    grossCapitalValue,
    letUpDeduction,
    capitalValueBeforeCosts,
    purchaserCosts,
    netCapitalValue,
    netInitialYield: capitalValueBeforeCosts > 0 ? netRent / capitalValueBeforeCosts : 0,
    reversionaryYield: capitalValueBeforeCosts > 0 ? netErv / capitalValueBeforeCosts : 0,
    equivalentYield,
    capitalValuePsf: totalArea > 0 ? netCapitalValue / totalArea : 0,
    blendedRentPsf: totalArea > 0 ? grossRent / totalArea : 0,
  };
}

/**
 * Growth-explicit DCF over a held investment.
 *
 * Rent runs at the passing level until a review, steps to the ERV grown to that
 * review date, and steps again every review cycle. At the end of the hold the
 * running rent is capitalised at the exit yield, sale costs come off, and every
 * flow is discounted at the target rate.
 *
 * Rent is treated as received annually in arrear — the convention UK valuers
 * quote against, and the same convention the years-purchase figures assume, so
 * the two methods reconcile.
 */
export function discountedCashflow(income: IncomeInput, dcf: DcfInput): DcfResult {
  const cap = capitaliseIncome(income);
  const years = Math.max(1, Math.round(dcf.holdYears));
  const g = dcf.rentalGrowthPct / 100;
  const d = dcf.discountRatePct / 100;
  const cycle = Math.max(1, Math.round(dcf.reviewCycleYears ?? 5));

  /**
   * Net rent receivable in year t, and whether a review lands that year.
   * Per line: the passing rent until its first review, then the ERV grown to
   * the most recent review date. Line-level deductions are already netted by
   * capitaliseIncome, so the DCF inherits exactly the same net figures.
   */
  const rentIn = (t: number, growth: number) => {
    let rent = 0;
    let reviewed = false;
    for (const l of cap.lines) {
      const first = l.yearsToReview > 0 ? l.yearsToReview : cycle;
      if (t < first) {
        rent += l.netPassing;
        continue;
      }
      const reviewsPassed = Math.floor((t - first) / cycle) + 1;
      const lastReviewYear = first + (reviewsPassed - 1) * cycle;
      if (t === lastReviewYear) reviewed = true;
      rent += l.netErv * Math.pow(1 + growth, lastReviewYear);
    }
    return { rent, reviewed };
  };

  const build = (growth: number, discount: number) => {
    const rows: DcfYear[] = [];
    let incomePv = 0;
    for (let t = 1; t <= years; t++) {
      const { rent, reviewed } = rentIn(t, growth);
      const df = Math.pow(1 + discount, -t);
      const pv = rent * df;
      incomePv += pv;
      rows.push({ year: t, rent, reviewed, discountFactor: df, presentValue: pv });
    }
    // the buyer at exit capitalises the rent running THEN — the year after the
    // last one we collect, since rent is received in arrear
    const exitRent = rentIn(years + 1, growth).rent;
    const exitYield = dcf.exitYieldPct / 100;
    const exitValueGross = exitYield > 0 ? exitRent / exitYield : 0;
    const exitCosts = (exitValueGross * (dcf.exitCostsPct ?? 0)) / 100;
    const exitValueNet = exitValueGross - exitCosts;
    const exitPv = exitValueNet * Math.pow(1 + discount, -years);
    return { rows, incomePv, exitRent, exitValueGross, exitCosts, exitValueNet, exitPv, npv: incomePv + exitPv };
  };

  const at = build(g, d);

  /**
   * Equated yield: the discount rate at which this cashflow reproduces the
   * capitalised value. Solved by bisection — value falls as the rate rises.
   */
  let equatedYield = 0;
  const target = cap.netCapitalValue;
  if (target > 0) {
    let lo = 0.0005;
    let hi = 0.6;
    for (let k = 0; k < 90; k++) {
      const mid = (lo + hi) / 2;
      if (build(g, mid).npv > target) lo = mid;
      else hi = mid;
    }
    equatedYield = (lo + hi) / 2;
  }

  return {
    years: at.rows,
    incomePv: at.incomePv,
    exitRent: at.exitRent,
    exitValueGross: at.exitValueGross,
    exitCosts: at.exitCosts,
    exitValueNet: at.exitValueNet,
    exitPv: at.exitPv,
    netPresentValue: at.npv,
    pvFromIncome: at.npv > 0 ? at.incomePv / at.npv : 0,
    pvFromExit: at.npv > 0 ? at.exitPv / at.npv : 0,
    equatedYield,
  };
}

/**
 * Growth × exit-yield matrix over the held element — the two assumptions a DCF
 * is least certain about and most sensitive to.
 *
 * Steps are percentage POINTS applied to the stated assumptions, so the grid
 * speaks the way a valuer does (±50bp on the yield, ±1pp on growth) rather than
 * scaling a rate by a percentage of itself.
 *
 * Rows run from the highest growth down and columns from the sharpest yield out,
 * so value falls from the top-left — the same reading order as the profit grid.
 *
 * Every cell runs the real `discountedCashflow`; there is no second, lighter
 * model of the same maths that could drift from it.
 */
export function dcfSensitivity(
  income: IncomeInput,
  dcf: DcfInput,
  growthSteps: number[] = [-2, -1, 0, 1, 2],
  yieldSteps: number[] = [-1, -0.5, 0, 0.5, 1],
): DcfSensitivityCell[][] {
  const base = discountedCashflow(income, dcf).netPresentValue;
  const capitalised = capitaliseIncome(income).netCapitalValue;
  return growthSteps
    .slice()
    .sort((a, b) => b - a)
    .map((gd) =>
      yieldSteps
        .slice()
        .sort((a, b) => a - b)
        .map((yd) => {
          // a nil or negative exit yield capitalises to infinity; hold the cell at
          // a nominal 10bp instead of printing a number that means nothing
          const exitYieldPct = Math.max(0.1, dcf.exitYieldPct + yd);
          const rentalGrowthPct = dcf.rentalGrowthPct + gd;
          const npv = discountedCashflow(income, { ...dcf, exitYieldPct, rentalGrowthPct }).netPresentValue;
          return {
            rentalGrowthPct,
            exitYieldPct,
            growthDelta: gd,
            yieldDelta: yd,
            netPresentValue: npv,
            isBase: gd === 0 && yd === 0,
            ratio: base > 0 ? npv / base : 1,
            vsCapitalisation: capitalised > 0 ? npv / capitalised : 1,
          };
        }),
    );
}

export interface ComputeOpts {
  salesMult?: number;
  buildMult?: number;
  withCash?: boolean;
}

/**
 * Core residual/profit computation, transcribed from the Development Appraisal prototype.
 * Interest compounds monthly on the drawn balance; only the LTC fraction of each month's
 * spend is drawn (equity funds the rest). Do not simplify to flat interest.
 */
export function computeAppraisal(input: AppraisalInput, opts: ComputeOpts = {}): AppraisalResult {
  const salesMult = opts.salesMult ?? 1;
  const buildMult = opts.buildMult ?? 1;
  const F = input.finance;

  // A phased scheme's accommodation lives on the phases; the flat units array is
  // the single-phase form of the same thing.
  const phased = input.phases && input.phases.length > 0 ? input.phases : null;
  const allUnits = phased ? phased.flatMap((p) => p.units) : input.units;

  const salesGdv = allUnits.reduce((a, u) => a + u.count * u.area * u.cap, 0) * salesMult;
  // held-and-let element valued by the investment method; shocked with sales in
  // sensitivity/Monte Carlo runs because a value shift moves both exits
  const income = input.income ? capitaliseIncome(input.income) : undefined;
  const investmentValue = income ? income.netCapitalValue * salesMult : 0;
  const gdv = salesGdv + investmentValue;
  // the let space still has to be built — its lettable area counts towards NIA/GIA
  const nia = allUnits.reduce((a, u) => a + u.count * u.area, 0) + (income?.totalArea ?? 0);
  const eff = input.efficiency / 100 || 1;
  const gia = eff > 0 ? nia / eff : nia;
  const schemeRate = input.trades.reduce((a, t) => a + t.rate, 0) * buildMult;
  const saleCosts = (gdv * (input.disposal.agentPct + input.disposal.legalPct)) / 100;

  // ---- monthly drawdown with rolled-up interest ----
  /** how many months a unit count takes to sell, and the share arriving each month */
  const absorptionShare = (unitCount: number, perMonth: number | undefined, fallbackMonths: number, cap: number) => {
    if (perMonth && perMonth > 0 && unitCount > 0) {
      const months = clamp(Math.ceil(unitCount / perMonth), 1, 24);
      const share: number[] = [];
      let remaining = unitCount;
      for (let k = 0; k < months; k++) {
        const sold = Math.min(perMonth, remaining);
        remaining -= sold;
        share.push(sold / unitCount);
      }
      return { months, share };
    }
    const months = clamp(Math.round(fallbackMonths) || 1, 1, cap);
    return { months, share: new Array<number>(months).fill(1 / months) };
  };

  // Phase programme — each phase builds, completes, then sells on its own clock,
  // at its own rate and on-costs when it overrides the scheme's.
  const phaseCalc = phased
    ? phased.map((p) => {
        const pNia = p.units.reduce((a, u) => a + u.count * u.area, 0);
        const pGia = eff > 0 ? pNia / eff : pNia;
        const unitCount = p.units.reduce((a, u) => a + u.count, 0);
        const start = clamp(Math.round(p.start) || 1, 1, 240);
        const buildMonths = clamp(Math.round(p.buildMonths) || 12, 1, 60);
        const { months: salesMonths, share } = absorptionShare(unitCount, p.absorptionUnitsPerMonth, p.salesMonths, 24);
        const pRate = p.trades?.length ? p.trades.reduce((a, t) => a + t.rate, 0) * buildMult : schemeRate;
        const pBuild = pRate * pGia;
        const pFees = (pBuild * (p.profFeePct ?? input.profFeePct)) / 100;
        const pCont = (pBuild * (p.contingencyPct ?? input.contingencyPct)) / 100;
        return {
          name: p.name,
          start,
          buildMonths,
          salesMonths,
          practicalCompletion: start + buildMonths - 1,
          end: start + buildMonths + salesMonths - 1,
          nia: pNia,
          gia: pGia,
          gdv: p.units.reduce((a, u) => a + u.count * u.area * u.cap, 0) * salesMult,
          trades: p.trades?.length ? p.trades : input.trades,
          ownTrades: !!p.trades?.length,
          feePct: p.profFeePct ?? input.profFeePct,
          contPct: p.contingencyPct ?? input.contingencyPct,
          buildRate: pRate,
          build: pBuild,
          fees: pFees,
          cont: pCont,
          cost: pBuild + pFees + pCont,
          otherCosts: p.otherCosts ?? [],
          otherTotal: (p.otherCosts ?? []).reduce((a, o) => a + o.amount, 0),
          unitCount,
          share,
        };
      })
    : null;

  // Scheme totals. Unphased schemes keep the original single-rate arithmetic
  // literally; phased ones sum their phases, since each may carry its own rate.
  const unphasedGia = phaseCalc ? gia - phaseCalc.reduce((a, p) => a + p.gia, 0) : gia;
  const build = phaseCalc ? phaseCalc.reduce((a, p) => a + p.build, 0) + schemeRate * unphasedGia : schemeRate * gia;
  const fees = phaseCalc
    ? phaseCalc.reduce((a, p) => a + p.fees, 0) + (schemeRate * unphasedGia * input.profFeePct) / 100
    : (build * input.profFeePct) / 100;
  const cont = phaseCalc
    ? phaseCalc.reduce((a, p) => a + p.cont, 0) + (schemeRate * unphasedGia * input.contingencyPct) / 100
    : (build * input.contingencyPct) / 100;
  // the headline rate is blended once phases price differently
  const buildRate = gia > 0 ? build / gia : schemeRate;
  const otherTotal =
    input.otherCosts.reduce((a, o) => a + o.amount, 0) + (phaseCalc ? phaseCalc.reduce((a, p) => a + p.otherTotal, 0) : 0);

  // P is the last month anything is under construction; sM is what follows it.
  const P = phaseCalc
    ? Math.max(...phaseCalc.map((p) => p.practicalCompletion))
    : clamp(Math.round(F.periodMonths) || 12, 4, 22);
  const totalUnitCount = allUnits.reduce((a, u) => a + u.count, 0);
  const { months: schemeSalesMonths, share: schemeShare } = absorptionShare(
    totalUnitCount,
    F.absorptionUnitsPerMonth,
    F.salesMonths,
    8,
  );
  const sM = phaseCalc ? Math.max(...phaseCalc.map((p) => p.end)) - P : schemeSalesMonths;
  const revShare = schemeShare; // fraction of net sales revenue arriving in each sales month
  const constructionTotal = build + fees + cont + otherTotal;
  const totalMonths = P + sM;
  const profile = F.spendProfile ?? 'scurve';
  const incs = buildSpendProfile(P, profile);
  const constrSeries = new Array<number>(totalMonths + 1).fill(0);
  // Fast path: with no per-line timing every cost follows one profile over the
  // build, so the aggregate spread is exactly today's arithmetic — kept literally
  // identical rather than re-derived, because the golden fixture is penny-locked.
  const timed = input.trades.some((t) => t.timing) || input.otherCosts.some((o) => o.timing);
  if (phaseCalc) {
    // Each phase's construction falls across its own build window. The held
    // element (if any) is not part of a phase, so its build spreads across the
    // whole envelope; other costs are scheme-level and use their own timing.
    const spreadPhase = (amount: number, start: number, months: number) => {
      const w = buildSpendProfile(months, profile);
      for (let i = 0; i < months; i++) {
        const m = start + i;
        if (m >= 1 && m <= totalMonths) constrSeries[m] += amount * w[i];
      }
    };
    /** spread a cost over `months` from an absolute project month */
    const spreadFrom = (amount: number, from: number, months: number, timingProfile?: SpendProfileKey) => {
      const start = clamp(Math.round(from), 1, totalMonths);
      const span = clamp(Math.round(months), 1, totalMonths - start + 1);
      const w = buildSpendProfile(span, timingProfile ?? profile);
      for (let i = 0; i < span; i++) constrSeries[start + i] += amount * w[i];
    };
    for (const p of phaseCalc) {
      // A phase's trades may carry their own windows, timed RELATIVE TO THE
      // PHASE. Without timing the phase's construction spreads as one profile
      // across its window — the original arithmetic, kept exactly.
      if (p.trades.some((t) => t.timing)) {
        const onCosts = 1 + (p.feePct + p.contPct) / 100;
        for (const t of p.trades) {
          const amount = t.rate * buildMult * p.gia * onCosts;
          spreadFrom(
            amount,
            p.start + (Math.round(t.timing?.start ?? 1) - 1),
            t.timing?.months ?? p.buildMonths,
            t.timing?.profile,
          );
        }
      } else {
        spreadPhase(p.cost, p.start, p.buildMonths);
      }
      // a phase's own costs are timed RELATIVE TO THE PHASE — start 1 is the
      // phase's first month on site, not the project's
      for (const o of p.otherCosts) {
        spreadFrom(o.amount, p.start + (Math.round(o.timing?.start ?? 1) - 1), o.timing?.months ?? p.buildMonths, o.timing?.profile);
      }
    }
    if (unphasedGia > 0.0001) {
      // the held element is not in any phase: its build spreads over the envelope
      spreadPhase(schemeRate * unphasedGia * (1 + (input.profFeePct + input.contingencyPct) / 100), 1, P);
    }
    for (const o of input.otherCosts) spreadFrom(o.amount, o.timing?.start ?? 1, o.timing?.months ?? P, o.timing?.profile);
  } else if (!timed) {
    for (let i = 0; i < P; i++) constrSeries[i + 1] = constructionTotal * incs[i];
  } else {
    // Per-line: trades carry build, fees and contingency pro rata (both are a
    // percentage of build, so they fall as the build falls); other costs spread
    // on their own timing. A line may extend past practical completion.
    const spread = (amount: number, timing: CostTiming | undefined, into: number[]) => {
      const start = clamp(Math.round(timing?.start ?? 1), 1, totalMonths);
      const months = clamp(Math.round(timing?.months ?? P), 1, totalMonths - start + 1);
      const w = buildSpendProfile(months, timing?.profile ?? profile);
      for (let i = 0; i < months; i++) into[start + i] += amount * w[i];
    };
    const tradeSeries = new Array<number>(totalMonths + 1).fill(0);
    for (const t of input.trades) spread(t.rate * buildMult * gia, t.timing, tradeSeries);
    const onCosts = 1 + (input.profFeePct + input.contingencyPct) / 100;
    for (let m = 1; m <= totalMonths; m++) constrSeries[m] = tradeSeries[m] * onCosts;
    for (const o of input.otherCosts) spread(o.amount, o.timing, constrSeries);
  }
  const mRate = F.ratePct / 100 / 12;
  const ltcF = F.ltcPct / 100;
  const intSeries = new Array<number>(totalMonths + 1).fill(0);
  let bal = 0;
  let totalInterest = 0;
  let peak = 0;
  let drawn = 0;
  const saleNet = gdv - saleCosts;
  const revSeries = new Array<number>(totalMonths + 1).fill(0);
  const disposalRate = (input.disposal.agentPct + input.disposal.legalPct) / 100;
  if (phaseCalc) {
    // Each phase sells as it completes — that is what makes phasing pay: early
    // receipts repay the facility while a later phase is still drawing on it.
    for (const p of phaseCalc) {
      const net = p.gdv * (1 - disposalRate);
      for (let i = 0; i < p.salesMonths; i++) {
        const m = p.practicalCompletion + 1 + i;
        if (m <= totalMonths) revSeries[m] += net * p.share[i];
      }
    }
    // the capitalised investment element is realised once everything is complete
    if (investmentValue > 0) {
      const net = investmentValue * (1 - disposalRate);
      const window = totalMonths - P;
      for (let i = 0; i < window; i++) revSeries[P + 1 + i] += net / window;
    }
  } else {
    for (let m = P + 1; m <= totalMonths; m++) revSeries[m] = saleNet * revShare[m - P - 1];
  }
  // One pass over the whole programme: interest on the drawn balance, then the
  // month's spend, then whatever revenue arrives repays. Costs timed past
  // practical completion draw on the facility like any other — the old split
  // loops assumed nothing could be spent after PC.
  for (let m = 1; m <= totalMonths; m++) {
    const intr = bal * mRate;
    intSeries[m] = intr;
    totalInterest += intr;
    const draw = constrSeries[m] * ltcF;
    drawn += draw;
    bal += intr + draw;
    if (revSeries[m] > 0) {
      const repay = Math.min(revSeries[m], bal);
      bal -= repay;
    }
    // peak is the CLOSING balance: a month's receipts clear the interest accrued
    // that month before the facility is measured. Checking mid-month instead
    // inflates the peak by one month's interest and with it the arrangement fee.
    if (bal > peak) peak = bal;
  }
  const facility = peak;
  const arrangement = (facility * F.arrangementFeePct) / 100;
  const finance = totalInterest + arrangement;

  let residualNet: number;
  let profit: number;
  let landGross: number;
  if (input.site.mode === 'residual') {
    profit = (gdv * input.targetProfitOnGdvPct) / 100;
    const remainder = gdv - saleCosts - build - fees - cont - otherTotal - finance - profit;
    residualNet = remainder / (1 + input.site.acqPct / 100);
    landGross = residualNet * (1 + input.site.acqPct / 100);
  } else {
    landGross = input.site.landFixed * (1 + input.site.acqPct / 100);
    residualNet = input.site.landFixed;
    profit = gdv - (saleCosts + build + fees + cont + otherTotal + finance + landGross);
  }
  const acqCost = landGross - residualNet;
  const totalCost = saleCosts + build + fees + cont + otherTotal + finance + landGross;
  const equity = landGross + constructionTotal * (1 - ltcF);
  const poc = totalCost > 0 ? profit / totalCost : 0;
  const rogdv = gdv > 0 ? profit / gdv : 0;
  const roe = equity > 0 ? profit / equity : 0;

  const out: AppraisalResult = {
    nia,
    gia,
    gdv,
    salesGdv,
    investmentValue,
    ...(income ? { income } : {}),
    ...(phaseCalc
      ? {
          phases: phaseCalc.map(({ share: _s, otherCosts: _oc, feePct: _f, contPct: _c, ...p }) => p),
        }
      : {}),
    buildRate,
    build,
    fees,
    cont,
    otherTotal,
    saleCosts,
    interest: totalInterest,
    arrangement,
    finance,
    facility,
    equity,
    residualNet,
    landGross,
    acqCost,
    profit,
    totalCost,
    poc,
    rogdv,
    roe,
    period: P,
    salesMonths: sM,
    holdYears: totalMonths / 12,
  };

  if (opts.withCash) {
    const rows: CashflowRow[] = [];
    let cum = 0;
    for (let m = 1; m <= totalMonths; m++) {
      const constr = constrSeries[m];
      const landM = m === 1 ? landGross : 0;
      const costTot = constr + landM;
      const intr = intSeries[m];
      const rev = revSeries[m];
      const net = rev - costTot - intr;
      cum += net;
      rows.push({ m, cost: costTot, intr, rev, net, cum });
    }
    // IRR series walk every month and net spend against receipts in that month.
    // Splitting them at practical completion assumed all costs precede all
    // revenue — untrue once a phase sells while another builds, or a cost is
    // timed past PC, and it silently dropped those flows from the IRR.
    const cfU = new Array<number>(totalMonths + 1).fill(0);
    cfU[0] = -landGross;
    for (let m = 1; m <= totalMonths; m++) cfU[m] = revSeries[m] - constrSeries[m];
    const cfE = new Array<number>(totalMonths + 1).fill(0);
    cfE[0] = -landGross;
    let debtOut = drawn + totalInterest;
    for (let m = 1; m <= totalMonths; m++) {
      cfE[m] -= constrSeries[m] * (1 - ltcF); // equity funds the unfinanced share
      const repay = Math.min(revSeries[m], debtOut);
      debtOut -= repay;
      cfE[m] += revSeries[m] - repay; // receipts service the facility first
    }
    out.cash = {
      rows,
      totalMonths,
      peak: facility,
      projIrr: annualise(irr(cfU)),
      eqIrr: annualise(irr(cfE)),
    };
  }
  return out;
}

/**
 * JV equity waterfall — four tiers: return of capital → compounded preferred →
 * residual split pro-rata → GP promote. LP/GP IRRs are the annualised-MOIC
 * approximation used on the prototype's cards; true project/equity IRRs come
 * from the monthly cashflow in computeAppraisal.
 */
export function jvWaterfall(equity: number, profit: number, holdYears: number, jv: JvInput): JvResult {
  const E = equity;
  const gpCo = (E * jv.gpCoinvestPct) / 100;
  const lpEq = E - gpCo;
  const prefTotal = E * (Math.pow(1 + jv.prefPct / 100, holdYears) - 1);
  let lpProfit: number;
  let gpProfit: number;
  let promote: number;
  let residualProfit: number;
  if (profit <= prefTotal) {
    lpProfit = profit * (E > 0 ? lpEq / E : 0);
    gpProfit = profit - lpProfit;
    promote = 0;
    residualProfit = Math.max(0, profit - prefTotal);
  } else {
    residualProfit = profit - prefTotal;
    promote = (residualProfit * jv.promotePct) / 100;
    const resAfter = residualProfit - promote;
    lpProfit = (prefTotal + resAfter) * (E > 0 ? lpEq / E : 0);
    gpProfit = (prefTotal + resAfter) * (E > 0 ? gpCo / E : 0) + promote;
  }
  const party = (eq: number, pf: number) => {
    const total = eq + pf;
    const moic = eq > 0 ? total / eq : 0;
    const irrApprox = eq > 0 && holdYears > 0 && total > 0 ? Math.pow(total / eq, 1 / holdYears) - 1 : null;
    return { equity: eq, profit: pf, total, moic, irr: irrApprox };
  };
  return {
    lp: party(lpEq, lpProfit),
    gp: party(gpCo, gpProfit),
    prefTotal,
    residualProfit,
    promote,
    holdYears,
  };
}

/**
 * Sensitivity grid — re-runs computeAppraisal across sales × build multiplier deltas.
 * Rows are build deltas (top = most positive, matching the prototype's reversed rows),
 * columns are sales/GDV deltas left→right.
 */
export function sensitivityGrid(
  input: AppraisalInput,
  metric: SensitivityMetric,
  steps: number[] = [-0.1, -0.05, 0, 0.05, 0.1],
): SensitivityCell[][] {
  const metricOf = (r: AppraisalResult) =>
    metric === 'roc' ? r.poc : metric === 'profit' ? r.profit : r.residualNet;
  const base = metricOf(computeAppraisal(input));
  return steps
    .slice()
    .reverse()
    .map((bd) =>
      steps.map((gd) => {
        const r = computeAppraisal(input, { salesMult: 1 + gd, buildMult: 1 + bd });
        const v = metricOf(r);
        return {
          value: v,
          salesDelta: gd,
          buildDelta: bd,
          isBase: gd === 0 && bd === 0,
          ratio: base > 0 ? v / base : 1,
        };
      }),
    );
}

/**
 * Auto-Appraisal indicative compute — lighter finance approximation (0.55 average-drawn
 * factor) for instant results. The full monthly model runs once handed to Development
 * Appraisal. Label results "indicative".
 */
export function autoAppraise(j: AutoAppraisalInput): AutoAppraisalResult {
  const nia = j.units.reduce((a, u) => a + u.count * u.area, 0);
  const gdv = j.units.reduce((a, u) => a + u.count * u.area * u.cap, 0);
  const eff = j.efficiency / 100 || 1;
  const gia = eff > 0 ? nia / eff : nia;
  const build = j.buildPerSqft * gia;
  const fees = (build * j.profFeePct) / 100;
  const cont = (build * j.contingencyPct) / 100;
  const cil = cilCharge(gia, j.cilPerSqm);
  const other = cil + j.s106;
  const saleCosts = (gdv * (j.agentPct + j.legalPct)) / 100;
  const facility = ((build + fees + cont + other) * j.ltcPct) / 100;
  const interest = facility * (j.ratePct / 100) * ((j.periodMonths + j.salesMonths) / 12) * 0.55;
  const arrangement = (facility * j.arrangementFeePct) / 100;
  const finance = interest + arrangement;
  const targetProfit = (gdv * j.targetProfitPct) / 100;
  const remainder = gdv - saleCosts - build - fees - cont - other - finance - targetProfit;
  const residualNet = remainder / (1 + j.acqPct / 100);
  // the land cost implied by that residual, on the same basis the residual used
  const landGross = residualNet * (1 + j.acqPct / 100);
  const totalCost = saleCosts + build + fees + cont + other + finance + landGross;
  const profit = gdv - totalCost;
  const poc = totalCost > 0 ? profit / totalCost : 0;
  const sdlt = sdltCommercial(j.asking > 0 ? j.asking : Math.max(residualNet, 0));

  let askingGross: number | null = null;
  let totalCostAtAsking: number | null = null;
  let profitAtAsking: number | null = null;
  let rocAtAsking: number | null = null;
  let headroom: number | null = null;
  if (j.asking > 0) {
    askingGross = j.asking * (1 + j.acqPct / 100) + sdltCommercial(j.asking);
    totalCostAtAsking = saleCosts + build + fees + cont + other + finance + askingGross;
    profitAtAsking = gdv - totalCostAtAsking;
    rocAtAsking = totalCostAtAsking > 0 ? profitAtAsking / totalCostAtAsking : 0;
    headroom = residualNet - j.asking;
  }

  return {
    nia,
    gia,
    gdv,
    build,
    fees,
    cont,
    cil,
    other,
    saleCosts,
    facility,
    interest,
    arrangement,
    finance,
    targetProfit,
    residualNet,
    landGross,
    totalCost,
    profit,
    poc,
    sdlt,
    askingGross,
    totalCostAtAsking,
    profitAtAsking,
    rocAtAsking,
    headroom,
  };
}

/** Deterministic PRNG (mulberry32) — Monte Carlo runs are reproducible per seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const percentile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * Monte Carlo risk on the appraisal: land is HELD at the base residual (or the
 * fixed land price in profit mode) while sales values and build costs are
 * sampled from normal distributions — the profit/PoC distribution shows what
 * the developer is actually exposed to after committing to the site.
 */
export function monteCarlo(input: AppraisalInput, opts: MonteCarloOptions = {}): MonteCarloResult {
  const iterations = Math.max(50, Math.min(opts.iterations ?? 500, 5000));
  const salesSigma = opts.salesSigma ?? 0.075;
  const buildSigma = opts.buildSigma ?? 0.05;
  const rand = mulberry32(opts.seed ?? 42);
  const normal = () => {
    // Box–Muller
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const base = computeAppraisal(input);
  const landFixed = input.site.mode === 'residual' ? Math.max(base.residualNet, 0) : input.site.landFixed;
  const simInput: AppraisalInput = { ...input, site: { ...input.site, mode: 'profit', landFixed } };
  const targetProfit = (base.gdv * input.targetProfitOnGdvPct) / 100;

  const profits: number[] = [];
  const pocs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const salesMult = Math.max(0.5, 1 + salesSigma * normal());
    const buildMult = Math.max(0.5, 1 + buildSigma * normal());
    const r = computeAppraisal(simInput, { salesMult, buildMult });
    profits.push(r.profit);
    pocs.push(r.poc);
  }
  profits.sort((a, b) => a - b);
  pocs.sort((a, b) => a - b);
  return {
    iterations,
    landFixed,
    profit: {
      p10: percentile(profits, 0.1),
      p50: percentile(profits, 0.5),
      p90: percentile(profits, 0.9),
      mean: profits.reduce((a, b) => a + b, 0) / profits.length,
    },
    poc: { p10: percentile(pocs, 0.1), p50: percentile(pocs, 0.5), p90: percentile(pocs, 0.9) },
    probAtTarget: profits.filter((p) => p >= targetProfit).length / profits.length,
    probLoss: profits.filter((p) => p < 0).length / profits.length,
  };
}

/**
 * Comparables — weighted supported £/ft². Each comp adjusted by the sum of its %
 * adjustments (rounded to whole £, as the prototype does); weight = 1/(1+gross
 * adjustment in points) so less-adjusted evidence counts more.
 */
export function weightedComparables(comps: ComparableInput[]): ComparablesSummary {
  const results = comps.map((c) => {
    const adjs = [c.adjustments.size, c.adjustments.condition, c.adjustments.date, c.adjustments.location];
    const netAdjustment = adjs.reduce((a, b) => a + b, 0);
    const grossAdjustment = adjs.reduce((a, b) => a + Math.abs(b), 0);
    const adjustedPsf = Math.round(c.basePsf * (1 + netAdjustment / 100));
    const weight = 1 / (1 + grossAdjustment);
    return { address: c.address, basePsf: c.basePsf, adjustedPsf, netAdjustment, grossAdjustment, weight };
  });
  const wSum = results.reduce((a, r) => a + r.weight, 0) || 1;
  const supportedPsf = results.reduce((a, r) => a + r.adjustedPsf * r.weight, 0) / wSum;
  const avgGrossAdjustment = results.length
    ? results.reduce((a, r) => a + r.grossAdjustment, 0) / results.length
    : 0;
  const adjusted = results.map((r) => r.adjustedPsf);
  return {
    comps: results,
    supportedPsf,
    avgGrossAdjustment,
    range: {
      lo: adjusted.length ? Math.min(...adjusted) : 0,
      hi: adjusted.length ? Math.max(...adjusted) : 0,
    },
  };
}
