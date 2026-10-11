import { PLANS } from '../src/stripe.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Switching plan billed the firm twice, and leaving was not possible at all.
 *
 * "Switch plan" on the billing panel called `billing.checkout`, which opens a
 * Stripe Checkout session in `mode: subscription`. Stripe does exactly what that
 * asks: it creates ANOTHER subscription against the same customer and cancels
 * nothing. So a firm moving from STARTER to GROWTH paid for both, every month,
 * and the only sign of it was a card statement — this product showed one CURRENT
 * chip and `billing.sync` ran the workspace at whichever subscription Stripe
 * happened to list first.
 *
 * And there was no way to cancel. The Terms a customer accepts say the
 * subscription can be cancelled at any time; the only control in the app was
 * Subscribe, so leaving meant asking us to do it in the Stripe dashboard —
 * `org.deleteWorkspace`, the GDPR erasure, was the only thing in the product
 * that stopped the billing, and it did so by destroying the firm's records.
 *
 * Stripe is driven with a stubbed `fetch`, as `billing-sync.test.ts` does it,
 * rather than threading a transport through production code with no other use
 * for one. The stub ROUTES by path, because the whole claim here is about which
 * Stripe call is made: a stub answering everything the same way would pass
 * whether a plan switch updated a subscription or created a second one.
 */

let T: Tenant;
const realFetch = globalThis.fetch;
const realKey = process.env.STRIPE_SECRET_KEY;

/** Every Stripe request the code under test made, in order. */
let calls: Array<{ method: string; path: string; query: URLSearchParams; body: Record<string, string> }> = [];

type Sub = Record<string, unknown>;

const stripeIs = (subs: Sub[]) => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const body = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
    calls.push({ method, path: u.pathname, query: u.searchParams, body });
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/v1/subscriptions') return json({ data: subs });
    if (u.pathname.startsWith('/v1/subscriptions/')) {
      // Stripe answers the updated subscription; the code re-reads anyway
      return json(subs[0] ?? {});
    }
    if (u.pathname === '/v1/prices') {
      const key = u.searchParams.get('lookup_keys[]');
      const plan = PLANS.find(p => key === `apex_${p.key.toLowerCase()}_monthly`)!;
      return json({ data: [{ id: 'price_new', active: true, unit_amount: plan.pricePencePerMonth, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } }] });
    }
    return json({ id: 'obj_1' });
  }) as never;
};

const sub = (lookupKey: string | null, over: Sub = {}): Sub => ({
  id: 'sub_1',
  status: 'active',
  items: { data: [{ id: 'si_1', price: { id: 'price_old', lookup_key: lookupKey } }] },
  ...over,
});

const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });
const org = () => prisma.organisation.findUniqueOrThrow({ where: { id: T.orgId } });
const updatesTo = (id: string) => calls.filter((c) => c.method === 'POST' && c.path === `/v1/subscriptions/${id}`);
const checkoutSessions = () => calls.filter((c) => c.path === '/v1/checkout/sessions');

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('PlanChange');
  await prisma.organisation.update({
    where: { id: T.orgId },
    data: { stripeCustomerId: 'cus_test', stripeSubscriptionId: 'sub_1', plan: 'STARTER' },
  });
}, 120_000);

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = realKey;
});

describe('switching plan changes the subscription there is', () => {
  it('updates the existing subscription item rather than opening a second one', async () => {
    stripeIs([sub('apex_starter_monthly')]);
    await admin().billing.changePlan({ plan: 'GROWTH' } as never);
    expect(checkoutSessions(), 'a plan switch opened a second subscription').toHaveLength(0);
    const [update] = updatesTo('sub_1');
    expect(update, 'nothing was sent to the existing subscription').toBeTruthy();
    expect(update!.body['items[0][id]']).toBe('si_1');
    expect(update!.body['items[0][price]']).toBe('price_new');
  });

  /**
   * The customer-facing half of why one subscription is the right shape: Stripe
   * credits the unused part of the old plan. Two subscriptions bill in full.
   */
  it('prorates, so the part of the month already paid for is credited', async () => {
    stripeIs([sub('apex_starter_monthly')]);
    await admin().billing.changePlan({ plan: 'GROWTH' } as never);
    expect(updatesTo('sub_1')[0]!.body['proration_behavior']).toBe('create_prorations');
  });

  /**
   * Choosing a plan is a statement of intent to keep paying. Switching plan and
   * still stopping at the end of the month is a state nobody asks for and
   * nothing in the panel could have explained.
   */
  it('withdraws a cancellation that had been scheduled', async () => {
    stripeIs([sub('apex_starter_monthly', { cancel_at_period_end: true, cancel_at: 1_900_000_000 })]);
    await admin().billing.changePlan({ plan: 'ENTERPRISE' } as never);
    expect(updatesTo('sub_1')[0]!.body['cancel_at_period_end']).toBe('false');
  });

  it('withdraws a cancellation even when the customer chooses the same plan', async () => {
    stripeIs([sub('apex_growth_monthly', { cancel_at_period_end: true })]);
    await admin().billing.changePlan({ plan: 'GROWTH' });
    expect(updatesTo('sub_1')[0]!.body).toEqual({ cancel_at_period_end: 'false' });
  });
  it('reflects the new plan on the workspace', async () => {
    stripeIs([sub('apex_growth_monthly')]);
    expect(await admin().billing.changePlan({ plan: 'GROWTH' } as never)).toMatchObject({ plan: 'GROWTH' });
    expect((await org()).plan).toBe('GROWTH');
  });

  /** Pressing the tier you are already on should cost nothing and change nothing. */
  it('sends no Stripe write when the subscription is already on that plan', async () => {
    stripeIs([sub('apex_growth_monthly')]);
    await admin().billing.changePlan({ plan: 'GROWTH' } as never);
    expect(updatesTo('sub_1')).toHaveLength(0);
  });

  it('records the change in the audit trail', async () => {
    stripeIs([sub('apex_starter_monthly')]);
    await admin().billing.changePlan({ plan: 'ENTERPRISE' } as never);
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: 'changed the subscription plan' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)!.target).toContain('Enterprise');
  });

  it('refuses when there is nothing to change', async () => {
    stripeIs([]);
    await expect(admin().billing.changePlan({ plan: 'GROWTH' } as never)).rejects.toThrow(/no active subscription/i);
    expect(updatesTo('sub_1'), 'it wrote to Stripe anyway').toHaveLength(0);
  });
});

/**
 * The state the old bug left behind. A firm that switched plan before this fix
 * has two live subscriptions, and `billing.sync` used to take
 * `data.find(s => s.status === 'active')` — the first Stripe listed — so the
 * workspace ran at an arbitrary one of the two plans it was paying for.
 */
describe('two live subscriptions are not guessed between', () => {
  const twice = () => [sub('apex_starter_monthly'), sub('apex_growth_monthly', { id: 'sub_2' })];

  it('leaves the plan alone rather than running at whichever came back first', async () => {
    await prisma.organisation.update({ where: { id: T.orgId }, data: { plan: 'ENTERPRISE' } });
    stripeIs(twice());
    expect(await admin().billing.sync()).toMatchObject({ plan: 'ENTERPRISE', ambiguous: true });
    expect((await org()).plan).toBe('ENTERPRISE');
  });

  it('says so in the trail, which is the only place a reader could find out', async () => {
    stripeIs(twice());
    await admin().billing.sync();
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: 'subscription needs attention' },
      orderBy: { at: 'desc' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.target).toContain('2 live subscriptions');
  });

  it('refuses to change one of them, because the other would keep billing', async () => {
    stripeIs(twice());
    await expect(admin().billing.changePlan({ plan: 'GROWTH' } as never)).rejects.toThrow(/2 live subscriptions/);
  });

  it('does not name one of the two as the workspace’s subscription', async () => {
    await prisma.organisation.update({ where: { id: T.orgId }, data: { stripeSubscriptionId: 'sub_1' } });
    stripeIs(twice());
    await admin().billing.sync();
    expect((await org()).stripeSubscriptionId, 'one of two was picked').toBe('sub_1');
  });
});

it('keeps the stored cancellation date in an ambiguous reconciliation answer', async () => {
  const cancellation = new Date('2027-01-01T00:00:00Z');
  await prisma.organisation.update({ where: { id: T.orgId }, data: { subscriptionCancelAt: cancellation } });
  try {
    stripeIs([sub('apex_growth_monthly'), sub('apex_enterprise_monthly', { id: 'sub_other' })]);
    expect((await admin().billing.sync()).cancelAt).toEqual(cancellation);
    expect((await org()).subscriptionCancelAt).toEqual(cancellation);
  } finally {
    await prisma.organisation.update({ where: { id: T.orgId }, data: { subscriptionCancelAt: null } });
  }
});

describe('a subscription can be cancelled, and the cancellation withdrawn', () => {
  beforeAll(async () => {
    await prisma.organisation.update({
      where: { id: T.orgId },
      data: { plan: 'GROWTH', stripeSubscriptionId: 'sub_1', subscriptionCancelAt: null },
    });
  });

  /**
   * At the END of the paid period. The period is paid for, so cutting the
   * features off on the spot would take away what the firm has already bought,
   * mid-task, and leave the refund question to be answered by hand.
   */
  it('cancels at the end of the period rather than immediately', async () => {
    stripeIs([sub('apex_growth_monthly')]);
    await admin().billing.cancelPlan();
    expect(updatesTo('sub_1')[0]!.body['cancel_at_period_end']).toBe('true');
    // and Stripe is not asked to delete it, which would end it now
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('keeps the plan working until that date, and stores when it is', async () => {
    stripeIs([sub('apex_growth_monthly', { cancel_at_period_end: true, cancel_at: 1_900_000_000 })]);
    const res = await admin().billing.cancelPlan();
    expect(res.plan, 'the features went the moment the firm cancelled').toBe('GROWTH');
    expect(res.cancelAt?.toISOString()).toBe(new Date(1_900_000_000 * 1000).toISOString());
    expect((await org()).subscriptionCancelAt, 'the panel could not say so on a page load').not.toBeNull();
  });

  it('records the cancellation', async () => {
    stripeIs([sub('apex_growth_monthly')]);
    await admin().billing.cancelPlan();
    expect(
      await prisma.activityEvent.count({ where: { orgId: T.orgId, action: 'cancelled the subscription' } }),
    ).toBeGreaterThanOrEqual(1);
  });

  /** Until the date arrives nothing has happened, so a mis-click costs nothing. */
  it('can be withdrawn', async () => {
    stripeIs([sub('apex_growth_monthly')]);
    const res = await admin().billing.resumePlan();
    expect(updatesTo('sub_1')[0]!.body['cancel_at_period_end']).toBe('false');
    expect(res.cancelAt).toBeNull();
    expect((await org()).subscriptionCancelAt).toBeNull();
  });

  it('records the withdrawal too', async () => {
    stripeIs([sub('apex_growth_monthly')]);
    await admin().billing.resumePlan();
    expect(
      await prisma.activityEvent.count({
        where: { orgId: T.orgId, action: 'withdrew the subscription cancellation' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('refuses when there is no subscription at all', async () => {
    stripeIs([]);
    await expect(admin().billing.cancelPlan()).rejects.toThrow(/no active subscription/i);
  });

  it('is admin-only — a plan is not an analyst’s to end', async () => {
    stripeIs([sub('apex_growth_monthly')]);
    await expect(callerFor({ ...T.principal, role: 'ANALYST' }).billing.cancelPlan()).rejects.toThrow(
      /FORBIDDEN|admin/i,
    );
    expect(updatesTo('sub_1')).toHaveLength(0);
  });

  /**
   * Isolation here is not a `where` clause — it is WHICH Stripe customer is
   * asked about, which is why the assertion reads the query rather than the
   * refusal. A version that looked the subscription up by id alone would refuse
   * nothing and cancel ours.
   */
  it('asks Stripe about the caller’s own customer, never this workspace’s', async () => {
    const other = await makeTenant('PlanChangeOther');
    await prisma.organisation.update({ where: { id: other.orgId }, data: { stripeCustomerId: 'cus_other' } });
    stripeIs([]);
    await expect(callerFor({ ...other.principal, role: 'ADMIN' }).billing.cancelPlan()).rejects.toThrow();
    const queried = calls.filter((c) => c.path === '/v1/subscriptions').map((c) => c.query.get('customer'));
    expect(queried, 'Stripe was never asked, so the refusal proves nothing').toEqual(['cus_other']);
    expect((await org()).stripeSubscriptionId, 'another firm’s call touched this workspace').toBe('sub_1');
  });
});
