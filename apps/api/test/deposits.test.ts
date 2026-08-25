import { beforeAll, describe, expect, it } from 'vitest';
import { depositsHeldAt } from '@apex/appraisal-engine';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A buyer's money, on two screens.
 *
 * The developer's "Deposit held" and the buyer's receipts are the same money
 * and were computed by different rules in different files. Measured on the demo
 * workspace, on the buyer's own portal page: "Deposit held £39,200", and
 * directly beneath it a £2,000 reservation fee and a £39,200 exchange deposit,
 * both marked PAID. The buyer had paid £41,200.
 *
 * Five copies of the rule existed, with five answers. These tests are mostly
 * about there being one.
 */

let T: Tenant;
let unitId: string;
let buyerUserId: string;

const caller = () => callerFor(T.principal);
const asBuyer = () =>
  callerFor({
    userId: buyerUserId,
    orgId: T.orgId,
    principalType: 'buyer',
    role: 'VIEWER',
    name: 'A. Buyer',
    initials: 'AB',
    investorId: null,
    buyerUnitId: unitId,
  } as never);

const plot = (over: Record<string, unknown> = {}) => ({
  dealId: T.dealId,
  name: 'Plot 1',
  spec: '2-bed apt',
  level: 0,
  appraisedValue: 385_000,
  agreedValue: null,
  buyerName: 'A. Buyer',
  buyerSolicitor: null,
  leadSource: null,
  incentive: null,
  progress: 0,
  stalled: false,
  ...over,
});

const row = () => prisma.unit.findUniqueOrThrow({ where: { id: unitId } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Deposits');
  const created = (await caller().sales.upsertUnit(plot({ progress: 1, agreedValue: 392_000 }) as never)) as { id: string };
  unitId = created.id;
  const user = await prisma.user.create({
    data: {
      orgId: T.orgId, email: 'buyer@deposits.test', password: 'x', name: 'A. Buyer',
      initials: 'AB', role: 'VIEWER', principalType: 'buyer', buyerUnitId: unitId,
    },
  });
  buyerUserId = user.id;
}, 120_000);

describe('the figure the firm holds, and the receipts the buyer holds', () => {
  it('are the same money', async () => {
    const mine = (await asBuyer().buyer.myUnit()) as {
      unit: { depositHeld: number | null };
      payments: Array<{ amount: number; paid: boolean }>;
    };
    const paid = mine.payments.filter((p) => p.paid).reduce((a, p) => a + p.amount, 0);
    expect(mine.unit.depositHeld, 'the buyer is told the developer holds a different amount than they paid').toBe(paid);
  });

  it('include the reservation fee, which the old figure dropped', async () => {
    const mine = (await asBuyer().buyer.myUnit()) as { unit: { depositHeld: number | null } };
    expect(mine.unit.depositHeld).toBe(2_000);
  });
});

describe('editing a plot', () => {
  it('does not rewrite money nobody typed into the form', async () => {
    /**
     * The drawer has no deposit field, and upsertUnit rewrote it on every save.
     * Measured before this: a plot carrying a recorded £24,400 dropped to £5,000
     * because a colleague corrected the buyer's solicitor — a £19,400 swing on
     * the firm's client-money figure, from an edit about a law firm's name.
     */
    await prisma.unit.update({ where: { id: unitId }, data: { depositHeld: 24_400_00n } });
    const before = await row();

    const current = (await caller().sales.units(T.dealId as never)) as { units: Array<{ id: string; updatedAt: Date }> };
    const stamp = current.units.find((u) => u.id === unitId)!.updatedAt;
    await caller().sales.upsertUnit(
      plot({ id: unitId, progress: 1, agreedValue: 392_000, buyerSolicitor: 'Hale & Co', expectedUpdatedAt: stamp }) as never,
    );

    const after = await row();
    expect(after.buyerSolicitor, 'the edit itself should have applied').toBe('Hale & Co');
    expect(after.depositHeld, 'the recorded deposit was overwritten by a form that cannot show it').toBe(before.depositHeld);
  });
});

describe('advancing to exchange', () => {
  it('records what the buyer has now paid in total, not the ten per cent alone', async () => {
    await prisma.unit.update({ where: { id: unitId }, data: { progress: 4, depositHeld: 2_000_00n } });
    await caller().sales.advanceMilestone(unitId as never);

    const after = await row();
    expect(after.progress).toBe(5);
    // £2,000 reservation + 10% of £392,000
    expect(Number(after.depositHeld) / 100).toBe(41_200);
    expect(Number(after.depositHeld) / 100).not.toBe(39_200);
    expect(Number(after.depositHeld) / 100).toBe(depositsHeldAt(5, { agreedValue: 392_000, appraisedValue: 385_000 }));
  });

  it('still agrees with the buyer’s receipts afterwards', async () => {
    const mine = (await asBuyer().buyer.myUnit()) as {
      unit: { depositHeld: number | null };
      payments: Array<{ amount: number; paid: boolean }>;
    };
    const paid = mine.payments.filter((p) => p.paid).reduce((a, p) => a + p.amount, 0);
    expect(mine.unit.depositHeld).toBe(paid);
    expect(paid).toBe(41_200);
  });
});

describe('the payment schedule', () => {
  it('dates a receipt from the record, not from the moment it is read', async () => {
    /**
     * `paidAt: new Date()` meant a GET wrote a receipt date. Measured on the
     * demo workspace: a plot reserved on 12 January 2026 and long since
     * completed carried an exchange deposit "received" at 17:50 on the day the
     * buyer first opened the portal.
     *
     * Asserted as two things a clock cannot satisfy: the reservation fee is
     * dated when the plot was reserved, and reading the page again does not
     * move any of them.
     */
    const unit = await row();
    const before = await prisma.payment.findMany({ where: { unitId }, orderBy: { createdAt: 'asc' } });
    const fee = before.find((p) => p.kind === 'Reservation fee')!;
    expect(fee.status).toBe('PAID');
    expect(fee.paidAt?.getTime()).toBe(unit.reservedAt?.getTime());

    await new Promise((r) => setTimeout(r, 5));
    await asBuyer().buyer.myUnit();
    const after = await prisma.payment.findMany({ where: { unitId }, orderBy: { createdAt: 'asc' } });
    expect(after.map((p) => p.paidAt?.getTime() ?? null)).toEqual(before.map((p) => p.paidAt?.getTime() ?? null));
  });

  it('never offers a Pay button beside a figure of zero', async () => {
    // the old rule returned £0 for the exchange deposit while no price was
    // agreed, which is not an estimate — it is a claim that nothing is owed
    const other = await makeTenant('No price agreed');
    const made = (await callerFor(other.principal).sales.upsertUnit({
      dealId: other.dealId, name: 'Plot 9', spec: '', level: 0,
      appraisedValue: 500_000, agreedValue: null, buyerName: null, buyerSolicitor: null,
      leadSource: null, incentive: null, progress: 1, stalled: false,
    } as never)) as { id: string };
    const user = await prisma.user.create({
      data: {
        orgId: other.orgId, email: 'b2@deposits.test', password: 'x', name: 'B Two',
        initials: 'BT', role: 'VIEWER', principalType: 'buyer', buyerUnitId: made.id,
      },
    });
    const mine = (await callerFor({
      userId: user.id, orgId: other.orgId, principalType: 'buyer', role: 'VIEWER',
      name: 'B Two', initials: 'BT', investorId: null, buyerUnitId: made.id,
    } as never).buyer.myUnit()) as { payments: Array<{ kind: string; amount: number }> };

    for (const p of mine.payments) expect(p.amount, `${p.kind} was offered as £0`).toBeGreaterThan(0);
    expect(mine.payments.find((p) => p.kind.startsWith('Exchange'))!.amount).toBe(50_000);
  });

  it('follows a renegotiated price while the row is still unpaid', async () => {
    // written once on the buyer's first visit and never touched again, so a
    // price agreed after that first login left the deposit at the old figure
    const other = await makeTenant('Renegotiated');
    const made = (await callerFor(other.principal).sales.upsertUnit({
      dealId: other.dealId, name: 'Plot 3', spec: '', level: 0,
      appraisedValue: 400_000, agreedValue: null, buyerName: null, buyerSolicitor: null,
      leadSource: null, incentive: null, progress: 1, stalled: false,
    } as never)) as { id: string; updatedAt: Date };
    const user = await prisma.user.create({
      data: {
        orgId: other.orgId, email: 'b3@deposits.test', password: 'x', name: 'B Three',
        initials: 'BT', role: 'VIEWER', principalType: 'buyer', buyerUnitId: made.id,
      },
    });
    const buyer = callerFor({
      userId: user.id, orgId: other.orgId, principalType: 'buyer', role: 'VIEWER',
      name: 'B Three', initials: 'BT', investorId: null, buyerUnitId: made.id,
    } as never);

    const first = (await buyer.buyer.myUnit()) as { payments: Array<{ kind: string; amount: number }> };
    expect(first.payments.find((p) => p.kind.startsWith('Exchange'))!.amount).toBe(40_000);

    await callerFor(other.principal).sales.upsertUnit({
      dealId: other.dealId, id: made.id, name: 'Plot 3', spec: '', level: 0,
      appraisedValue: 400_000, agreedValue: 425_000, buyerName: null, buyerSolicitor: null,
      leadSource: null, incentive: null, progress: 1, stalled: false,
      expectedUpdatedAt: made.updatedAt,
    } as never);

    const again = (await buyer.buyer.myUnit()) as { payments: Array<{ kind: string; amount: number }> };
    expect(again.payments.find((p) => p.kind.startsWith('Exchange'))!.amount).toBe(42_500);
  });

  it('never rewrites a receipt once it is settled', async () => {
    /**
     * A settled payment is a record of money that arrived; the plot's current
     * state is not entitled to restate it.
     *
     * On the exchange deposit specifically — the reservation fee is a flat
     * amount, so a test that happened to pick it would pass with this guard
     * removed, which is exactly what the first version of this test did.
     */
    const settled = await prisma.payment.findFirstOrThrow({ where: { unitId, status: 'PAID', kind: { startsWith: 'Exchange' } } });
    expect(Number(settled.amount) / 100, 'ten per cent of the agreed £392,000').toBe(39_200);

    await prisma.unit.update({ where: { id: unitId }, data: { agreedValue: 500_000_00n } });
    await asBuyer().buyer.myUnit();

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: settled.id } });
    expect(Number(after.amount) / 100, 'a receipt was restated from the plot’s new price').toBe(39_200);
    expect(after.paidAt?.getTime()).toBe(settled.paidAt?.getTime());
  });
});
