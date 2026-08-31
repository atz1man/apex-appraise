import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Cross-org isolation.
 *
 * Every procedure here follows the same shape: check that the DEAL the caller
 * named belongs to them, then write a record identified by an id the caller also
 * supplied. Those are two different questions, and passing the first says nothing
 * about the second. Five procedures shipped having answered only the first.
 *
 * Each test holds org A's principal, names a deal org A genuinely owns — so the
 * guard that does exist is satisfied — and passes the id of a record belonging to
 * org B. A pass means the call was refused AND org B's row is untouched. Checking
 * the row afterwards matters: a procedure could return NOT_FOUND having already
 * written.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Alpha');
  B = await makeTenant('Bravo');
}, 120_000);

describe('a tenancy belonging to another org', () => {
  it('cannot be rewritten by naming your own deal', async () => {
    const victim = await prisma.tenancy.create({
      data: { orgId: B.orgId, dealId: B.dealId, name: 'Flat 1', spec: '2 bed', level: 1, ervPcm: 150_000, progress: 0, status: 'available' },
    });

    await expectDenied('sales.upsertTenancy', () =>
      callerFor(A.principal).sales.upsertTenancy({
        id: victim.id,
        dealId: A.dealId, // a deal A really owns: the existing guard passes
        name: 'OWNED',
        spec: 'x',
        level: 9,
        ervPcm: 1,
        progress: 0,
      } as never),
    );

    const after = await prisma.tenancy.findUnique({ where: { id: victim.id } });
    expect(after?.name, "org B's tenancy was rewritten").toBe('Flat 1');
    expect(after?.orgId).toBe(B.orgId);
  });
});

describe('an inspection belonging to another org', () => {
  it('cannot have its valuation evidence overwritten', async () => {
    const victim = await prisma.inspection.create({
      data: {
        orgId: B.orgId,
        dealId: B.dealId,
        surveyorId: B.userId,
        rooms: '[]',
        approachWeights: '{}',
        reconciledValue: 500_000_00,
        status: 'submitted',
      },
    });

    await expectDenied('inspections.save', () =>
      callerFor(A.principal).inspections.save({
        id: victim.id,
        dealId: A.dealId,
        rooms: [],
        reconciledValue: 1,
        approachWeights: { salesComparison: 100, cost: 0, income: 0 },
        status: 'submitted',
      } as never),
    );

    const after = await prisma.inspection.findUnique({ where: { id: victim.id } });
    // BigInt column: compare like with like, or the assertion fails on the type
    // and hides whatever it was meant to be checking
    expect(Number(after?.reconciledValue), "org B's reconciled valuation was overwritten").toBe(500_000_00);
    expect(after?.surveyorId, 'the attacker was recorded as the surveyor').toBe(B.userId);
  });
});

describe('a comparable belonging to another org', () => {
  it('cannot be re-priced', async () => {
    const victim = await prisma.comparable.create({
      data: { orgId: B.orgId, dealId: B.dealId, address: '2 Bravo Street', basePsf: 400_00, adjSize: 0, adjCondition: 0, adjDate: 0, adjLocation: 0 },
    });

    await expectDenied('comparables.upsert', () =>
      callerFor(A.principal).comparables.upsert({
        id: victim.id,
        dealId: A.dealId,
        address: 'OWNED',
        meta: '',
        basePsf: 1,
        adjSize: 0,
        adjCondition: 0,
        adjDate: 0,
        adjLocation: 0,
      } as never),
    );

    const after = await prisma.comparable.findUnique({ where: { id: victim.id } });
    expect(after?.address, "org B's comparable evidence was rewritten").toBe('2 Bravo Street');
  });
});

describe('a scenario belonging to another org', () => {
  it('cannot be rewritten', async () => {
    const victim = await prisma.scenario.create({
      data: { orgId: B.orgId, dealId: B.dealId, name: 'Base', descriptor: '', blendedPsf: 400_00, buildPsf: 150_00, gia: 10_000, targetProfitPct: 20 },
    });

    await expectDenied('scenarios.upsert', () =>
      callerFor(A.principal).scenarios.upsert({
        id: victim.id,
        dealId: A.dealId,
        name: 'OWNED',
        descriptor: '',
        blendedPsf: 1,
        buildPsf: 1,
        gia: 1,
        targetProfitPct: 1,
      } as never),
    );

    const after = await prisma.scenario.findUnique({ where: { id: victim.id } });
    expect(after?.name, "org B's scenario was rewritten").toBe('Base');
  });
});

describe('a cost package belonging to another org', () => {
  it('cannot have its budget rewritten', async () => {
    const victim = await prisma.costPackage.create({
      data: { orgId: B.orgId, dealId: B.dealId, name: 'Groundworks', budget: 1_000_000_00, committed: 0, spent: 0, forecast: 1_000_000_00, retentionPct: 5 },
    });

    await expectDenied('cost.upsertPackage', () =>
      callerFor(A.principal).cost.upsertPackage({
        id: victim.id,
        dealId: A.dealId,
        name: 'OWNED',
        budget: 1,
        committed: 0,
        spent: 0,
        forecast: 1,
        retentionPct: 0,
      } as never),
    );

    const after = await prisma.costPackage.findUnique({ where: { id: victim.id } });
    expect(after?.name, "org B's cost package was rewritten").toBe('Groundworks');
    expect(Number(after?.budget)).toBe(1_000_000_00); // BigInt column
  });
});

/**
 * Controls. If these ever fail the suite is lying about the ones above — either
 * the harness cannot reach the API at all, or refusal has become the answer to
 * everything and the tests would pass against a completely broken server.
 */
describe('the suite can tell a refusal from a wall', () => {
  it('lets an org write its OWN records', async () => {
    const mine = await callerFor(A.principal).sales.upsertTenancy({
      dealId: A.dealId,
      name: 'Flat 2',
      spec: '1 bed',
      level: 0,
      ervPcm: 1200,
      progress: 0,
    } as never);
    expect((mine as { name: string }).name).toBe('Flat 2');

    const updated = await callerFor(A.principal).sales.upsertTenancy({
      id: (mine as { id: string }).id,
      dealId: A.dealId,
      name: 'Flat 2 — renamed',
      spec: '1 bed',
      level: 0,
      ervPcm: 1200,
      progress: 0,
      // an in-place save carries the stamp of the record it loaded — see
      // unit-concurrency.test.ts
      expectedUpdatedAt: (mine as { updatedAt: Date }).updatedAt,
    } as never);
    expect((updated as { name: string }).name).toBe('Flat 2 — renamed');
  });

  it('refuses a deal that belongs to another org', async () => {
    await expectDenied('deals.get', () => callerFor(A.principal).deals.get(B.dealId));
  });
});

/**
 * The read side.
 *
 * The write audit found five procedures that would let one firm change another's
 * records. Reads were never swept, and a read leak in a valuation product is a
 * confidentiality breach rather than a corruption — a competitor's costs, deal
 * names and client names. One was found (benchmarks.trend, see benchmarks.test.ts);
 * this sweep is what stops the next one shipping.
 */
describe('reads never cross an org boundary', () => {
  const dealScoped: Array<[string, (c: ReturnType<typeof callerFor>, dealId: string) => Promise<unknown>]> = [
    ['deals.get', (c, d) => c.deals.get(d)],
    ['appraisal.getCurrent', (c, d) => c.appraisal.getCurrent(d)],
    ['appraisal.versions', (c, d) => c.appraisal.versions(d)],
    ['appraisal.shares', (c, d) => c.appraisal.shares(d)],
    ['comparables.list', (c, d) => c.comparables.list(d)],
    ['scenarios.list', (c, d) => c.scenarios.list(d)],
    ['cost.packages', (c, d) => c.cost.packages(d)],
    ['sales.units', (c, d) => c.sales.units(d)],
    ['sales.tenancies', (c, d) => c.sales.tenancies(d)],
    ['inspections.get', (c, d) => c.inspections.get(d)],
    ['documents.list', (c, d) => c.documents.list(d)],
  ];

  it('refuses every deal-scoped read of another firm’s deal', async () => {
    const caller = callerFor(A.principal);
    for (const [name, call] of dealScoped) {
      // B.dealId belongs to the other firm; a pass is a throw, a null or an
      // empty list — anything but that firm's data coming back
      await expectDenied(name, () => call(caller, B.dealId) as Promise<unknown>);
    }
  });

  it('still returns a firm’s OWN data through those same reads', async () => {
    // without this the sweep above would pass against an API that refuses
    // everything, which proves nothing at all
    const caller = callerFor(A.principal);
    const own = await caller.deals.get(A.dealId);
    expect(own).toBeTruthy();
    await expect(caller.sales.units(A.dealId)).resolves.toBeDefined();
  });

  it('lists only its own deals', async () => {
    const list = (await callerFor(A.principal).deals.list({} as never)) as { deals: Array<{ id: string }> };
    const ids = list.deals.map((d) => d.id);
    expect(ids).toContain(A.dealId);
    expect(ids).not.toContain(B.dealId);
  });

  it('keeps the portfolio, audit trail and fault log to one firm', async () => {
    const exposure = (await callerFor(A.principal).deals.exposure()) as { positions: Array<{ dealId: string }> };
    expect(exposure.positions.map((p) => p.dealId)).not.toContain(B.dealId);

    const audit = (await callerFor(A.principal).org.auditLog({ limit: 100 } as never)) as Array<{ orgId: string }>;
    expect(audit.every((e) => e.orgId === A.orgId)).toBe(true);
  });
});

/**
 * Rent a tenant owes, and the instruction the product could not obey.
 *
 * `Tenancy.arrears` existed with nothing able to write it. `upsertTenancy` did
 * not take it; no other procedure touched it; only the demo seed ever set it.
 * It is READ in three places on the lettings screen — a KPI row, a stat card
 * and the drawer — each coloured green at zero, which is not an absence but an
 * assertion that nothing is owed. So a letting agent could not record that a
 * tenant was behind, and the screen said so in green.
 *
 * `deleteTenancy` then refuses a tenancy carrying arrears:
 *
 *   "Apt 4 cannot be deleted — £1,425 of arrears is recorded against it.
 *    Clear or write off the arrears first."
 *
 * an instruction the product did not offer any way to follow. Measured on the
 * demo workspace: Apt 4 carries £1,425 and was undeletable for ever.
 */
describe('rent a tenant owes', () => {
  const make = async () =>
    (await callerFor(A.principal).sales.upsertTenancy({
      dealId: A.dealId, name: 'Apt 9', spec: '2 bed', level: 1, ervPcm: 1_500, progress: 2,
    } as never)) as { id: string; updatedAt: Date; arrears: bigint };

  it('can be recorded at all — nothing could write it before', async () => {
    const t = await make();
    expect(Number(t.arrears), 'a new tenancy starts owing nothing').toBe(0);

    const updated = (await callerFor(A.principal).sales.upsertTenancy({
      id: t.id, dealId: A.dealId, name: 'Apt 9', spec: '2 bed', level: 1, ervPcm: 1_500, progress: 2,
      arrears: 1_425, expectedUpdatedAt: t.updatedAt,
    } as never)) as { arrears: bigint };
    // pence in the column, pounds on the wire
    expect(Number(updated.arrears), 'arrears could still not be recorded').toBe(142_500);
  });

  /**
   * The reason this field is optional while every neighbour is `.default(0)`.
   *
   * The lettings form does not send arrears when an agent edits a name or a
   * lead source. A `.default(0)` would have made every such save write off the
   * debt silently — turning a fix for an unrecordable figure into a way to lose
   * one. A missing key leaves the column alone.
   */
  it('is not written off by an edit that never mentioned it', async () => {
    const t = await make();
    const withDebt = (await callerFor(A.principal).sales.upsertTenancy({
      id: t.id, dealId: A.dealId, name: 'Apt 9', spec: '2 bed', level: 1, ervPcm: 1_500, progress: 2,
      arrears: 900, expectedUpdatedAt: t.updatedAt,
    } as never)) as { updatedAt: Date };

    // an ordinary edit: a new lead source, nothing about money owed
    const after = (await callerFor(A.principal).sales.upsertTenancy({
      id: t.id, dealId: A.dealId, name: 'Apt 9', spec: '2 bed', level: 1, ervPcm: 1_500, progress: 2,
      leadSource: 'Rightmove', expectedUpdatedAt: withDebt.updatedAt,
    } as never)) as { arrears: bigint; leadSource: string | null };

    expect(after.leadSource, 'the edit itself did not land').toBe('Rightmove');
    expect(Number(after.arrears), 'an unrelated edit wrote off the debt').toBe(90_000);
  });

  /**
   * The instruction `deleteTenancy` gives, now followable. Both halves: the
   * refusal still stands while money is owed, and clearing it actually releases
   * the tenancy — a guard that can never be satisfied is a dead end, and a
   * guard that stops refusing is not a guard.
   */
  it('blocks a delete until it is cleared, and then lets it through', async () => {
    const t = await make();
    const owing = (await callerFor(A.principal).sales.upsertTenancy({
      id: t.id, dealId: A.dealId, name: 'Apt 9', spec: '2 bed', level: 1, ervPcm: 1_500, progress: 2,
      arrears: 1_425, expectedUpdatedAt: t.updatedAt,
    } as never)) as { updatedAt: Date };

    await expect(callerFor(A.principal).sales.deleteTenancy(t.id as never)).rejects.toThrow(/arrears is recorded against it/i);

    await callerFor(A.principal).sales.upsertTenancy({
      id: t.id, dealId: A.dealId, name: 'Apt 9', spec: '2 bed', level: 1, ervPcm: 1_500, progress: 2,
      arrears: 0, expectedUpdatedAt: owing.updatedAt,
    } as never);
    await callerFor(A.principal).sales.deleteTenancy(t.id as never);
    expect(await prisma.tenancy.findUnique({ where: { id: t.id } })).toBeNull();
  });

  it('records the change, because it is money somebody owes', async () => {
    const t = await make();
    await callerFor(A.principal).sales.upsertTenancy({
      id: t.id, dealId: A.dealId, name: 'Apt 9', spec: '2 bed', level: 1, ervPcm: 1_500, progress: 2,
      arrears: 2_000, expectedUpdatedAt: t.updatedAt,
    } as never);
    const events = await prisma.activityEvent.findMany({ where: { dealId: A.dealId, action: { contains: 'arrears' } } });
    expect(events.length, 'money owed moved with no trace of who moved it').toBeGreaterThan(0);
  });
});
