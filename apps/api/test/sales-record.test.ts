import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * What the sales screen leaves behind.
 *
 * "Provenance on every figure (extraction citations, audit events)" is one of
 * this product's stated non-negotiables. `sales.ts` had six mutations and wrote
 * neither an audit event nor an activity event for any of them — so a plot's
 * agreed value could move from £450,000 to £400,000, or the plot could be
 * deleted outright, with nothing anywhere to say who did it or when.
 *
 * The optimistic lock added earlier on this branch stops the ACCIDENTAL revert.
 * Nothing recorded the deliberate one.
 *
 * And `Payment.unitId` carries no relation, so deleting a plot left the buyer's
 * settled receipts orphaned — records of money that actually arrived, reachable
 * from nothing — while the buyer's portal login still pointed at a plot that no
 * longer existed.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const plot = (over: Record<string, unknown> = {}) => ({
  dealId: T.dealId,
  name: 'Plot 1',
  spec: '2-bed apt',
  level: 0,
  appraisedValue: 450_000,
  agreedValue: null,
  buyerName: null,
  buyerSolicitor: null,
  leadSource: null,
  incentive: null,
  progress: 0,
  stalled: false,
  ...over,
});

const events = (contains: string) =>
  prisma.activityEvent.findMany({ where: { orgId: T.orgId, action: { contains } } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Sales record');
}, 120_000);

describe('changing a plot leaves a record', () => {
  it('says what changed when the agreed value moves', async () => {
    const made = (await caller().sales.upsertUnit(plot({ progress: 1, agreedValue: 450_000 }) as never)) as {
      id: string;
      updatedAt: Date;
    };
    const before = await events('plot');
    await caller().sales.upsertUnit(
      plot({ id: made.id, progress: 1, agreedValue: 400_000, expectedUpdatedAt: made.updatedAt }) as never,
    );
    const after = await events('plot');
    expect(after.length, 'a £50,000 change to an agreed sale value went unrecorded').toBeGreaterThan(before.length);
    const latest = after[after.length - 1]!;
    expect(latest.actor).toBe(T.principal.name);
    expect(`${latest.action} ${latest.target}`).toContain('agreed value');
  });

  it('records a milestone advance, which takes a deposit', async () => {
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 2', progress: 4, agreedValue: 500_000 }) as never)) as { id: string };
    const before = await events('milestone');
    await caller().sales.advanceMilestone(made.id as never);
    expect((await events('milestone')).length).toBeGreaterThan(before.length);
  });

  it('records a letting the same way', async () => {
    const made = (await caller().sales.upsertTenancy({
      dealId: T.dealId, name: 'Apt 4', spec: '1-bed', level: 0, ervPcm: 1_400,
      agreedRentPcm: null, tenantName: null, leadSource: null, incentive: null, progress: 0, stalled: false,
    } as never)) as { id: string; updatedAt: Date };
    const before = await events('tenancy');
    await caller().sales.upsertTenancy({
      dealId: T.dealId, id: made.id, name: 'Apt 4', spec: '1-bed', level: 0, ervPcm: 1_400,
      agreedRentPcm: 1_500, tenantName: 'R. Okafor', leadSource: null, incentive: null, progress: 2, stalled: false,
      expectedUpdatedAt: made.updatedAt,
    } as never);
    expect((await events('tenancy')).length).toBeGreaterThan(before.length);
  });
});

describe('deleting a plot somebody has paid for', () => {
  let paidUnit: string;

  beforeAll(async () => {
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 9', progress: 5, agreedValue: 480_000 }) as never)) as { id: string };
    paidUnit = made.id;
    await prisma.payment.create({
      data: { orgId: T.orgId, unitId: paidUnit, kind: 'Exchange deposit (10%)', amount: 48_000_00n, status: 'PAID', paidAt: new Date() },
    });
  });

  it('is refused, because deleting it would destroy the receipt', async () => {
    await expect(caller().sales.deleteUnit(paidUnit as never)).rejects.toThrow(/paid|receipt/i);
    expect(await prisma.unit.findUnique({ where: { id: paidUnit } })).toBeTruthy();
    expect(await prisma.payment.count({ where: { unitId: paidUnit } })).toBe(1);
  });
});

describe('deleting a plot nobody has paid for', () => {
  it('takes its unsettled payment rows with it rather than orphaning them', async () => {
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 10', progress: 1 }) as never)) as { id: string };
    await prisma.payment.create({
      data: { orgId: T.orgId, unitId: made.id, kind: 'Reservation fee', amount: 2_000_00n, status: 'PENDING' },
    });
    await caller().sales.deleteUnit(made.id as never);
    expect(await prisma.payment.count({ where: { unitId: made.id } }), 'payment rows left pointing at a deleted plot').toBe(0);
    expect(await prisma.salesMilestone.count({ where: { unitId: made.id } })).toBe(0);
  });

  it('says how many portal logins go with it, before they simply break', async () => {
    /**
     * `User.buyerUnitId` points at the plot. Deleting the plot left the buyer
     * with an account whose every page answers NOT_FOUND, and told the person
     * deleting nothing at all — the same shape as removing a colleague and
     * silently killing the valuation links they had sent.
     */
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 11', progress: 1 }) as never)) as { id: string };
    await prisma.user.create({
      data: {
        orgId: T.orgId, email: 'plot11@buyer.test', password: 'x', name: 'A Buyer',
        initials: 'AB', role: 'VIEWER', principalType: 'buyer', buyerUnitId: made.id,
      },
    });
    const res = (await caller().sales.deleteUnit(made.id as never)) as { ok: boolean; portalLogins: number };
    expect(res.portalLogins).toBe(1);
    // and the login does not survive pointing at nothing
    expect(await prisma.user.count({ where: { buyerUnitId: made.id } })).toBe(0);
  });

  it('records the deletion', async () => {
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 12', progress: 0 }) as never)) as { id: string };
    const before = await events('deleted');
    await caller().sales.deleteUnit(made.id as never);
    const after = await events('deleted');
    expect(after.length).toBeGreaterThan(before.length);
    expect(after[after.length - 1]!.target).toContain('Plot 12');
  });
});
