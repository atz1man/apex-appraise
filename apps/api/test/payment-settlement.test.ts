import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Settling a buyer's payment exactly once.
 *
 * Three separate paths settle a payment and every one of them was a read
 * followed by a write: buyer.pay in demo mode, buyer.confirmPayment after the
 * card clears client-side, and the Stripe webhook. Each read the status, saw it
 * was not PAID, and then wrote.
 *
 * confirmPayment and the webhook are not a hypothetical pair — the comment above
 * confirmPayment calls the webhook "belt-and-braces", which is to say they are
 * EXPECTED to fire together. Both settle, both write a receipt into the deal's
 * activity trail, and the ledger a developer reconciles shows one payment
 * received twice.
 */

let T: Tenant;

/** A reserved plot, its buyer's login, and a payment they owe. */
async function duePayment(t: Tenant, plot: string) {
  const unit = await prisma.unit.create({
    data: { orgId: t.orgId, dealId: t.dealId, name: plot, spec: '3 bed', appraisedValue: BigInt(450_000_00), status: 'RESERVED', buyerName: 'Buyer' },
  });
  const user = await prisma.user.create({
    data: {
      orgId: t.orgId, email: `buyer-${unit.id}@settle.test`, password: 'x', name: 'Buyer',
      initials: 'BY', role: 'VIEWER', principalType: 'buyer', buyerUnitId: unit.id,
    },
  });
  const payment = await prisma.payment.create({
    data: { orgId: t.orgId, unitId: unit.id, kind: 'Reservation fee', amount: BigInt(500_000), status: 'PENDING' },
  });
  return {
    payment,
    unit,
    principal: {
      userId: user.id, orgId: t.orgId, principalType: 'buyer' as const, role: 'VIEWER',
      name: 'Buyer', initials: 'BY', investorId: null, buyerUnitId: unit.id,
    },
  };
}

/**
 * Receipts for ONE unit. Every case here adds a plot to the same deal, so a
 * deal-scoped count reads the previous case's receipt and the assertion passes
 * or fails on test order rather than on behaviour. The unit's name is what the
 * receipt carries in `target`.
 */
const receipts = (plot: string) =>
  prisma.activityEvent.count({ where: { action: { contains: 'paid' }, target: { contains: plot } } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Settle');
  // demo settlement is what makes this reachable without a card processor; the
  // race it exposes is in code every path shares
  process.env.NODE_ENV = 'test';
  delete process.env.STRIPE_SECRET_KEY;
}, 120_000);

describe('two settlements landing at once', () => {
  it('records one receipt, not two', async () => {
    const { payment, unit, principal } = await duePayment(T, 'Plot 7');
    const buyer = callerFor(principal as never).buyer;

    /**
     * A buyer double-clicking is the mild version. The real pair is
     * confirmPayment and the Stripe webhook, which are designed to overlap —
     * and they share this exact read-then-write.
     */
    const results = await Promise.allSettled([buyer.pay(payment.id), buyer.pay(payment.id)]);
    expect(results.some((r) => r.status === 'fulfilled'), 'neither call settled').toBe(true);

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('PAID');

    // the one that matters: a developer reconciling the ledger must not see one
    // payment received twice
    expect(await receipts(unit.name), 'one payment produced two receipts').toBe(1);
  });

  it('tells both callers the same settled time', async () => {
    const { payment, unit, principal } = await duePayment(T, 'Plot 8');
    const buyer = callerFor(principal as never).buyer;

    /**
     * The loser reports success, and that is the intended behaviour: the buyer's
     * payment did complete, and an error on the screen where it just succeeded
     * is a support call. So the thing to hold is that both answers agree with
     * the row — a caller told a paidAt the database does not have would put a
     * wrong date on a receipt.
     */
    const [a, b] = (await Promise.all([buyer.pay(payment.id), buyer.pay(payment.id)])) as Array<{ paidAt: Date | null }>;
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(a.paidAt?.getTime()).toBe(row.paidAt?.getTime());
    expect(b.paidAt?.getTime()).toBe(row.paidAt?.getTime());
    expect(await receipts(unit.name)).toBe(1);
  });

  it('still tells a buyer a payment settled earlier is already paid', async () => {
    const { payment, principal } = await duePayment(T, 'Plot 10');
    const buyer = callerFor(principal as never).buyer;
    await buyer.pay(payment.id);
    // a different question from the race: opening a payment settled some time
    // ago should say so, not show a pay button that quietly does nothing
    await expect(buyer.pay(payment.id)).rejects.toThrow(/already paid/i);
  });

  it('leaves paidAt as the moment it actually settled', async () => {
    const { payment, principal } = await duePayment(T, 'Plot 9');
    const buyer = callerFor(principal as never).buyer;

    await buyer.pay(payment.id);
    const first = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    await new Promise((r) => setTimeout(r, 5));
    await buyer.pay(payment.id).catch(() => {});

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    // a later write moving paidAt forward would misdate a receipt on a document
    // somebody reconciles against a bank statement
    expect(after.paidAt?.getTime()).toBe(first.paidAt?.getTime());

    /**
     * And it is the moment it happened, not merely a stable value. Comparing the
     * caller's answer against the row proves they agree; both can agree on a
     * date that is wrong, which on a receipt is the whole problem.
     */
    const settledAt = after.paidAt!.getTime();
    expect(settledAt).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - settledAt).toBeLessThan(60_000);
  });
});
