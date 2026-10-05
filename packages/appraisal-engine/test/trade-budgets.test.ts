import { describe, expect, it } from 'vitest';
import { tradeBudgets } from '../src/cost-report.js';

/**
 * The cost plan a scheme starts monitoring against, split from the appraisal's
 * own build cost.
 *
 * The claim that matters is EXACTNESS: `seed-depth` asserts a cost plan's
 * budgets sum to `round(build × 100)` pence, and the cost rollup reports the
 * difference between the plan and the appraisal as a variance. A plan that is
 * a few pence short of the cost it was derived from reports an overrun nobody
 * has earned, on the screen a lender pack is built from.
 */
describe('tradeBudgets', () => {
  const trades = [
    { label: 'Substructure', rate: 18 },
    { label: 'Frame', rate: 42 },
    { label: 'Envelope', rate: 30 },
  ];

  it('splits the build cost in proportion to the trade rates', () => {
    // 90 £/ft² over the three; a £900,000 build is 20/46.67/33.33 per cent
    const plan = tradeBudgets(trades, 900_000);
    expect(plan.map((p) => p.label)).toEqual(['Substructure', 'Frame', 'Envelope']);
    expect(plan[0]!.budgetPence).toBe(18_000_000n); // 18/90 of £900k
    expect(plan[1]!.budgetPence).toBe(42_000_000n);
    expect(plan[2]!.budgetPence).toBe(30_000_000n);
  });

  /** The whole point. Not "close to" the appraised cost — equal to it. */
  it('sums to the build cost to the penny, however the shares round', () => {
    for (const build of [900_000, 6_855_195.37, 1_234_567.89, 0.01, 99_999_999.99]) {
      const total = BigInt(Math.round(build * 100));
      const sum = tradeBudgets(trades, build).reduce((a, p) => a + p.budgetPence, 0n);
      expect(sum, `£${build} did not split exactly`).toBe(total);
    }
  });

  /** Awkward on purpose: three equal shares of a figure that will not divide. */
  it('puts the rounding residual on the last package', () => {
    const thirds = [
      { label: 'A', rate: 1 },
      { label: 'B', rate: 1 },
      { label: 'C', rate: 1 },
    ];
    const plan = tradeBudgets(thirds, 0.1); // 10 pence across three
    expect(plan.map((p) => p.budgetPence)).toEqual([3n, 3n, 4n]);
    expect(plan.reduce((a, p) => a + p.budgetPence, 0n)).toBe(10n);
  });

  it('answers nothing for a scheme with no trades', () => {
    expect(tradeBudgets([], 500_000)).toEqual([]);
  });

  /**
   * A zero rate sum cannot arise from an unphased appraisal — it makes `build`
   * zero too — but a phased scheme carries its build in the phases. The figure
   * lands visibly on the last package rather than vanishing.
   */
  it('does not drop the cost when the rates sum to zero', () => {
    const plan = tradeBudgets([{ label: 'A', rate: 0 }, { label: 'B', rate: 0 }], 1_000);
    expect(plan.reduce((a, p) => a + p.budgetPence, 0n)).toBe(100_000n);
    expect(plan[1]!.budgetPence).toBe(100_000n);
  });

  it('is exact on a single trade, which takes the whole cost', () => {
    const plan = tradeBudgets([{ label: 'All in', rate: 185 }], 2_500_000.55);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.budgetPence).toBe(250_000_055n);
  });

  /** A negative rate is not meaningful, but it must not break exactness. */
  it('stays exact even where a rate is nonsense', () => {
    const odd = [
      { label: 'A', rate: 100 },
      { label: 'B', rate: -40 },
      { label: 'C', rate: 60 },
    ];
    const sum = tradeBudgets(odd, 120_000).reduce((a, p) => a + p.budgetPence, 0n);
    expect(sum).toBe(12_000_000n);
  });
});
