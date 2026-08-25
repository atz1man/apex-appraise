import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The book, as a lender sees it. The engine's arithmetic is tested in the engine;
 * what matters here is that the right deals are in it, from the right firm, with
 * a facility that agrees with the appraisal.
 */

let A: Tenant;
let B: Tenant;

const input = (rate = 120) => ({
  units: [{ label: 'Units', count: 10, area: 800, cap: 400 }],
  efficiency: 85,
  trades: [{ label: 'Build', rate }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Book');
  B = await makeTenant('Rival');
  await callerFor(A.principal).appraisal.save({ dealId: A.dealId, input: input(), label: 'Base' } as never);
  await callerFor(B.principal).appraisal.save({ dealId: B.dealId, input: input(), label: 'Theirs' } as never);
}, 120_000);

describe('portfolio exposure', () => {
  it('carries the facility the appraisal actually produces', async () => {
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ dealId: string; facility: number }>;
      totals: { facility: number; deals: number };
    };
    expect(e.positions).toHaveLength(1);
    // the book agrees with the deal it sums — checked against the engine's own
    // figure for the same appraisal, not a stored one
    const appraisal = (await callerFor(A.principal).appraisal.getCurrent(A.dealId)) as { result: { facility: number } };
    expect(e.positions[0]!.facility).toBeCloseTo(appraisal.result.facility, 6);
    expect(e.totals.facility).toBeCloseTo(appraisal.result.facility, 6);
  });

  it('never includes another firm’s lending', async () => {
    const e = (await callerFor(A.principal).deals.exposure()) as { positions: Array<{ dealId: string }> };
    expect(e.positions.map((p) => p.dealId)).toEqual([A.dealId]);
    expect(e.positions.map((p) => p.dealId)).not.toContain(B.dealId);
  });

  it('leaves out a deal with no appraisal rather than padding the book with a zero', async () => {
    await prisma.deal.create({
      data: { orgId: A.orgId, name: 'Just a prospect', address: '1 Nowhere', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'SOURCING' },
    });
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ name: string }>;
      byRegion: Array<{ key: string; share: number }>;
    };
    // a prospect is not a position; counting it would understate every
    // concentration by inflating the denominator
    expect(e.positions.map((p) => p.name)).not.toContain('Just a prospect');
    expect(e.byRegion.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 10);
  });

  it('counts committed spend as drawn', async () => {
    await callerFor(A.principal).cost.upsertPackage({
      dealId: A.dealId, name: 'Groundworks', budget: 500_000, committed: 250_000, spent: 100_000, forecast: 500_000, retentionPct: 5,
    } as never);
    const e = (await callerFor(A.principal).deals.exposure()) as {
      totals: { drawn: number; undrawn: number; utilisation: number };
    };
    expect(e.totals.drawn).toBe(250_000);
    expect(e.totals.utilisation).toBeGreaterThan(0);
    expect(e.totals.undrawn).toBeGreaterThan(0);
  });
});

describe('drawdown against works', () => {
  it('judges spend on the works done, not on the calendar', async () => {
    // half the money committed against a quarter of the works
    await callerFor(A.principal).cost.upsertPackage({
      dealId: A.dealId, name: 'Frame', budget: 1_000_000, committed: 500_000, spent: 400_000, forecast: 1_000_000, retentionPct: 5,
    } as never);
    await prisma.costPackage.updateMany({ where: { dealId: A.dealId }, data: { progressPct: 25 } });

    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ dealId: string; drawdown: { status: string; varianceOnProgress: number } | null }>;
    };
    const pos = e.positions.find((p) => p.dealId === A.dealId)!;
    expect(pos.drawdown).not.toBeNull();
    expect(pos.drawdown!.status).toBe('overspending');
    expect(pos.drawdown!.varianceOnProgress).toBeGreaterThan(0);
  });

  it('reports nothing rather than a false clean bill when there is no cost monitoring', async () => {
    const fresh = await makeTenant('NoCosts');
    await callerFor(fresh.principal).appraisal.save({ dealId: fresh.dealId, input: input(), label: 'Base' } as never);
    const e = (await callerFor(fresh.principal).deals.exposure()) as {
      positions: Array<{ drawdown: unknown }>;
    };
    // a 0%-complete reading would report this as underspending, which is a
    // finding about nothing
    expect(e.positions[0]!.drawdown).toBeNull();
  });
});

describe('facility covenants', () => {
  it('tests nothing until the firm sets its own limits', async () => {
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ covenants: { untested: boolean; tests: unknown[] } }>;
    };
    // no limits saved: the ratios exist, but nothing is called a breach
    expect(e.positions[0]!.covenants.untested).toBe(true);
    expect(e.positions[0]!.covenants.tests).toEqual([]);
  });

  it('tests against the limits the firm actually saved, and names the breach', async () => {
    const policy = (await callerFor(A.principal).org.policy()) as Record<string, unknown>;
    await callerFor(A.principal).org.savePolicy({
      ...policy,
      // the stamp it just read — the panel now sends this so a second admin's
      // save cannot silently restore seventeen clauses
      expectedUpdatedAt: policy.updatedAt,
      // deliberately tight, so the seeded deal breaches
      covLtgdvMaxPct: 1,
      covLtcMaxPct: null,
      covMinProfitOnCostPct: null,
    } as never);

    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ covenants: { untested: boolean; breaches: Array<{ key: string; headroomPts: number }> } }>;
    };
    const c = e.positions[0]!.covenants;
    expect(c.untested).toBe(false);
    expect(c.breaches.map((b) => b.key)).toEqual(['ltgdv']);
    // negative headroom, so the panel can say by how much
    expect(c.breaches[0]!.headroomPts).toBeLessThan(0);
  });

  it('lets a covenant be cleared again', async () => {
    const policy = (await callerFor(A.principal).org.policy()) as Record<string, unknown>;
    await callerFor(A.principal).org.savePolicy({
      ...policy,
      expectedUpdatedAt: policy.updatedAt,
      covLtgdvMaxPct: null,
    } as never);
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ covenants: { untested: boolean } }>;
    };
    // a covenant that cannot be removed is a covenant nobody will risk setting
    expect(e.positions[0]!.covenants.untested).toBe(true);
  });
});
