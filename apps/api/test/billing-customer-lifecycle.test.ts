import { PLANS } from '../src/stripe.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopWorkspaceBilling } from '../src/billing.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
let A: Tenant;
let B: Tenant;
const admin = () => callerFor({ ...A.principal, role: 'ADMIN' });
const calls: Array<{ path: string; method: string; body: URLSearchParams; headers: Headers }> = [];
let subscriptions: object[] = [];
let sessions: object[] = [];
beforeAll(async () => { resetDatabase(); A = await makeTenant('Customer'); B = await makeTenant('Neighbour'); });
beforeEach(async () => {
  calls.length = 0; subscriptions = []; sessions = [];
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('APP_URL', 'https://customer.example.test');
  await prisma.organisation.update({ where: { id: A.orgId }, data: { stripeCustomerId: 'cus_a', stripeSubscriptionId: null, subscriptionStatus: null } });
  await prisma.organisation.update({ where: { id: B.orgId }, data: { stripeCustomerId: 'cus_b' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const plan = PLANS.find(p => parsed.searchParams.get('lookup_keys[]') === `apex_${p.key.toLowerCase()}_monthly`);
    calls.push({ path, method: init?.method ?? 'GET', body: new URLSearchParams(String(init?.body ?? '')), headers: new Headers(init?.headers) });
    const data = path.startsWith('/v1/customers/') && init?.method === 'DELETE' ? { id: 'cus_a', deleted: true }
      : path === '/v1/checkout/sessions' && init?.method === 'GET' ? { data: sessions }
      : path === '/v1/customers' ? { id: 'cus_new' }
      : path === '/v1/subscriptions' ? { data: subscriptions }
      : path === '/v1/prices' ? { data: [{ id: 'price_a', active: true, unit_amount: plan?.pricePencePerMonth, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } }] }
      : { id: 'cs_a', url: 'https://billing.stripe.com/test-fixture' };
    return new Response(JSON.stringify(data));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('the server prevents a subscriber buying another subscription', () => {
  it('refuses a stored subscription before making a Stripe request', async () => {
    await prisma.organisation.update({ where: { id: A.orgId }, data: { stripeSubscriptionId: 'sub_a' } });
    await expect(admin().billing.checkout({ plan: 'GROWTH' })).rejects.toThrow(/already has a subscription/);
    expect(calls).toHaveLength(0);
  });
  it('also refuses before a webhook has saved the subscription locally', async () => {
    subscriptions = [{ id: 'sub_a', status: 'active' }];
    await expect(admin().billing.checkout({ plan: 'GROWTH' })).rejects.toThrow(/already has a subscription/);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  it.each(['past_due', 'unpaid', 'incomplete', 'trialing', 'paused'])('refuses another subscription when the existing one is %s', async status => {
    subscriptions = [{ id: 'sub_a', status }];
    await expect(admin().billing.checkout({ plan: 'STARTER' })).rejects.toThrow(/already has a subscription/);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  it('reuses an unfinished checkout instead of opening a second one', async () => {
    sessions = [{ id: 'cs_existing', mode: 'subscription', status: 'open', metadata: { plan: 'STARTER' }, url: 'https://checkout.stripe.com/existing' }];
    expect(await admin().billing.checkout({ plan: 'STARTER' })).toEqual({ url: 'https://checkout.stripe.com/existing' });
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  it('refuses a different plan while an unfinished checkout exists', async () => {
    sessions = [{ id: 'cs_existing', mode: 'subscription', status: 'open', metadata: { plan: 'STARTER' }, url: 'https://checkout.stripe.com/existing' }];
    await expect(admin().billing.checkout({ plan: 'GROWTH' })).rejects.toThrow(/unfinished checkout/);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  it('uses one customer and checkout idempotency key for simultaneous first purchases', async () => {
    await prisma.organisation.update({ where: { id: A.orgId }, data: { stripeCustomerId: null } });
    await Promise.allSettled([admin().billing.checkout({ plan: 'STARTER' }), admin().billing.checkout({ plan: 'STARTER' })]);
    const customers = calls.filter(c => c.path === '/v1/customers');
    expect(customers.length).toBeGreaterThan(0);
    expect(new Set(customers.map(c => c.headers.get('Idempotency-Key')))).toEqual(new Set([`apex-customer-${A.orgId}`]));
    const checkouts = calls.filter(c => c.path === '/v1/checkout/sessions' && c.method === 'POST');
    expect(checkouts.length).toBeGreaterThan(0);
    expect(new Set(checkouts.map(c => c.headers.get('Idempotency-Key')))).toEqual(new Set([`apex-checkout-${A.orgId}-first`]));
  });
  it('allows a first subscription for this workspace', async () => {
    await admin().billing.checkout({ plan: 'STARTER' });
    const checkout = calls.find(c => c.path === '/v1/checkout/sessions' && c.method === 'POST');
    expect(checkout?.body.get('customer')).toBe('cus_a');
    expect(checkout?.body.get('success_url')).toBe('https://customer.example.test/settings?billing=success');
  });
});

describe('payment recovery and invoice history', () => {
  it('opens only this workspace customer and records who opened it', async () => {
    expect(await admin().billing.paymentPortal()).toHaveProperty('url');
    const request = calls.find(c => c.path === '/v1/billing_portal/sessions');
    expect(request?.body.get('customer')).toBe('cus_a');
    expect(request?.body.get('return_url')).toBe('https://customer.example.test/settings?billing=success');
    expect(await prisma.activityEvent.findFirst({ where: { orgId: A.orgId, action: 'opened billing management' } })).toMatchObject({ userId: A.userId });
  });
  it('remains reachable after expiry or a failed payment', async () => {
    await prisma.organisation.update({ where: { id: A.orgId }, data: { plan: 'TRIAL', trialEndsAt: new Date(0) } });
    await expect(admin().billing.paymentPortal()).resolves.toHaveProperty('url');
  });
  it.each(['ANALYST', 'VIEWER'])('refuses %s access', async role => {
    await expect(callerFor({ ...A.principal, role }).billing.paymentPortal()).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('refuses a portal principal', async () => {
    await expect(callerFor(A.investorPrincipal).billing.paymentPortal()).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('cannot open a customer that has never subscribed', async () => {
    await prisma.organisation.update({ where: { id: A.orgId }, data: { stripeCustomerId: null } });
    await expect(admin().billing.paymentPortal()).rejects.toThrow(/Subscribe to a plan/);
    expect(calls).toHaveLength(0);
  });
});

describe('offboarding stops future billing before data is erased', () => {
  it('expires unfinished checkouts and closes the customer to prevent future subscriptions', async () => {
    sessions = [{ id: 'cs_a', mode: 'subscription' }];
    subscriptions = [{ id: 'sub_a', status: 'active' }, { id: 'sub_b', status: 'past_due' }, { id: 'sub_old', status: 'canceled' }];
    await stopWorkspaceBilling('cus_a');
    expect(calls.filter(c => c.method !== 'GET').map(c => [c.path, c.method])).toEqual([
      ['/v1/checkout/sessions/cs_a/expire', 'POST'], ['/v1/customers/cus_a', 'DELETE'],
    ]);
    for (const request of calls.filter(c => c.method === 'GET')) expect(request.body.size).toBe(0);
  });
  it('can retry after Stripe closure succeeded but local erasure failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'cus_a', deleted: true }))));
    await expect(stopWorkspaceBilling('cus_a')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not erase a workspace when cancellation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Stripe unavailable' } }), { status: 503 })));
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: A.orgId } });
    await expect(admin().org.deleteWorkspace({ confirmName: org.name })).rejects.toThrow(/Stripe unavailable/);
    expect(await prisma.organisation.findUnique({ where: { id: A.orgId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: A.userId } })).not.toBeNull();
  });
  it('refuses erasure if the billing key is missing for a Stripe customer', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: A.orgId } });
    await expect(admin().org.deleteWorkspace({ confirmName: org.name })).rejects.toThrow(/workspace has been kept/);
    expect(await prisma.organisation.findUnique({ where: { id: A.orgId } })).not.toBeNull();
  });
});

describe('ambiguous Stripe customer mappings isolate billing', () => {
  it.each(['portal', 'checkout', 'sync', 'delete'])('refuses %s before contacting Stripe', async operation => {
    await prisma.organisation.update({ where: { id: B.orgId }, data: { stripeCustomerId: 'cus_a' } });
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: A.orgId } });
    const action = operation === 'portal' ? admin().billing.paymentPortal()
      : operation === 'checkout' ? admin().billing.checkout({ plan: 'STARTER' })
      : operation === 'sync' ? admin().billing.sync()
      : admin().org.deleteWorkspace({ confirmName: org.name });
    await expect(action).rejects.toThrow(/multiple workspaces/);
    expect(calls).toHaveLength(0);
    expect(await prisma.organisation.findUnique({ where: { id: A.orgId } })).not.toBeNull();
    expect(await prisma.organisation.findUnique({ where: { id: B.orgId } })).not.toBeNull();
  });
});

it('explains a partially completed erasure rather than reopening billing', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    new URL(url).pathname.startsWith('/v1/customers/') ? { deleted: true } : { data: [] },
  ))));
  await expect(admin().billing.checkout({ plan: 'STARTER' })).rejects.toThrow(/Retry Delete workspace/);
  await expect(admin().billing.paymentPortal()).rejects.toThrow(/Retry Delete workspace/);
});
