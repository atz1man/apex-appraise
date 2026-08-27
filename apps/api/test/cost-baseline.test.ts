import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * What the cost report is measured against.
 *
 * The rollup's "appraised" figure was the sum of the packages' own budget
 * fields, so the report compared the packages to themselves — while the card's
 * subtitle read "from current appraisal", the panel header read "Forecast vs
 * appraised budget", the stat was "Variance to appraisal", and the page copy
 * said budgets "all flow from the appraisal". The appraisal row was fetched on
 * that request and used for nothing but a boolean.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const APPRAISAL_INPUT = {
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate: 110 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

type Rollup = {
  rollup: {
    packageBudgets: number;
    forecast: number;
    appraisedBuild: number | null;
    contingency: number | null;
    variance: number | null;
    profitImpact: number | null;
    unallocated: number | null;
  };
  hasAppraisal: boolean;
};

const addPackage = (over: Record<string, unknown>) =>
  caller().cost.upsertPackage({
    dealId: T.dealId, name: 'Superstructure', budget: 1_000_000, committed: 0, spent: 0, forecast: 1_000_000,
    ...over,
  } as never);

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Costs');
}, 120_000);

describe('with no appraisal saved', () => {
  it('reports no variance rather than measuring against nothing', async () => {
    await addPackage({ forecast: 1_200_000 });
    const r = (await caller().cost.packages(T.dealId as never)) as Rollup;
    expect(r.hasAppraisal).toBe(false);
    expect(r.rollup.appraisedBuild).toBeNull();
    expect(r.rollup.variance, 'a variance was computed with no baseline').toBeNull();
    expect(r.rollup.profitImpact).toBeNull();
    // the packages themselves are still real
    expect(r.rollup.packageBudgets).toBe(1_000_000);
    expect(r.rollup.forecast).toBe(1_200_000);
  });
});

describe('with an appraisal saved', () => {
  let build: number;

  beforeAll(async () => {
    const saved = (await caller().appraisal.save({ dealId: T.dealId, input: APPRAISAL_INPUT } as never)) as {
      result: { build: number; cont: number };
    };
    build = saved.result.build;
    expect(build).toBeGreaterThan(0);
  });

  it('measures the forecast against the appraisal’s construction cost', async () => {
    const r = (await caller().cost.packages(T.dealId as never)) as Rollup;
    expect(r.rollup.appraisedBuild).toBeCloseTo(build, 6);
    expect(r.rollup.variance).toBeCloseTo(1_200_000 - build, 6);
    // and NOT against the packages' own budgets, which is what it used to do
    expect(r.rollup.variance).not.toBeCloseTo(1_200_000 - r.rollup.packageBudgets, 6);
  });

  it('carries the appraisal’s contingency through, so an overrun inside it costs no profit', async () => {
    const r = (await caller().cost.packages(T.dealId as never)) as Rollup;
    expect(r.rollup.contingency).toBeGreaterThan(0);
  });

  it('says how much of the appraised cost is not yet packaged', async () => {
    const r = (await caller().cost.packages(T.dealId as never)) as Rollup;
    expect(r.rollup.unallocated).toBeCloseTo(build - 1_000_000, 6);
  });

  it('follows the appraisal when it is revised', async () => {
    // the whole point of a baseline: re-tender the scheme and the report moves
    const before = (await caller().cost.packages(T.dealId as never)) as Rollup;
    await caller().appraisal.save({
      dealId: T.dealId,
      input: { ...APPRAISAL_INPUT, trades: [{ label: 'Superstructure', rate: 150 }] },
      asNewVersion: true,
      label: 'Post-tender',
    } as never);
    const after = (await caller().cost.packages(T.dealId as never)) as Rollup;
    expect(after.rollup.appraisedBuild!).toBeGreaterThan(before.rollup.appraisedBuild!);
    expect(after.rollup.variance!).toBeLessThan(before.rollup.variance!);
  });
});

describe('with an appraisal but no cost plan', () => {
  it('reports no variance, and does not call it an underrun of the whole build', async () => {
    const other = await makeTenant('Uncosted');
    const saved = (await callerFor(other.principal).appraisal.save({
      dealId: other.dealId, input: APPRAISAL_INPUT,
    } as never)) as { result: { build: number } };

    const r = (await callerFor(other.principal).cost.packages(other.dealId as never)) as Rollup;
    expect(r.hasAppraisal).toBe(true);
    expect(r.rollup.variance).toBeNull();
    expect(r.rollup.profitImpact).toBeNull();
    // the baseline is still worth showing on the card
    expect(r.rollup.appraisedBuild).toBeCloseTo(saved.result.build, 6);
  });
});
