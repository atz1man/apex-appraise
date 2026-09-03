import { beforeAll, describe, expect, it } from 'vitest';
import { computeAppraisal } from '@apex/appraisal-engine';
import { appraisalRowToEngineInput } from '../src/mappers.js';
import { quarterOf } from '../src/benchmark-feed.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * How the benchmark pool grows.
 *
 * It grew by hand — a Contribute button, one deal at a time — and what it
 * contributed was the CURRENT appraisal whatever its review state, so an
 * unreviewed draft could sit in a median other firms read as market evidence.
 * A consenting firm that pressed nothing contributed nothing.
 *
 * Now the events that make a figure the firm's committed position feed the pool
 * and nothing else does: approval contributes an appraisal's ratios, completion
 * contributes a scheme's out-turn build cost from certified spend, and opting
 * in backfills everything already signed off. `benchmark-feed-sweep.test.ts`
 * proves no approval or completion path skips the feed; this file proves what
 * the feed does when it is reached.
 */

const input = (rate = 110) => ({
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

const admin = (t: Tenant) => callerFor({ ...t.principal, role: 'ADMIN' });
const consent = (t: Tenant, on: boolean) =>
  prisma.organisation.update({ where: { id: t.orgId }, data: { contributesBenchmarks: on, plan: 'ENTERPRISE' } });
const points = (orgId: string, dealId?: string) =>
  prisma.benchmarkPoint.findMany({
    where: { orgId, source: 'contributed', ...(dealId ? { dealId } : {}) },
    orderBy: [{ dealId: 'asc' }, { metric: 'asc' }],
  });
const current = (dealId: string) => prisma.appraisal.findFirstOrThrow({ where: { dealId, isCurrent: true } });

/**
 * Save as a NEW version once the deal has one: `save` edits the current row in
 * place otherwise, which needs the stamp and is refused outright on an approved
 * row. A fresh version under its own label is what a valuer does after a
 * sign-off, and it is the row the feed has to distinguish from the signed one.
 */
const save = async (t: Tenant, dealId: string, label: string, rate: number) => {
  const asNewVersion = (await prisma.appraisal.count({ where: { dealId } })) > 0;
  await admin(t).appraisal.save({ dealId, input: input(rate), label, asNewVersion } as never);
};

/** save a version and drive it through review to approval; returns the approved row */
const approve = async (t: Tenant, dealId: string, label: string, rate = 110) => {
  await save(t, dealId, label, rate);
  const v = await current(dealId);
  await admin(t).appraisal.submitForReview({ versionId: v.id });
  await admin(t).appraisal.review({ versionId: v.id, decision: 'approve' });
  return prisma.appraisal.findUniqueOrThrow({ where: { id: v.id } });
};

const giaOf = (row: Awaited<ReturnType<typeof current>>) => computeAppraisal(appraisalRowToEngineInput(row)).gia;

let A: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Feed');
  await consent(A, true);
}, 120_000);

describe('approval', () => {
  it('a draft contributes nothing; approval contributes three ratios, filed under the approval quarter', async () => {
    await save(A, A.dealId, 'Draft', 110);
    expect(await points(A.orgId), 'a draft entered the pool').toEqual([]);

    const approved = await approve(A, A.dealId, 'Signed');
    const rows = await points(A.orgId, A.dealId);
    expect(rows.map((r) => r.metric)).toEqual(['buildPsf', 'gdvPsf', 'poc']);
    for (const r of rows) {
      expect(r.period).toBe(quarterOf(approved.reviewedAt!));
      expect(r.region).toBe('South West');
      expect(r.useClass).toBe('RESIDENTIAL');
    }
    // the point carries the rate the engine computed for the SIGNED version
    expect(rows.find((r) => r.metric === 'buildPsf')!.value).toBe(computeAppraisal(appraisalRowToEngineInput(approved)).buildRate);

    const ev = await prisma.activityEvent.findFirst({ where: { orgId: A.orgId, action: 'contributed to benchmark' } });
    expect(ev, 'the contribution was not written down').toBeTruthy();
    expect(ev!.target).toContain('from “Signed”');
    expect(ev!.dealId).toBe(A.dealId);
  });

  it('a second approval in the same quarter replaces the deal’s points rather than stacking them', async () => {
    const before = (await points(A.orgId, A.dealId)).find((r) => r.metric === 'buildPsf')!.value;
    await approve(A, A.dealId, 'Revised', 150);
    const rows = await points(A.orgId, A.dealId);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.metric === 'buildPsf')!.value).not.toBe(before);
  });

  it('a firm that has not consented contributes nothing at approval', async () => {
    const B = await makeTenant('Silent');
    await consent(B, false);
    await approve(B, B.dealId, 'Signed');
    expect(await points(B.orgId)).toEqual([]);
    expect(await prisma.activityEvent.count({ where: { orgId: B.orgId, action: 'contributed to benchmark' } })).toBe(0);
  });
});

describe('the manual button', () => {
  it('contributes the latest APPROVED version, never the current draft', async () => {
    const C = await makeTenant('Manual');
    await consent(C, true);
    await save(C, C.dealId, 'Only a draft', 110);
    await expect(admin(C).benchmarks.contribute(C.dealId as never)).rejects.toThrow(/Approve an appraisal first/);
    expect(await points(C.orgId)).toEqual([]);

    const approved = await approve(C, C.dealId, 'Signed', 120);
    // the CURRENT row is now a new draft at a rate nobody has signed off
    await save(C, C.dealId, 'Wild draft', 400);
    expect((await current(C.dealId)).reviewStatus).toBe('draft');

    await admin(C).benchmarks.contribute(C.dealId as never);
    const build = (await points(C.orgId, C.dealId)).find((r) => r.metric === 'buildPsf')!.value;
    expect(build).toBe(computeAppraisal(appraisalRowToEngineInput(approved)).buildRate);
    expect(build).not.toBe(computeAppraisal(appraisalRowToEngineInput(await current(C.dealId))).buildRate);
  });
});

describe('completion', () => {
  it('contributes the out-turn from certified spend, and a later approval leaves it standing', async () => {
    const D = await makeTenant('Complete');
    await consent(D, true);
    const approved = await approve(D, D.dealId, 'Signed');
    await prisma.costPackage.createMany({
      data: [
        { orgId: D.orgId, dealId: D.dealId, name: 'Substructure', budget: 1_000_000_00n, forecast: 1_000_000_00n, spent: 1_500_000_00n },
        { orgId: D.orgId, dealId: D.dealId, name: 'Frame', budget: 1_000_000_00n, forecast: 1_000_000_00n, spent: 500_000_00n },
      ],
    });
    await admin(D).deals.setStage({ id: D.dealId, stage: 'COMPLETED' } as never);

    const out = (await points(D.orgId, D.dealId)).find((r) => r.metric === 'outturnPsf');
    expect(out, 'completion contributed no out-turn').toBeTruthy();
    expect(out!.value).toBeCloseTo(2_000_000 / giaOf(approved), 6);
    const ev = await prisma.activityEvent.findFirst({ where: { orgId: D.orgId, action: 'contributed out-turn to benchmark' } });
    expect(ev!.target).toMatch(/£\d+\/ft² certified/);

    // approving a revised version in the same quarter replaces the three
    // appraisal points and must not erase the out-turn beside them
    await approve(D, D.dealId, 'Final account', 130);
    const after = await points(D.orgId, D.dealId);
    expect(after.map((r) => r.metric)).toEqual(['buildPsf', 'gdvPsf', 'outturnPsf', 'poc']);
  });

  it('contributes no out-turn when nothing was certified, or nothing was ever approved', async () => {
    const E = await makeTenant('Uncosted');
    await consent(E, true);
    await approve(E, E.dealId, 'Signed');
    await admin(E).deals.setStage({ id: E.dealId, stage: 'COMPLETED' } as never);
    // £0 certified is a scheme whose costs were recorded elsewhere, not one built for nothing
    expect((await points(E.orgId)).map((r) => r.metric)).toEqual(['buildPsf', 'gdvPsf', 'poc']);

    const F = await makeTenant('Unsigned');
    await consent(F, true);
    await save(F, F.dealId, 'Draft', 110);
    await prisma.costPackage.create({
      data: { orgId: F.orgId, dealId: F.dealId, name: 'Frame', budget: 1_000_000_00n, forecast: 1_000_000_00n, spent: 900_000_00n },
    });
    await admin(F).deals.setStage({ id: F.dealId, stage: 'COMPLETED' } as never);
    // no area anyone signed off to divide by
    expect(await points(F.orgId)).toEqual([]);
  });
});

describe('opting in', () => {
  it('backfills every deal already approved, and the out-turn of every completed one', async () => {
    const G = await makeTenant('Latecomer');
    await consent(G, false);
    const old = await approve(G, G.dealId, 'Signed');
    // approved a long time ago — the point belongs to THAT quarter, not to the
    // quarter the firm happened to opt in
    await prisma.appraisal.update({ where: { id: old.id }, data: { reviewedAt: new Date('2025-02-01') } });
    // certified spend on a scheme still in construction is not an out-turn
    await prisma.costPackage.create({
      data: { orgId: G.orgId, dealId: G.dealId, name: 'Groundworks', budget: 500_000_00n, forecast: 500_000_00n, spent: 400_000_00n },
    });
    const second = await prisma.deal.create({
      // A POSTCODE, because the pool files by region and a deal it cannot place
      // contributes nothing. This fixture used to carry an invented street and
      // no postcode, and the feed filed it under the South West along with
      // everything else it could not read.
      data: { orgId: G.orgId, name: 'Latecomer Quay', address: '2 Latecomer Road', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'CONSTRUCTION' },
    });
    await approve(G, second.id, 'Signed');
    await prisma.costPackage.create({
      data: { orgId: G.orgId, dealId: second.id, name: 'Frame', budget: 1_000_000_00n, forecast: 1_000_000_00n, spent: 1_200_000_00n },
    });
    await admin(G).deals.setStage({ id: second.id, stage: 'COMPLETED' } as never);
    // nothing so far: consent was off through all of it
    expect(await points(G.orgId)).toEqual([]);

    const res = (await admin(G).benchmarks.setContribution({ enabled: true } as never)) as { contributed: number };
    expect(res.contributed).toBe(2);
    const first = await points(G.orgId, G.dealId);
    expect(first.map((r) => r.metric)).toEqual(['buildPsf', 'gdvPsf', 'poc']);
    for (const r of first) expect(r.period).toBe('2025-Q1');
    expect((await points(G.orgId, second.id)).map((r) => r.metric)).toEqual(['buildPsf', 'gdvPsf', 'outturnPsf', 'poc']);

    // and out again takes all seven with it
    const off = (await admin(G).benchmarks.setContribution({ enabled: false } as never)) as { withdrawn: number };
    expect(off.withdrawn).toBe(7);
    expect(await points(G.orgId)).toEqual([]);
  });

  it('reports the out-turn cohort under its own key', async () => {
    const m = (await admin(A).benchmarks.metrics({ region: 'South West', useClass: 'RESIDENTIAL' } as never)) as Record<string, { basis: string }>;
    expect(Object.keys(m).sort()).toEqual(['buildPsf', 'gdvPsf', 'outturnPsf', 'poc']);
  });
});
