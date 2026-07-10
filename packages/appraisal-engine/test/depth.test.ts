import { describe, expect, it } from 'vitest';
import { computeAppraisal, monteCarlo, sdltResidential, type AppraisalInput } from '../src/index.js';

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
