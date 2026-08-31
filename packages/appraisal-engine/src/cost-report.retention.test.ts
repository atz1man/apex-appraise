import { describe, expect, it } from 'vitest';
import { contractorTotals, costRollup } from './cost-report.js';

/**
 * The cost figures that were being worked out on the screens.
 *
 * `ALL money maths lives here` is the instruction this package exists for, and
 * `costRollup` already owns the variance against the appraisal. Four figures
 * beside it did not: retention held, certificates issued, the progress-weighted
 * spend and the drawdown percentage were computed in `CostMonitoring.tsx`, and
 * the retention rule was ALSO written in `ops.ts` for the contractor list.
 *
 * Retention is real money withheld from a builder — it is a liability the firm
 * owes and the contractor is chasing. Written twice, in two languages of the
 * codebase, it is one edit away from the two screens disagreeing about what is
 * owed, which is the shape `4c4624e` found in the deposit rule (five copies,
 * five answers) and `c1631ab` found in the scenario compare.
 */

const pkg = (over: Partial<Parameters<typeof costRollup>[0][number]> = {}) => ({
  budget: 100_000,
  committed: 80_000,
  spent: 40_000,
  forecast: 105_000,
  retentionPct: 5,
  certificates: 2,
  ...over,
});

/**
 * WHICH money the percentage is taken of, which is where this was wrong.
 *
 * The rule was `committed × retentionPct`: the percentage of the whole contract
 * sum, from the day the package was created. That is the retention at
 * COMPLETION. The screen printed it under "Retention held", on a panel whose
 * every other line is a to-date figure — build programme, spend drawn,
 * certificates issued — and the contractor card printed it in amber beside a
 * certificate count.
 *
 * Retention is deducted from each interim valuation of work properly executed,
 * so nothing is withheld from a contractor who has not been paid. Measured on
 * the demo workspace, Harbour Reach: £407,500 reported held against £283,850
 * actually deducted, 44% over — and External works showed £4,000 withheld from
 * a builder with £0 paid and zero certificates issued.
 *
 * Both figures are now returned, because the old one was useful under an honest
 * heading rather than wrong in itself.
 */
describe('retention held', () => {
  it('is taken of what has been certified, not of the whole contract sum', () => {
    const r = costRollup([pkg({ committed: 200_000, budget: 500_000, spent: 40_000 })], { appraisedBuild: 500_000 });
    expect(r.retentionHeld, 'the contract sum was used, so the liability is five times what is owed').toBe(2_000);
    expect(r.retentionAtCompletion, 'the whole-contract figure went missing rather than moving').toBe(10_000);
  });

  /**
   * The line the demo workspace made unarguable: a package under contract that
   * nobody has paid a penny against. There is no payment for a deduction to
   * have come out of.
   */
  it('is nothing at all on a package that has never been paid', () => {
    const r = costRollup([pkg({ committed: 80_000, spent: 0, certificates: 0 })], { appraisedBuild: 500_000 });
    expect(r.retentionHeld, 'money withheld from a contractor who has never been paid').toBe(0);
    // and the eventual liability is still reported — it is real, just not yet held
    expect(r.retentionAtCompletion).toBe(4_000);
  });

  /**
   * `retentionPct` is OPTIONAL on `CostPackageLike`, so the default is a rule of
   * its own and nothing exercised it — a mutation changing `?? 0` to `?? 5`
   * passed the whole file. It has to be 0: a caller that did not say what the
   * contract withholds has not told us there is a retention, and assuming the
   * common 5% would invent a liability out of a missing field.
   */
  it('assumes no retention when a package does not declare a rate', () => {
    const noRate = { budget: 100_000, committed: 80_000, spent: 40_000, forecast: 105_000 };
    const r = costRollup([noRate], { appraisedBuild: 500_000 });
    expect(r.retentionHeld, 'a rate nobody stated was assumed').toBe(0);
    expect(r.retentionAtCompletion).toBe(0);
    expect(contractorTotals([noRate]).retention).toBe(0);
  });

  it('follows each package’s own rate, not one rate for the job', () => {
    const r = costRollup(
      [pkg({ spent: 100_000, retentionPct: 5 }), pkg({ spent: 100_000, retentionPct: 3 })],
      { appraisedBuild: 500_000 },
    );
    expect(r.retentionHeld).toBe(8_000);
  });

  it('is nothing on a package the ledger created, which carries no retention', () => {
    // syncXero writes retentionPct: 0 — the accounting feed knows what was
    // invoiced, not what a contract withholds
    const r = costRollup([pkg({ committed: 250_000, spent: 250_000, retentionPct: 0 })], { appraisedBuild: 500_000 });
    expect(r.retentionHeld).toBe(0);
    expect(r.retentionAtCompletion).toBe(0);
  });

  /**
   * Certifying past the contract sum is a variation, not an error, and £X
   * genuinely deducted is owed whatever the original figure said. Capping the
   * held figure at the completion figure would understate a real liability to
   * keep two numbers tidy.
   */
  it('does not cap what has been withheld at what the contract said', () => {
    const r = costRollup([pkg({ committed: 500_000, spent: 600_000, retentionPct: 5 })], { appraisedBuild: 500_000 });
    expect(r.retentionHeld).toBe(30_000);
    expect(r.retentionAtCompletion).toBe(25_000);
  });

  it('is the same rule per contractor as it is per deal', () => {
    const packages = [
      pkg({ committed: 120_000, spent: 60_000, retentionPct: 5 }),
      pkg({ committed: 60_000, spent: 20_000, retentionPct: 2.5 }),
    ];
    const perDeal = costRollup(packages, { appraisedBuild: 500_000 });
    const perContractor = contractorTotals(packages);
    expect(perContractor.retention).toBe(perDeal.retentionHeld);
    expect(perContractor.retentionAtCompletion).toBe(perDeal.retentionAtCompletion);
    /**
     * Discriminating: the two assertions above hold if BOTH sides carry the
     * same wrong rule, which is the state this file was written to prevent but
     * not the state it was written to detect. Pinning the value as well means a
     * contractor card that reverts to the contract sum fails here even though
     * it still agrees with a deal rollup that reverted with it.
     */
    expect(perContractor.retention, 'both sides agree — on the contract sum').toBe(3_500);
    expect(perContractor.contractValue).toBe(180_000);
    expect(perContractor.certificates).toBe(4);
  });
});

describe('programme and drawdown', () => {
  it('weights progress by what each package is worth, not by package count', () => {
    /**
     * A £900k package at 10% and a £100k package at 100% is a job barely
     * started. Averaging the percentages says 55%.
     */
    const r = costRollup(
      [pkg({ budget: 900_000, progressPct: 10 }), pkg({ budget: 100_000, progressPct: 100 })],
      { appraisedBuild: 1_000_000 },
    );
    expect(r.weightedProgressPct).toBe(19);
  });

  it('reports drawdown against the forecast, which is what will actually be spent', () => {
    const r = costRollup([pkg({ spent: 50_000, forecast: 200_000 })], { appraisedBuild: 500_000 });
    expect(r.drawdownPct).toBe(25);
  });

  it('says nothing rather than zero when there is nothing to divide by', () => {
    const empty = costRollup([], { appraisedBuild: 500_000 });
    expect(empty.weightedProgressPct).toBeNull();
    expect(empty.drawdownPct).toBeNull();
    expect(empty.retentionHeld).toBe(0);

    // a costed job that has drawn nothing is 0%, which is a fact, not an absence
    const unstarted = costRollup([pkg({ spent: 0, forecast: 100_000, progressPct: 0 })], { appraisedBuild: 500_000 });
    expect(unstarted.drawdownPct).toBe(0);
    expect(unstarted.weightedProgressPct).toBe(0);
  });
});
