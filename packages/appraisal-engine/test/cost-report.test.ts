import { describe, expect, it } from 'vitest';
import { costRollup } from '../src/cost-report.js';

/**
 * The cost report, which used to measure the packages against themselves.
 *
 * Measured on the demo workspace, Harbour Reach: seven construction packages
 * forecasting £9,877,000 against an appraisal whose build cost is £6,855,195.
 * The screen reported +£167,000 over — the forecast against the sum of the
 * packages' own budget fields — while the card's subtitle read "from current
 * appraisal". The scheme is £3.02m over the cost it was appraised at.
 */

const HARBOUR = [
  { budget: 720_000, committed: 700_000, spent: 500_000, forecast: 712_000 },
  { budget: 1_240_000, committed: 1_240_000, spent: 900_000, forecast: 1_225_000 },
  { budget: 2_860_000, committed: 2_900_000, spent: 1_100_000, forecast: 3_010_000 },
  { budget: 1_150_000, committed: 1_150_000, spent: 300_000, forecast: 1_180_000 },
  { budget: 1_680_000, committed: 1_600_000, spent: 200_000, forecast: 1_650_000 },
  { budget: 1_420_000, committed: 1_400_000, spent: 0, forecast: 1_460_000 },
  { budget: 640_000, committed: 600_000, spent: 0, forecast: 640_000 },
];
const APPRAISED = 6_855_195;

describe('the baseline', () => {
  it('is the appraisal’s construction cost, not the packages’ own budgets', () => {
    const r = costRollup(HARBOUR, { appraisedBuild: APPRAISED });
    expect(r.packageBudgets).toBe(9_710_000);
    expect(r.appraisedBuild).toBe(APPRAISED);
    // the number the screen used to show
    expect(r.forecast - r.packageBudgets).toBe(167_000);
    // the number that is true
    expect(r.variance).toBe(9_877_000 - APPRAISED);
    expect(r.variance).toBeCloseTo(3_021_805, 0);
  });

  it('says how much of the appraised cost has not been packaged yet', () => {
    // negative: the packages already exceed what the scheme was appraised to cost
    expect(costRollup(HARBOUR, { appraisedBuild: APPRAISED }).unallocated).toBeCloseTo(-2_854_805, 0);
    expect(costRollup(HARBOUR.slice(0, 1), { appraisedBuild: APPRAISED }).unallocated).toBe(APPRAISED - 720_000);
  });
});

describe('with nothing to compare', () => {
  it('reports no variance when no appraisal is saved', () => {
    const r = costRollup(HARBOUR, { appraisedBuild: null });
    expect(r.variance).toBeNull();
    expect(r.profitImpact).toBeNull();
    // the packages are still real and still add up
    expect(r.packageBudgets).toBe(9_710_000);
    expect(r.forecast).toBe(9_877_000);
  });

  it('reports no variance when nothing has been costed, but keeps the baseline', () => {
    /**
     * A deal with an appraisal and an empty cost plan has not underrun by its
     * whole build cost. Measured before this guard, on Northgate: a variance of
     * −£4,223,333 and a profit impact of +£4.2m, on a scheme where nobody had
     * entered a single package.
     */
    const r = costRollup([], { appraisedBuild: APPRAISED });
    expect(r.variance).toBeNull();
    expect(r.profitImpact).toBeNull();
    expect(r.appraisedBuild, 'the appraised cost is still worth showing').toBe(APPRAISED);
    expect(r.unallocated).toBe(APPRAISED);
  });
});

describe('what an overrun costs', () => {
  it('is absorbed by contingency before it touches profit', () => {
    const near = [{ budget: 1_000_000, committed: 0, spent: 0, forecast: 1_030_000 }];
    const r = costRollup(near, { appraisedBuild: 1_000_000, contingency: 50_000 });
    expect(r.variance).toBe(30_000);
    expect(r.profitImpact, 'an overrun inside the contingency costs no profit').toBe(0);
  });

  it('comes off the bottom line beyond it', () => {
    const over = [{ budget: 1_000_000, committed: 0, spent: 0, forecast: 1_120_000 }];
    const r = costRollup(over, { appraisedBuild: 1_000_000, contingency: 50_000 });
    expect(r.variance).toBe(120_000);
    expect(r.profitImpact).toBe(-70_000);
  });

  it('hits profit in full where no contingency was set aside', () => {
    const over = [{ budget: 1_000_000, committed: 0, spent: 0, forecast: 1_120_000 }];
    expect(costRollup(over, { appraisedBuild: 1_000_000 }).profitImpact).toBe(-120_000);
  });

  it('returns an underrun in full — it is money back, not negative contingency', () => {
    const under = [{ budget: 1_000_000, committed: 0, spent: 0, forecast: 900_000 }];
    const r = costRollup(under, { appraisedBuild: 1_000_000, contingency: 50_000 });
    expect(r.variance).toBe(-100_000);
    expect(r.profitImpact).toBe(100_000);
  });
});
