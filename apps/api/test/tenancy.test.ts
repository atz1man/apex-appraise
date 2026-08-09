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
    } as never);
    expect((updated as { name: string }).name).toBe('Flat 2 — renamed');
  });

  it('refuses a deal that belongs to another org', async () => {
    await expectDenied('deals.get', () => callerFor(A.principal).deals.get(B.dealId));
  });
});
