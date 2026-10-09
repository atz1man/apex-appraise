import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWebhooks } from '../src/webhooks.js';
import { makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

const secret = 'whsec_test_fixture';
const app = Fastify();
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Subscriber');
  B = await makeTenant('Neighbour');
  await prisma.organisation.update({ where: { id: A.orgId }, data: { stripeCustomerId: 'cus_a' } });
  await prisma.organisation.update({ where: { id: B.orgId }, data: { stripeCustomerId: 'cus_b' } });
  registerWebhooks(app, prisma);
  await app.ready();
});
beforeEach(async () => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  await prisma.organisation.update({
    where: { id: A.orgId },
    data: { plan: 'TRIAL', stripeSubscriptionId: null, subscriptionStatus: null, subscriptionCancelAt: null },
  });
  await prisma.organisation.update({ where: { id: B.orgId }, data: { plan: 'TRIAL', stripeCustomerId: 'cus_b' } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => app.close());

function stripeReturns(data: unknown[], status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data }), { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const active = { id: 'sub_a', status: 'active', items: { data: [{ price: { lookup_key: 'apex_growth_monthly' } }] } };
const current = () => prisma.organisation.findUniqueOrThrow({ where: { id: A.orgId } });
const events = () => prisma.activityEvent.count({ where: { orgId: A.orgId, actor: 'Stripe' } });
function send(type: string, object: object = { customer: 'cus_a' }, signature?: string) {
  const payload = JSON.stringify({ id: 'evt_retryable', type, data: { object } });
  const time = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${time}.${payload}`).digest('hex');
  return app.inject({
    method: 'POST', url: '/webhooks/stripe', payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': signature ?? `t=${time},v1=${digest}` },
  });
}

describe('subscriptions update without someone opening Settings', () => {
  it.each([
    'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
    'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed',
  ])('reconciles current Stripe state for %s', async type => {
    const fetcher = stripeReturns([active]);
    const before = await events();
    expect((await send(type)).statusCode).toBe(200);
    expect(await current()).toMatchObject({ plan: 'GROWTH', stripeSubscriptionId: 'sub_a' });
    expect(await events()).toBe(before + 1);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('customer=cus_a'), expect.anything());
  });

  it('keeps a past-due plan available during Stripe retries and restores normal status after payment', async () => {
    stripeReturns([{ ...active, status: 'past_due' }]);
    expect((await send('invoice.payment_failed')).statusCode).toBe(200);
    expect(await current()).toMatchObject({ plan: 'GROWTH', stripeSubscriptionId: 'sub_a', subscriptionStatus: 'past_due' });
    stripeReturns([active]);
    await send('invoice.paid');
    expect(await current()).toMatchObject({ plan: 'GROWTH', subscriptionStatus: 'active' });
  });
  it('withdraws access when retries are exhausted without losing the subscription needed for payment recovery', async () => {
    stripeReturns([{ ...active, status: 'unpaid' }]);
    await send('invoice.payment_failed');
    expect(await current()).toMatchObject({ plan: 'TRIAL', stripeSubscriptionId: 'sub_a', subscriptionStatus: 'unpaid' });
  });
  it('withdraws the paid plan when Stripe reports no active subscription', async () => {
    await prisma.organisation.update({ where: { id: A.orgId }, data: { plan: 'GROWTH', stripeSubscriptionId: 'sub_a' } });
    stripeReturns([]);
    expect((await send('customer.subscription.deleted')).statusCode).toBe(200);
    expect(await current()).toMatchObject({ plan: 'TRIAL', stripeSubscriptionId: null });
  });

  it('does not replay stale plan metadata or change a different workspace', async () => {
    stripeReturns([active]);
    expect((await send('customer.subscription.updated', {
      customer: 'cus_a', status: 'canceled', metadata: { orgId: B.orgId, plan: 'ENTERPRISE' },
    })).statusCode).toBe(200);
    expect((await current()).plan).toBe('GROWTH');
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: B.orgId } })).plan).toBe('TRIAL');
  });

  it('acknowledges retries without duplicating an unchanged plan event', async () => {
    stripeReturns([active]);
    await send('customer.subscription.updated');
    const before = await events();
    expect((await send('customer.subscription.updated')).statusCode).toBe(200);
    expect(await events()).toBe(before);
  });

  it('cannot overwrite a newer plan with a slow response from an overlapping sync', async () => {
    let releaseOld!: () => void;
    let signalStarted!: () => void;
    const held = new Promise<void>(resolve => { releaseOld = resolve; });
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const newer = { ...active, items: { data: [{ price: { lookup_key: 'apex_enterprise_monthly' } }] } };
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => {
        signalStarted();
        await held;
        return new Response(JSON.stringify({ data: [active] }));
      })
      .mockImplementation(async () => new Response(JSON.stringify({ data: [newer] }))));
    const olderRequest = send('customer.subscription.updated').then(response => response);
    await started;
    try {
      expect((await send('customer.subscription.updated')).statusCode).toBe(200);
    } finally {
      releaseOld();
    }
    expect((await olderRequest).statusCode).toBe(500);
    expect((await current()).plan).toBe('ENTERPRISE');
    expect((await send('customer.subscription.updated')).statusCode).toBe(200);
    expect((await current()).plan).toBe('ENTERPRISE');
  });

  it('refuses an invalid signature before fetching or changing anything', async () => {
    const fetcher = stripeReturns([active]);
    const badSignature = `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`;
    expect((await send('customer.subscription.updated', { customer: 'cus_a' }, badSignature)).statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await current()).plan).toBe('TRIAL');
  });

  it('acknowledges customers outside this deployment without adopting metadata', async () => {
    const fetcher = stripeReturns([active]);
    expect((await send('invoice.paid', { customer: 'cus_unknown', metadata: { orgId: A.orgId } })).statusCode).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await current()).plan).toBe('TRIAL');
  });

  it('refuses an ambiguous customer mapping instead of choosing a workspace', async () => {
    await prisma.organisation.update({ where: { id: B.orgId }, data: { stripeCustomerId: 'cus_a' } });
    const fetcher = stripeReturns([active]);
    expect((await send('invoice.paid')).statusCode).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await current()).plan).toBe('TRIAL');
  });

  it('asks Stripe to retry when the current state cannot be fetched', async () => {
    stripeReturns([], 503);
    expect((await send('invoice.paid')).statusCode).toBe(500);
    expect((await current()).plan).toBe('TRIAL');
  });

  it('does not acknowledge a reconciliation when the API key is missing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect((await send('invoice.paid')).statusCode).toBe(503);
  });

  it('ignores unrelated events without calling Stripe', async () => {
    const fetcher = stripeReturns([active]);
    expect((await send('customer.updated')).statusCode).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a lifecycle event without a customer', async () => {
    expect((await send('invoice.paid', {})).statusCode).toBe(400);
  });

  it('records a first subscription even before the workspace has a deal', async () => {
    const org = await prisma.organisation.create({ data: { name: 'New subscriber', stripeCustomerId: 'cus_new' } });
    stripeReturns([active]);
    expect((await send('invoice.paid', { customer: 'cus_new' })).statusCode).toBe(200);
    expect(await prisma.activityEvent.findFirst({ where: { orgId: org.id, actor: 'Stripe' } })).toMatchObject({
      dealId: null, action: 'subscription active', target: 'GROWTH plan',
    });
  });
});
