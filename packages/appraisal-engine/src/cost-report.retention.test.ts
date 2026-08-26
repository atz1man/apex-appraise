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

describe('retention held', () => {
  it('is five percent of what is under contract, not of the budget or the spend', () => {
    const r = costRollup([pkg({ committed: 200_000, budget: 500_000, spent: 10_000 })], { appraisedBuild: 500_000 });
    expect(r.retentionHeld).toBe(10_000);
  });

  it('follows each package’s own rate, not one rate for the job', () => {
    const r = costRollup(
      [pkg({ committed: 100_000, retentionPct: 5 }), pkg({ committed: 100_000, retentionPct: 3 })],
      { appraisedBuild: 500_000 },
    );
    expect(r.retentionHeld).toBe(8_000);
  });

  it('is nothing on a package the ledger created, which carries no retention', () => {
    // syncXero writes retentionPct: 0 — the accounting feed knows what was
    // invoiced, not what a contract withholds
    const r = costRollup([pkg({ committed: 250_000, retentionPct: 0 })], { appraisedBuild: 500_000 });
    expect(r.retentionHeld).toBe(0);
  });

  it('is the same rule per contractor as it is per deal', () => {
    const packages = [pkg({ committed: 120_000, retentionPct: 5 }), pkg({ committed: 60_000, retentionPct: 2.5 })];
    const perDeal = costRollup(packages, { appraisedBuild: 500_000 });
    const perContractor = contractorTotals(packages);
    expect(perContractor.retention).toBe(perDeal.retentionHeld);
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
