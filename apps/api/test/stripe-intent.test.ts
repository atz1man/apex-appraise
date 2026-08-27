import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intentFor, intentSucceeded, type StripeTransport } from '../src/payments.js';
import { makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Taking a buyer's money, against a fake Stripe.
 *
 * None of this could be tested before. xero.ts and open-banking.ts both take an
 * injectable transport so their logic can be exercised; buyer.pay called fetch
 * inline. So the two connectors that READ a ledger were testable and the one
 * that CREATES CHARGES was not — which is exactly backwards, and is how it went
 * unnoticed that every call to pay() made a new PaymentIntent.
 *
 * The fake below behaves the way Stripe does on the one point that matters: a
 * repeated Idempotency-Key returns the first intent rather than making another.
 * A fake that ignored the header would let this suite pass while the real thing
 * double-charged.
 */

let T: Tenant;

/** A Stripe that honours idempotency keys and records what it was asked. */
function fakeStripe(opts: { status?: string; failCreate?: string } = {}) {
  const calls: Array<{ method: string; url: string; idempotencyKey?: string }> = [];
  const byKey = new Map<string, { id: string; client_secret: string; status: string }>();
  const byId = new Map<string, { id: string; client_secret: string; status: string }>();
  let n = 0;

  const transport: StripeTransport = async (url, init) => {
    calls.push({ method: init.method, url, idempotencyKey: init.headers['idempotency-key'] });

    if (init.method === 'GET') {
      const id = url.split('/').pop()!;
      const found = byId.get(id);
      if (!found) return { status: 404, json: async () => ({ error: { message: 'No such payment_intent' } }) };
      return { status: 200, json: async () => found };
    }

    if (opts.failCreate) {
      return { status: 402, json: async () => ({ error: { message: opts.failCreate } }) };
    }

    const key = init.headers['idempotency-key']!;
    // the behaviour that matters: Stripe returns the FIRST intent for a repeated key
    const already = byKey.get(key);
    if (already) return { status: 200, json: async () => already };

    const intent = { id: `pi_${++n}`, client_secret: `pi_${n}_secret`, status: opts.status ?? 'requires_payment_method' };
    byKey.set(key, intent);
    byId.set(intent.id, intent);
    return { status: 200, json: async () => intent };
  };

  return { transport, calls, posts: () => calls.filter((c) => c.method === 'POST'), byId };
}

const duePayment = async (plot: string) => {
  const unit = await prisma.unit.create({
    data: { orgId: T.orgId, dealId: T.dealId, name: plot, spec: '3 bed', appraisedValue: BigInt(450_000_00), status: 'RESERVED' },
  });
  return prisma.payment.create({
    data: { orgId: T.orgId, unitId: unit.id, kind: 'Reservation fee', amount: BigInt(500_000), status: 'PENDING' },
  });
};

const originalKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Charges');
  // a key is what puts intentFor on its live path at all; the transport below is
  // what stops any of it reaching Stripe
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
}, 120_000);

afterAll(() => {
  if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalKey;
});

describe('creating the intent', () => {
  it('creates one and remembers it', async () => {
    const payment = await duePayment('Plot 1');
    const stripe = fakeStripe();

    const first = await intentFor(prisma, payment, 'Reservation fee — Plot 1', stripe.transport);
    expect(first.created).toBe(true);
    expect(first.clientSecret).toMatch(/_secret$/);

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    // without the stored id there is nothing to reuse, and the next call makes
    // a second chargeable intent
    expect(row.stripeIntentId).toBe('pi_1');
  });

  it('carries an idempotency key tied to the payment', async () => {
    const payment = await duePayment('Plot 2');
    const stripe = fakeStripe();
    await intentFor(prisma, payment, 'x', stripe.transport);
    expect(stripe.posts()[0]!.idempotencyKey).toBe(`apex-intent-${payment.id}`);
  });

  it('surfaces Stripe’s own refusal rather than a generic failure', async () => {
    const payment = await duePayment('Plot 3');
    const stripe = fakeStripe({ failCreate: 'Your card was declined.' });
    // a buyer reads this; "something went wrong" tells them nothing to do next
    await expect(intentFor(prisma, payment, 'x', stripe.transport)).rejects.toThrow(/card was declined/);
  });
});

describe('the second attempt', () => {
  it('reuses the intent instead of creating a second chargeable one', async () => {
    const payment = await duePayment('Plot 4');
    const stripe = fakeStripe();

    const first = await intentFor(prisma, payment, 'x', stripe.transport);
    const reloaded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const second = await intentFor(prisma, reloaded, 'x', stripe.transport);

    expect(second.created).toBe(false);
    expect(second.clientSecret).toBe(first.clientSecret);
    // the whole point: one POST, so one intent exists at Stripe
    expect(stripe.posts()).toHaveLength(1);
  });

  it('answers two racing calls with one intent', async () => {
    /**
     * Both read the row before either wrote to it, so neither sees a stored id
     * and both POST. Stripe's idempotency key is what collapses them — the fake
     * honours it exactly as the real one does.
     */
    const payment = await duePayment('Plot 5');
    const stripe = fakeStripe();

    const [a, b] = await Promise.all([
      intentFor(prisma, payment, 'x', stripe.transport),
      intentFor(prisma, payment, 'x', stripe.transport),
    ]);

    expect(a.clientSecret).toBe(b.clientSecret);
    expect(stripe.posts()).toHaveLength(2); // two requests…
    expect(new Set([...stripe.byId.keys()]).size).toBe(1); // …one intent
  });

  it('does not reuse an intent Stripe has cancelled', async () => {
    const payment = await duePayment('Plot 6');
    const stripe = fakeStripe();
    await intentFor(prisma, payment, 'x', stripe.transport);
    // a cancelled intent cannot be paid, so reusing it would leave the buyer
    // clicking a button that can never work
    stripe.byId.get('pi_1')!.status = 'canceled';

    const reloaded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const again = await intentFor(prisma, reloaded, 'x', stripe.transport);
    expect(again.created).toBe(true);
    expect(stripe.posts()).toHaveLength(2);
  });

  it('does not reuse an id Stripe has never heard of', async () => {
    // a restored database, a key rotated to another Stripe account — the stored
    // id is meaningless and must not become a dead end
    const payment = await duePayment('Plot 7');
    await prisma.payment.update({ where: { id: payment.id }, data: { stripeIntentId: 'pi_from_another_life' } });
    const stripe = fakeStripe();
    const reloaded = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

    const made = await intentFor(prisma, reloaded, 'x', stripe.transport);
    expect(made.created).toBe(true);
  });
});

describe('asking whether the money arrived', () => {
  it('is answered by Stripe, never by the browser', async () => {
    const payment = await duePayment('Plot 8');
    const stripe = fakeStripe({ status: 'succeeded' });
    await intentFor(prisma, payment, 'x', stripe.transport);

    const verdict = await intentSucceeded('pi_1', stripe.transport);
    expect(verdict.succeeded).toBe(true);
    // read back over the wire, not inferred from what the client said
    expect(stripe.calls.some((c) => c.method === 'GET' && c.url.endsWith('pi_1'))).toBe(true);
  });

  it('reports what Stripe actually said when it has not', async () => {
    const payment = await duePayment('Plot 9');
    const stripe = fakeStripe({ status: 'requires_action' });
    await intentFor(prisma, payment, 'x', stripe.transport);

    const verdict = await intentSucceeded('pi_1', stripe.transport);
    expect(verdict.succeeded).toBe(false);
    // the status is what tells a buyer's screen whether to prompt for 3-D Secure
    expect(verdict.status).toBe('requires_action');
  });
});
