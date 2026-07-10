import type {
  AppraisalInput,
  AppraisalResult,
  AutoAppraisalInput,
  AutoAppraisalResult,
  CashflowRow,
  ComparableInput,
  ComparablesSummary,
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

  const nia = input.units.reduce((a, u) => a + u.count * u.area, 0);
  const gdv = input.units.reduce((a, u) => a + u.count * u.area * u.cap, 0) * salesMult;
  const eff = input.efficiency / 100 || 1;
  const gia = eff > 0 ? nia / eff : nia;
  const buildRate = input.trades.reduce((a, t) => a + t.rate, 0) * buildMult;
  const build = buildRate * gia;
  const fees = (build * input.profFeePct) / 100;
  const cont = (build * input.contingencyPct) / 100;
  const otherTotal = input.otherCosts.reduce((a, o) => a + o.amount, 0);
  const saleCosts = (gdv * (input.disposal.agentPct + input.disposal.legalPct)) / 100;

  // ---- monthly drawdown with rolled-up interest ----
  const P = clamp(Math.round(F.periodMonths) || 12, 4, 22);
  // sales period: absorption-derived (units actually selling) or the classic even spread
  const totalUnitCount = input.units.reduce((a, u) => a + u.count, 0);
  const absorption = F.absorptionUnitsPerMonth;
  let sM: number;
  let revShare: number[]; // fraction of net sales revenue arriving in each sales month
  if (absorption && absorption > 0 && totalUnitCount > 0) {
    sM = clamp(Math.ceil(totalUnitCount / absorption), 1, 24);
    revShare = [];
    let remaining = totalUnitCount;
    for (let k = 0; k < sM; k++) {
      const sold = Math.min(absorption, remaining);
      remaining -= sold;
      revShare.push(sold / totalUnitCount);
    }
  } else {
    sM = clamp(Math.round(F.salesMonths) || 1, 1, 8);
    revShare = new Array<number>(sM).fill(1 / sM);
  }
  const constructionTotal = build + fees + cont + otherTotal;
  const totalMonths = P + sM;
  const incs = buildSpendProfile(P, F.spendProfile ?? 'scurve');
  const constrSeries = new Array<number>(totalMonths + 1).fill(0);
  for (let i = 0; i < P; i++) constrSeries[i + 1] = constructionTotal * incs[i];
  const mRate = F.ratePct / 100 / 12;
  const ltcF = F.ltcPct / 100;
  const intSeries = new Array<number>(totalMonths + 1).fill(0);
  let bal = 0;
  let totalInterest = 0;
  let peak = 0;
  let drawn = 0;
  for (let m = 1; m <= P; m++) {
    const intr = bal * mRate;
    intSeries[m] = intr;
    totalInterest += intr;
    const draw = constrSeries[m] * ltcF;
    drawn += draw;
    bal += intr + draw;
    if (bal > peak) peak = bal;
  }
  const saleNet = gdv - saleCosts;
  const revSeries = new Array<number>(totalMonths + 1).fill(0);
  for (let m = P + 1; m <= totalMonths; m++) {
    const intr = bal * mRate;
    intSeries[m] = intr;
    totalInterest += intr;
    bal += intr;
    revSeries[m] = saleNet * revShare[m - P - 1];
    const repay = Math.min(revSeries[m], bal);
    bal -= repay;
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
  const totalCost = saleCosts + build + fees + cont + otherTotal + finance + landGross;
  const equity = landGross + constructionTotal * (1 - ltcF);
  const poc = totalCost > 0 ? profit / totalCost : 0;
  const rogdv = gdv > 0 ? profit / gdv : 0;
  const roe = equity > 0 ? profit / equity : 0;

  const out: AppraisalResult = {
    nia,
    gia,
    gdv,
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
    const cfU = new Array<number>(totalMonths + 1).fill(0);
    cfU[0] = -landGross;
    for (let m = 1; m <= P; m++) cfU[m] = -constrSeries[m];
    for (let m = P + 1; m <= totalMonths; m++) cfU[m] = revSeries[m];
    const cfE = new Array<number>(totalMonths + 1).fill(0);
    cfE[0] = -landGross;
    for (let m = 1; m <= P; m++) cfE[m] = -constrSeries[m] * (1 - ltcF);
    let debtOut = drawn + totalInterest;
    for (let m = P + 1; m <= totalMonths; m++) {
      const repay = Math.min(revSeries[m], debtOut);
      debtOut -= repay;
      cfE[m] += revSeries[m] - repay;
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
