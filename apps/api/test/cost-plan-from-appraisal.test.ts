import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Starting cost monitoring at all.
 *
 * `cost.upsertPackage` is the browser's only writer and its single call site is
 * the contractor dropdown, which sends no figures; creating demands a name, a
 * budget and a forecast. Outside the demo seed and the sample-data generator the
 * only other writer is the Xero sync. So a firm with no accounting integration
 * could not produce a cost plan on any deal — and the empty state told them to
 * go to the appraisal to make one, where nothing creates a package. The
 * derivation existed only in `demo-seed-depth.ts`, which is to say only where a
 * customer could not reach it.
 *
 * The figure that matters is the SUM. `cost-report.ts` reports the difference
 * between the plan and the appraisal as a variance, so a plan that is pennies
 * short of the cost it came from reports an overrun nobody has earned.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const APPRAISAL_INPUT = {
  units: [{ label: '2-bed apartments', count: 12, area: 755, cap: 415 }],
  efficiency: 83,
  // three trades with rates that will not divide cleanly
  trades: [
    { label: 'Substructure', rate: 37 },
    { label: 'Superstructure', rate: 113 },
    { label: 'Fit-out', rate: 61 },
  ],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('CostPlan');
}, 120_000);

describe('before an appraisal exists', () => {
  it('refuses, and says which thing to do first', async () => {
    await expect(caller().cost.createPlanFromAppraisal({ dealId: T.dealId } as never)).rejects.toThrow(
      /Save an appraisal first/,
    );
    expect(await prisma.costPackage.count({ where: { dealId: T.dealId } })).toBe(0);
  });
});

describe('with an appraisal saved', () => {
  let build: number;

  beforeAll(async () => {
    const saved = (await caller().appraisal.save({ dealId: T.dealId, input: APPRAISAL_INPUT } as never)) as {
      result: { build: number };
    };
    build = saved.result.build;
  });

  it('derives one package per trade, named for the trade', async () => {
    const r = (await caller().cost.createPlanFromAppraisal({ dealId: T.dealId } as never)) as { created: number };
    expect(r.created).toBe(3);
    const rows = await prisma.costPackage.findMany({ where: { dealId: T.dealId }, orderBy: { name: 'asc' } });
    expect(rows.map((p) => p.name)).toEqual(['Fit-out', 'Substructure', 'Superstructure']);
  });

  /** The claim the cost report rests on. Equal to the appraised build, not near it. */
  it('sums to the appraisal’s own build cost, to the penny', async () => {
    const rows = await prisma.costPackage.findMany({ where: { dealId: T.dealId } });
    const sum = rows.reduce((a, p) => a + p.budget, 0n);
    expect(sum).toBe(BigInt(Math.round(build * 100)));
  });

  /**
   * Opening forecast EQUALS budget, so the variance the cost report derives is
   * zero until somebody enters what a package actually costs. A plan that
   * opened with a forecast of nothing would read as the whole build saved.
   */
  it('opens with no variance, nothing committed and nothing spent', async () => {
    const rows = await prisma.costPackage.findMany({ where: { dealId: T.dealId } });
    for (const p of rows) {
      expect(p.forecast, p.name).toBe(p.budget);
      expect(p.committed, p.name).toBe(0n);
      expect(p.spent, p.name).toBe(0n);
      expect(p.progressPct, p.name).toBe(0);
    }
    /**
     * Under a penny, not exactly zero, and that is the right claim: the plan is
     * stored as integer pence (`round(build × 100)`) while the rollup reports in
     * pounds against the engine's float `build`, so the two agree to within the
     * rounding the database demands. Asserting an exact zero would be asserting
     * that money is not stored as pence.
     */
    const report = (await caller().cost.packages(T.dealId as never)) as { rollup: { variance: number | null } };
    expect(Math.abs(report.rollup.variance!)).toBeLessThan(0.01);
  });

  /** Two plans on one deal would double the baseline the variance is measured against. */
  it('refuses to lay a second plan over the first', async () => {
    await expect(caller().cost.createPlanFromAppraisal({ dealId: T.dealId } as never)).rejects.toThrow(
      /already has a cost plan/,
    );
    expect(await prisma.costPackage.count({ where: { dealId: T.dealId } })).toBe(3);
  });

  it('writes the derivation to the audit trail', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { dealId: T.dealId, action: { contains: 'cost plan' } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toMatch(/3 packages/);
  });
});

describe('isolation', () => {
  it('refuses another firm’s deal', async () => {
    const other = await makeTenant('CostPlanOther');
    await expect(caller().cost.createPlanFromAppraisal({ dealId: other.dealId } as never)).rejects.toThrow(
      /NOT_FOUND|not found/i,
    );
    expect(await prisma.costPackage.count({ where: { dealId: other.dealId } })).toBe(0);
  });
});
