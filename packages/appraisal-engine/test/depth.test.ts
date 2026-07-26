import { describe, expect, it } from 'vitest';
import { capitaliseIncome, computeAppraisal, monteCarlo, sdltResidential, type AppraisalInput, type IncomeInput } from '../src/index.js';

const base: AppraisalInput = {
  units: [{ label: 'Apartments', count: 10, area: 750, cap: 400 }],
  efficiency: 85,
  trades: [{ label: 'Build', rate: 180 }],
  profFeePct: 10,
  contingencyPct: 5,
  otherCosts: [{ label: 'S106', amount: 100000 }],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 16, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
  jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
};

describe('sdltResidential — England & NI slice bands (from Apr 2025)', () => {
  it('zero up to £125k', () => {
    expect(sdltResidential(125_000)).toBe(0);
  });
  it('2% slice to £250k', () => {
    expect(sdltResidential(250_000)).toBe(2_500);
  });
  it('5% slice to £925k', () => {
    // 2,500 + 675,000 × 5%
    expect(sdltResidential(925_000)).toBe(2_500 + 33_750);
  });
  it('10% then 12% top slices', () => {
    expect(sdltResidential(1_500_000)).toBe(2_500 + 33_750 + 57_500);
    expect(sdltResidential(2_000_000)).toBe(2_500 + 33_750 + 57_500 + 60_000);
  });
  it('additional-dwelling surcharge adds flat 5% of price', () => {
    expect(sdltResidential(500_000, { additionalDwelling: true })).toBe(sdltResidential(500_000) + 25_000);
  });
});

describe('sales absorption', () => {
  it('derives the sales period from units/month and staggers revenue', () => {
    const R = computeAppraisal({
      ...base,
      finance: { ...base.finance, absorptionUnitsPerMonth: 3 },
    }, { withCash: true });
    // 10 units at 3/month → 4 sales months (3,3,3,1)
    expect(R.salesMonths).toBe(4);
    const rows = R.cash!.rows;
    const revMonths = rows.filter((r) => r.rev > 0).map((r) => r.rev);
    expect(revMonths).toHaveLength(4);
    // months 1-3 equal (3 units), month 4 is a third of that (1 unit)
    expect(revMonths[0]).toBeCloseTo(revMonths[1], 6);
    expect(revMonths[3]).toBeCloseTo(revMonths[0] / 3, 6);
    // total revenue still equals net sales receipts
    const saleNet = R.gdv - R.saleCosts;
    expect(revMonths.reduce((a, b) => a + b, 0)).toBeCloseTo(saleNet, 6);
  });

  it('slower absorption lengthens the hold and increases finance cost', () => {
    const fast = computeAppraisal({ ...base, finance: { ...base.finance, absorptionUnitsPerMonth: 5 } });
    const slow = computeAppraisal({ ...base, finance: { ...base.finance, absorptionUnitsPerMonth: 1 } });
    expect(slow.salesMonths).toBe(10);
    expect(fast.salesMonths).toBe(2);
    expect(slow.finance).toBeGreaterThan(fast.finance);
    // in residual mode extra finance cost comes off the land
    expect(slow.residualNet).toBeLessThan(fast.residualNet);
  });

  it('absent absorption reproduces the classic even spread exactly', () => {
    const classic = computeAppraisal(base, { withCash: true });
    const rows = classic.cash!.rows.filter((r) => r.rev > 0);
    expect(rows).toHaveLength(4);
    expect(rows[0].rev).toBeCloseTo(rows[3].rev, 6);
  });
});

describe('monteCarlo', () => {
  it('is deterministic for a given seed', () => {
    const a = monteCarlo(base, { iterations: 200, seed: 7 });
    const b = monteCarlo(base, { iterations: 200, seed: 7 });
    expect(a.profit.p50).toBe(b.profit.p50);
    expect(a.probAtTarget).toBe(b.probAtTarget);
  });
  it('produces ordered percentiles and sane probabilities', () => {
    const r = monteCarlo(base, { iterations: 500, seed: 42 });
    expect(r.profit.p10).toBeLessThan(r.profit.p50);
    expect(r.profit.p50).toBeLessThan(r.profit.p90);
    expect(r.poc.p10).toBeLessThan(r.poc.p90);
    expect(r.probAtTarget).toBeGreaterThan(0);
    expect(r.probAtTarget).toBeLessThan(1);
    expect(r.probLoss).toBeGreaterThanOrEqual(0);
    expect(r.probLoss).toBeLessThan(0.5);
  });
  it('holds land at the base residual — median profit ≈ target profit', () => {
    const baseR = computeAppraisal(base);
    const r = monteCarlo(base, { iterations: 1000, seed: 42 });
    expect(r.landFixed).toBeCloseTo(baseR.residualNet, 6);
    const target = (baseR.gdv * base.targetProfitOnGdvPct) / 100;
    // symmetric shocks around 1.0 → median profit within ~10% of target
    expect(Math.abs(r.profit.p50 - target) / target).toBeLessThan(0.1);
  });
  it('wider sales volatility widens the profit distribution', () => {
    const narrow = monteCarlo(base, { iterations: 500, seed: 42, salesSigma: 0.03 });
    const wide = monteCarlo(base, { iterations: 500, seed: 42, salesSigma: 0.15 });
    expect(wide.profit.p90 - wide.profit.p10).toBeGreaterThan(narrow.profit.p90 - narrow.profit.p10);
  });
});

// ---- Investment method (RICS) — the held-and-let element ----
// Every figure below is hand-computed from the inputs; see CALCULATIONS.md §investment.
const shed: IncomeInput = {
  lines: [{ label: 'Warehouse', count: 1, area: 10_000, rentPsf: 12 }],
  nonRecoverablePct: 0,
  yieldPct: 6,
  purchaserCostsPct: 6.8,
};

describe('capitaliseIncome — investment method', () => {
  it('capitalises net rent at the years-purchase and nets off purchaser costs', () => {
    const r = capitaliseIncome(shed);
    expect(r.grossRent).toBe(120_000); // 10,000 ft² × £12
    expect(r.netRent).toBe(120_000); // no voids, no non-recoverables
    expect(r.yearsPurchase).toBeCloseTo(100 / 6, 10); // 16.6667 YP
    expect(r.grossCapitalValue).toBeCloseTo(2_000_000, 6); // 120,000 × 16.6667
    expect(r.netCapitalValue).toBeCloseTo(2_000_000 / 1.068, 6); // £1,872,659.18
    expect(r.purchaserCosts).toBeCloseTo(2_000_000 - 2_000_000 / 1.068, 6);
    // the costs-inclusive price is what the yield is measured against
    expect(r.netCapitalValue + r.purchaserCosts).toBeCloseTo(r.capitalValueBeforeCosts, 6);
    expect(r.netInitialYield).toBeCloseTo(0.06, 10);
    expect(r.capitalValuePsf).toBeCloseTo(r.netCapitalValue / 10_000, 10);
    expect(r.blendedRentPsf).toBeCloseTo(12, 10);
  });

  it('stacks voids, non-recoverables and fixed deductions in order', () => {
    const r = capitaliseIncome({
      lines: [{ label: 'Units', count: 2, area: 5_000, rentPsf: 10, voidPct: 5 }],
      nonRecoverablePct: 4,
      annualDeductions: 1_200,
      yieldPct: 5,
      purchaserCostsPct: 6.8,
    });
    expect(r.grossRent).toBe(100_000);
    expect(r.voidAllowance).toBe(5_000); // 5% of gross
    expect(r.nonRecoverable).toBeCloseTo(3_800, 10); // 4% of the 95,000 AFTER voids
    expect(r.deductions).toBe(1_200);
    expect(r.netRent).toBeCloseTo(90_000, 10);
    expect(r.grossCapitalValue).toBeCloseTo(1_800_000, 6); // × YP 20
    expect(r.netCapitalValue).toBeCloseTo(1_800_000 / 1.068, 6); // £1,685,393.26
  });

  it('a let-up void is a capital deduction that lifts the net initial yield above the cap yield', () => {
    const dry = capitaliseIncome({ ...shed, letUpMonths: 0 });
    const wet = capitaliseIncome({ ...shed, letUpMonths: 6 });
    expect(wet.letUpDeduction).toBeCloseTo(60_000, 10); // 6 months of £120k net rent
    expect(wet.capitalValueBeforeCosts).toBeCloseTo(dry.capitalValueBeforeCosts - 60_000, 6);
    expect(wet.netInitialYield).toBeGreaterThan(0.06);
    expect(wet.netInitialYield).toBeCloseTo(120_000 / 1_940_000, 10);
    expect(wet.netCapitalValue).toBeLessThan(dry.netCapitalValue);
  });

  it('defaults purchaser costs to the UK-standard 6.8%', () => {
    const { purchaserCostsPct: _omitted, ...noPc } = shed;
    expect(capitaliseIncome(noPc).netCapitalValue).toBeCloseTo(capitaliseIncome(shed).netCapitalValue, 10);
  });

  it('a non-positive yield does not capitalise — nil value, no Infinity', () => {
    const r = capitaliseIncome({ ...shed, yieldPct: 0 });
    expect(r.netRent).toBe(120_000); // the rent analysis still stands
    expect(r.yearsPurchase).toBe(0);
    expect(r.grossCapitalValue).toBe(0);
    expect(r.netCapitalValue).toBe(0);
    expect(r.netInitialYield).toBe(0);
    expect(Number.isFinite(r.capitalValuePsf)).toBe(true);
  });
});

describe('computeAppraisal — GDV composition with a held element', () => {
  it('is inert when there is no rent roll', () => {
    const R = computeAppraisal(base);
    expect(R.investmentValue).toBe(0);
    expect(R.salesGdv).toBe(R.gdv);
    expect(R.income).toBeUndefined();
  });

  it('adds the capitalised value to GDV and charges disposal costs on the whole', () => {
    const withHold = computeAppraisal({ ...base, income: shed });
    const salesOnly = computeAppraisal(base);
    const cap = capitaliseIncome(shed);
    expect(withHold.salesGdv).toBeCloseTo(salesOnly.gdv, 6);
    expect(withHold.investmentValue).toBeCloseTo(cap.netCapitalValue, 6);
    expect(withHold.gdv).toBeCloseTo(withHold.salesGdv + withHold.investmentValue, 6);
    expect(withHold.income?.netRent).toBe(120_000);
    expect(withHold.saleCosts).toBeCloseTo((withHold.gdv * 2) / 100, 6);
  });

  it('counts the let space in NIA/GIA — you still have to build it', () => {
    const withHold = computeAppraisal({ ...base, income: shed });
    const salesOnly = computeAppraisal(base);
    expect(withHold.nia).toBeCloseTo(salesOnly.nia + 10_000, 6);
    expect(withHold.gia).toBeCloseTo(withHold.nia / 0.85, 6);
    expect(withHold.build).toBeCloseTo(withHold.gia * withHold.buildRate, 6);
    expect(withHold.build).toBeGreaterThan(salesOnly.build);
  });

  it('shocks the held value with sales — sensitivity moves both exits together', () => {
    const flat = computeAppraisal({ ...base, income: shed });
    const up = computeAppraisal({ ...base, income: shed }, { salesMult: 1.1 });
    expect(up.investmentValue).toBeCloseTo(flat.investmentValue * 1.1, 6);
    expect(up.gdv).toBeCloseTo(flat.gdv * 1.1, 6);
  });
});
