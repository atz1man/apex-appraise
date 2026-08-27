import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS } from '../src/stripe.js';
import {
  FEATURE_COPY,
  PAID_PLANS_BY_PRICE,
  PLAN_ENTITLEMENTS,
  PLAN_FEATURES,
  cheapestPlanWith,
  entitlementsFor,
  featuresFor,
  type Feature,
  type PlanKey,
} from '../src/entitlements.js';
import { registerPublicApi } from '../src/public-api.js';
import { emitWebhook } from '../src/webhook-delivery.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * What the pricing page SELLS versus what the server ENFORCES — for the features,
 * not just the volumes.
 *
 * entitlements.test.ts already pins "3 active deals" and "10 team members" to the
 * numbers that are counted. Everything else on the page was decoration: the AI
 * Development Director, both portals, benchmarking and the public API were all
 * switched on for a £49 Starter subscriber, so the only reason anyone had to move
 * to Growth was a fourth deal.
 *
 * Two properties are worth more than any individual assertion below.
 *
 * The first is that a NEW line of marketing copy fails this file until somebody
 * decides whether it is gated — otherwise the page drifts ahead of the server
 * again and nobody finds out until a customer does.
 *
 * The second is that turning a feature off must never take away a control the
 * customer needs in order to LEAVE: revoking a key, deleting an endpoint,
 * withdrawing contributed figures. A billing change that becomes a security
 * incident, or that traps a firm's data in a shared pool, is a worse failure than
 * the revenue leak this fixes.
 */

let T: Tenant;
const setPlan = (plan: PlanKey | string) =>
  prisma.organisation.update({ where: { id: T.orgId }, data: { plan } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Plans');
}, 120_000);

/** The refusal every feature gate produces, and nothing else produces. */
const PLAN_REFUSAL = /is included from (Starter|Growth|Enterprise)/;

const messageOf = async (call: () => Promise<unknown>): Promise<string | null> => {
  try {
    await call();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

/** Refused, and refused FOR THE PLAN — not for some unrelated reason. */
async function expectPlanRefusal(label: string, call: () => Promise<unknown>) {
  const message = await messageOf(call);
  expect(message, `${label} was allowed`).not.toBeNull();
  expect(message, `${label} was refused, but not for the plan`).toMatch(PLAN_REFUSAL);
}

/**
 * Allowed by the plan. The call may still fail — no documents, no model key, no
 * investor row — and that is fine. What must not appear is the plan refusal.
 */
async function expectPlanAllows(label: string, call: () => Promise<unknown>) {
  const message = await messageOf(call);
  if (message !== null) expect(message, `${label} was refused for the plan`).not.toMatch(PLAN_REFUSAL);
}

// ── the page and the enforcement ────────────────────────────────────────────

/**
 * Copy that is deliberately not a feature gate. Each entry is a decision, and
 * writing the reason down is the point: the next person to read the pricing page
 * can see that "Priority support" was considered and rejected rather than missed.
 */
const NOT_A_GATE: Record<string, string> = {
  'Appraisal engine + reports':
    'baseline — the deterministic engine and the printed documents are on every plan, including the expired trial',
  'Site pack (open data)':
    'baseline — open data costs us a cache lookup, and a firm that cannot see a flood map cannot value a site',
  'Everything in Growth': 'structural, not a capability — asserted below as a superset instead',
  'Priority support': 'a human commitment; nothing in this repository can enforce or withhold it',
};

const isVolumeCopy = (s: string) => /^(Unlimited (deals|members)|\d+ (active deals|team members))$/.test(s);

describe('the pricing page and the server', () => {
  it('accounts for every word of marketing copy', () => {
    const gated = new Set(Object.values(FEATURE_COPY));
    const unaccounted = PLANS.flatMap((p) =>
      p.features
        .filter((f) => !gated.has(f) && !isVolumeCopy(f) && !(f in NOT_A_GATE))
        .map((f) => `${p.key}: ${f}`),
    );
    // add a line to a plan and this fails until it is classified: gated by a
    // Feature key, pinned as a volume, or listed in NOT_A_GATE with a reason
    expect(unaccounted).toEqual([]);
  });

  it('sells every feature it enforces', () => {
    // the mirror of the test above: a Feature key nobody is sold is enforcement
    // against a promise we never made
    for (const [key, copy] of Object.entries(FEATURE_COPY)) {
      const sold = PLANS.some((p) => p.features.includes(copy));
      expect(sold, `${key} is enforced but appears on no plan`).toBe(true);
    }
  });

  it('switches each feature on at the plan whose column it appears in', () => {
    for (const plan of PLANS) {
      for (const [key, copy] of Object.entries(FEATURE_COPY) as Array<[Feature, string]>) {
        if (plan.features.includes(copy)) {
          expect(PLAN_FEATURES[plan.key].includes(key), `${plan.key} sells ${copy} but does not grant it`).toBe(true);
        }
      }
    }
  });

  it('orders the upgrade path by price', () => {
    // cheapestPlanWith() decides what a refusal tells you to buy; if this list
    // ever stopped matching the prices it would name the wrong plan
    const byPrice = [...PLANS].sort((a, b) => a.pricePencePerMonth - b.pricePencePerMonth).map((p) => p.key);
    expect([...PAID_PLANS_BY_PRICE]).toEqual(byPrice);
  });

  it('never takes a feature away as the price goes up', () => {
    // "Everything in Growth" is a printed promise, and it is the only reason a
    // Growth customer is willing to be moved to Enterprise
    for (let i = 1; i < PAID_PLANS_BY_PRICE.length; i++) {
      const cheaper = PLAN_FEATURES[PAID_PLANS_BY_PRICE[i - 1]!];
      const dearer = PLAN_FEATURES[PAID_PLANS_BY_PRICE[i]!];
      for (const f of cheaper) expect(dearer, `${PAID_PLANS_BY_PRICE[i]} drops ${f}`).toContain(f);
    }
  });

  it('gives an unrecognised plan no features, where it gives it trial volumes', () => {
    // the two fallbacks point in OPPOSITE directions on purpose: TRIAL is the
    // tightest set of volumes and the most generous set of features, so reusing
    // one constant for both would hand a Stripe typo the entire product
    expect(entitlementsFor('PLATINUM')).toEqual(PLAN_ENTITLEMENTS.TRIAL);
    expect(featuresFor('PLATINUM')).toEqual([]);
    expect(featuresFor('')).toEqual([]);
  });

  it('lets a trial see everything it might buy', () => {
    // a trial that hides the AI Development Director cannot sell Growth
    expect([...PLAN_FEATURES.TRIAL].sort()).toEqual((Object.keys(FEATURE_COPY) as Feature[]).sort());
  });
});

// ── enforcement, in both directions ─────────────────────────────────────────

describe('what Starter does not get', () => {
  const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

  it('refuses the AI Development Director, and names the plan that includes it', async () => {
    await setPlan('STARTER');
    await expectPlanRefusal('autoAppraisal.extract', () =>
      admin().autoAppraisal.extract({ documentId: 'anything' } as never),
    );
    await expectPlanRefusal('appraisal.draftNarrative', () => admin().appraisal.draftNarrative(T.dealId));
    await expectPlanRefusal('scenarios.draftRisk', () => admin().scenarios.draftRisk(T.dealId));
    await expectPlanRefusal('documents.ask', () =>
      admin().documents.ask({ dealId: T.dealId, question: 'what is the GIA?' } as never),
    );
  });

  it('refuses benchmarking — the reading is the feature', async () => {
    await setPlan('STARTER');
    await expectPlanRefusal('benchmarks.metrics', () =>
      admin().benchmarks.metrics({ region: 'South West', useClass: 'RESIDENTIAL' }),
    );
    await expectPlanRefusal('benchmarks.trend', () =>
      admin().benchmarks.trend({ region: 'South West', useClass: 'RESIDENTIAL', metric: 'poc' } as never),
    );
  });

  it('refuses the portals to the portal login itself', async () => {
    await setPlan('STARTER');
    await expectPlanRefusal('investors.myPosition', () => callerFor(T.investorPrincipal).investors.myPosition());
  });

  it('refuses a new API key or webhook endpoint below Enterprise', async () => {
    await setPlan('GROWTH');
    await expectPlanRefusal('org.createApiKey', () => admin().org.createApiKey({ name: 'CI', write: false } as never));
    await expectPlanRefusal('org.createWebhook', () =>
      admin().org.createWebhook({ url: 'https://example.test/hook', events: ['deal.created'] } as never),
    );
    expect(cheapestPlanWith('publicApi')).toBe('ENTERPRISE');
  });
});

describe('what the including plan does get', () => {
  const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

  it('allows every feature on the cheapest plan that sells it', async () => {
    await setPlan('GROWTH');
    await expectPlanAllows('benchmarks.metrics', () =>
      admin().benchmarks.metrics({ region: 'South West', useClass: 'RESIDENTIAL' }),
    );
    await expectPlanAllows('scenarios.draftRisk', () => admin().scenarios.draftRisk(T.dealId));
    await expectPlanAllows('investors.myPosition', () => callerFor(T.investorPrincipal).investors.myPosition());

    await setPlan('ENTERPRISE');
    await expectPlanAllows('org.createApiKey', () => admin().org.createApiKey({ name: 'CI ok', write: false } as never));
  });
});

// ── a downgrade turns features off without taking anything away ─────────────

describe('a downgrade', () => {
  const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

  it('stops a key that was minted on Enterprise, without revoking it', async () => {
    await setPlan('ENTERPRISE');
    const made = (await admin().org.createApiKey({ name: 'integration', write: false } as never)) as { id: string; key: string };

    const app = Fastify();
    registerPublicApi(app, prisma);
    await app.ready();
    const call = () =>
      app.inject({ method: 'GET', url: '/api/v1/deals', headers: { authorization: `Bearer ${made.key}` } });

    expect((await call()).statusCode).toBe(200);

    await setPlan('STARTER');
    const refused = await call();
    // 402, not 401: the credential is fine, the subscription is not
    expect(refused.statusCode).toBe(402);
    expect(JSON.parse(refused.body).error.code).toBe('plan_required');
    expect(JSON.parse(refused.body).error.message).toMatch(PLAN_REFUSAL);

    // the key itself is untouched — a billing change must not destroy credentials
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.revokedAt).toBeNull();

    await setPlan('ENTERPRISE');
    expect((await call()).statusCode).toBe(200);
    await app.close();
  });

  it('stops webhook deliveries at the point of delivery, and queues nothing', async () => {
    await setPlan('ENTERPRISE');
    const endpoint = await prisma.webhookEndpoint.create({
      data: { orgId: T.orgId, url: 'https://example.test/hook', secret: 'whsec_x', events: 'deal.created', createdById: T.userId },
    });

    expect(await emitWebhook(prisma, T.orgId, 'deal.created', { id: T.dealId })).toBe(1);

    await setPlan('STARTER');
    expect(await emitWebhook(prisma, T.orgId, 'deal.created', { id: T.dealId })).toBe(0);
    // nothing queued means nothing to flush at the endpoint later
    expect(await prisma.webhookDelivery.count({ where: { endpointId: endpoint.id } })).toBe(1);

    // and the endpoint survives, so nobody has to re-add it
    await setPlan('ENTERPRISE');
    expect(await emitWebhook(prisma, T.orgId, 'deal.created', { id: T.dealId })).toBe(1);
    expect(await prisma.webhookEndpoint.count({ where: { id: endpoint.id } })).toBe(1);
  });

  it('still lets a downgraded workspace take its credentials back', async () => {
    await setPlan('ENTERPRISE');
    const key = (await admin().org.createApiKey({ name: 'leaving', write: false } as never)) as { id: string };
    const hook = (await admin().org.createWebhook({
      url: 'https://example.test/leaving',
      events: ['deal.created'],
    } as never)) as { id: string };

    await setPlan('STARTER');
    // listing, revoking and deleting are NOT gated — a paywall in front of
    // revocation turns a billing change into a security incident
    await expect(admin().org.apiKeys()).resolves.toBeDefined();
    await expect(admin().org.revokeApiKey({ id: key.id })).resolves.toEqual({ ok: true });
    await expect(admin().org.deleteWebhook({ id: hook.id })).resolves.toEqual({ ok: true });
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).not.toBeNull();
  });

  it('still lets a downgraded workspace withdraw its contributed figures', async () => {
    await setPlan('STARTER');
    await admin().benchmarks.setContribution({ enabled: true });
    await prisma.benchmarkPoint.create({
      data: { orgId: T.orgId, region: 'South West', useClass: 'RESIDENTIAL', metric: 'poc', value: 0.2, source: 'contributed', period: '2026-Q1' },
    });

    // reading the pool is refused on Starter, but consent is not a feature and
    // opting out withdraws what was already given
    await expectPlanRefusal('benchmarks.metrics', () =>
      admin().benchmarks.metrics({ region: 'South West', useClass: 'RESIDENTIAL' }),
    );
    const out = (await admin().benchmarks.setContribution({ enabled: false })) as { withdrawn: number };
    expect(out.withdrawn).toBeGreaterThan(0);
    expect(await prisma.benchmarkPoint.count({ where: { orgId: T.orgId, source: 'contributed' } })).toBe(0);
  });
});

// ── the public API answers in words, on every route ─────────────────────────

describe('the public API refusals', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    registerPublicApi(app, prisma);
    await app.ready();
  });
  afterAll(async () => app.close());

  const AUTHENTICATED = ['/api/v1/deals', '/api/v1/deals/x', '/api/v1/exposure', '/api/v1/webhooks'];

  it('says what was wanted, on every authenticated route', async () => {
    // three of these used to return `undefined`, which Fastify serialises as an
    // EMPTY body: a 401 with nothing in it, and the message below undelivered
    for (const url of AUTHENTICATED) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.body, `${url} answered with an empty body`).not.toBe('');
      expect(JSON.parse(res.body).error.message, url).toMatch(/Authorization: Bearer/);
      expect(res.headers['www-authenticate'], url).toContain('Bearer');
    }
  });

  it('leaves the discovery document open', async () => {
    // the root is the one route with no key, deliberately: it is how an
    // integrator finds out what a key is for
    const res = await app.inject({ method: 'GET', url: '/api/v1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.version).toBe('v1');
  });
});
