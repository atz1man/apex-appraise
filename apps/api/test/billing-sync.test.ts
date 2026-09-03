import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * WHICH plan an active subscription is.
 *
 * `billing.sync` reflects Stripe's answer onto the workspace, and where Stripe
 * did not give one it invented it:
 *
 *     const plan = metadata names a known plan ? that : active ? 'GROWTH' : 'TRIAL'
 *
 * Only `billing.checkout` writes `metadata[plan]`. A subscription created any
 * other way — in the Stripe dashboard, by support, by an importer, or before
 * that metadata existed — carries none, and every one of them was read as
 * GROWTH. A firm paying for STARTER was handed GROWTH; a firm paying for
 * ENTERPRISE was cut down to GROWTH and lost features it pays for. Neither
 * surfaces as an error anywhere: the workspace simply runs at the wrong tier.
 *
 * Nothing needed guessing. `ensurePrice` gives each plan a deterministic
 * `lookup_key`, so the subscription's PRICE names the plan — and the price is
 * what the customer actually pays.
 *
 * Stripe is driven with a stubbed `fetch`, the same way `outbound-ssrf.test.ts`
 * does it, rather than by threading a transport parameter through production
 * code that has no other use for one.
 */

let T: Tenant;
const realFetch = globalThis.fetch;
const realKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Billing');
  await prisma.organisation.update({ where: { id: T.orgId }, data: { stripeCustomerId: 'cus_test' } });
}, 120_000);

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = realKey;
});

/** One active subscription, described however the test needs it. */
const stripeReturns = (subs: unknown[]) => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: subs }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
};

const sub = (over: Record<string, unknown> = {}) => ({ id: 'sub_1', status: 'active', ...over });
const priced = (lookupKey: string | null) => ({ items: { data: [{ price: { lookup_key: lookupKey } }] } });

const setPlan = (plan: string) => prisma.organisation.update({ where: { id: T.orgId }, data: { plan } });
const planNow = async () => (await prisma.organisation.findUniqueOrThrow({ where: { id: T.orgId } })).plan;
const sync = () => callerFor({ ...T.principal, role: 'ADMIN' }).billing.sync();

describe('the plan an active subscription names', () => {
  it('comes from the price, which is what the customer pays', async () => {
    await setPlan('TRIAL');
    stripeReturns([sub(priced('apex_starter_monthly'))]);
    expect(await sync()).toMatchObject({ plan: 'STARTER' });
    expect(await planNow(), 'a STARTER subscription did not put the workspace on STARTER').toBe('STARTER');
  });

  /**
   * The direction that costs the customer rather than the vendor, and the one
   * the old fallback got wrong silently: they pay for the top tier and are cut
   * down to the middle one.
   */
  it('does not cut an enterprise subscriber down to the middle tier', async () => {
    await setPlan('TRIAL');
    stripeReturns([sub(priced('apex_enterprise_monthly'))]);
    expect(await sync()).toMatchObject({ plan: 'ENTERPRISE' });
  });

  it('still reads the metadata when the price predates the lookup keys', async () => {
    await setPlan('TRIAL');
    stripeReturns([sub({ ...priced(null), metadata: { plan: 'STARTER' } })]);
    expect(await sync()).toMatchObject({ plan: 'STARTER' });
  });

  /**
   * The fallback itself. An active subscription this server cannot identify
   * leaves the plan ALONE — not GROWTH, and not TRIAL. The customer is paying
   * and we do not know for what, so any answer is invented, and inventing one
   * either hands out features nobody bought or takes away features somebody
   * did. Driven from BOTH sides, because "leave it alone" looks like the old
   * behaviour from whichever side happens to be GROWTH already.
   */
  it('leaves an unidentifiable subscription on whatever plan the workspace already had', async () => {
    await setPlan('STARTER');
    stripeReturns([sub(priced(null))]);
    expect(await sync(), 'a STARTER subscriber was silently upgraded on an unreadable subscription').toMatchObject({
      plan: 'STARTER',
    });

    await setPlan('ENTERPRISE');
    stripeReturns([sub(priced(null))]);
    expect(await sync(), 'an ENTERPRISE subscriber was silently cut down').toMatchObject({ plan: 'ENTERPRISE' });
  });

  it('is TRIAL when nobody is paying, which is Stripe saying so rather than a guess', async () => {
    await setPlan('GROWTH');
    stripeReturns([]);
    expect(await sync()).toMatchObject({ plan: 'TRIAL' });
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: T.orgId } })).stripeSubscriptionId).toBeNull();
  });
});

/**
 * `provenance-sweep` exempts `billing.checkout` on the express grounds that
 * "billing.sync records it when it arrives". That was only half true: the audit
 * line sat inside `if (active && ...)`, so a cancellation — the change that
 * takes features away, refuses saves and locks a firm out of its work mid-task
 * — moved the workspace to TRIAL leaving no trace of when or why.
 */
describe('the record of a plan changing', () => {
  const events = () =>
    prisma.activityEvent.findMany({ where: { orgId: T.orgId, actor: 'Stripe' }, orderBy: { at: 'desc' } });

  it('is written when a subscription starts', async () => {
    await setPlan('TRIAL');
    const before = (await events()).length;
    stripeReturns([sub(priced('apex_growth_monthly'))]);
    await sync();
    const after = await events();
    expect(after.length).toBe(before + 1);
    expect(after[0]!.target).toContain('GROWTH');
  });

  it('is written when one ENDS, which is the change that takes work away', async () => {
    await setPlan('GROWTH');
    const before = (await events()).length;
    stripeReturns([]);
    await sync();
    const after = await events();
    expect(after.length, 'a workspace was dropped to TRIAL with no record of it').toBe(before + 1);
    expect(after[0]!.action).toBe('subscription ended');
    expect(after[0]!.target, 'the record does not say what was lost').toContain('GROWTH');
  });

  it('writes nothing when the plan did not move', async () => {
    await setPlan('GROWTH');
    stripeReturns([sub(priced('apex_growth_monthly'))]);
    await sync();
    const before = (await events()).length;
    await sync();
    expect((await events()).length, 'every sync wrote a line whether or not anything changed').toBe(before);
  });
});
