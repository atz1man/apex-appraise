import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { currentAppraisal, currentAppraisals, currentByDeal } from './current-appraisal.js';
import {
  aggregateExposure,
  computeAppraisal,
  costRollup,
  monthsBetween,
  postcodeArea,
  reconcileCash,
  spendAgainstProgramme,
  testCovenants,
  type CostPackageLike,
} from '@apex/appraisal-engine';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './context.js';
import { appraisalRowToEngineInput } from './mappers.js';
import { hasScope, principalFromApiKey, type ApiPrincipal } from './api-keys.js';
import { FEATURE_COPY, cheapestPlanWith, planHasFeature } from './entitlements.js';
import { APP_URL } from './email.js';

/**
 * The public API.
 *
 * Versioned in the path from the first day it exists. `/api/v1` is a promise
 * about shape, and the only way to keep it while the product moves is to have
 * somewhere else to put v2.
 *
 * Every figure is computed by the same engine the screens use. An API that
 * carried its own arithmetic would eventually disagree with the report a client
 * was sent, and the customer would be right to believe whichever one was worse.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

interface ApiError {
  error: { code: string; message: string };
}

const fail = (reply: FastifyReply, status: number, code: string, message: string): ApiError => {
  reply.code(status);
  return { error: { code, message } };
};

/**
 * Resolve the key, or ANSWER — this function sends its own refusals.
 *
 * It used to set a status and hand the body back through `fail()`, which nobody
 * returned: one route replaced it with a generic object and the other three
 * returned `undefined`, which Fastify 5 serialises as an empty body. So an
 * integrator with a bad key got a bare 401 and no explanation of what was
 * wanted, and the carefully worded message below had never once been delivered.
 * Sending here means there is one copy of each refusal and no way to drop it.
 *
 * The PLAN is re-checked as well as the key, because a key is minted once and
 * used for years. The gate on createApiKey stops a Starter workspace getting a
 * key; this stops a workspace that had one and downgraded from carrying on.
 * Without it the Enterprise line on the pricing page would hold for exactly as
 * long as it took someone to subscribe, mint a key and drop to Starter.
 *
 * 402 rather than 403 for that one: this is not "you may not", it is "your
 * subscription does not include this", and an integrator reading 403 goes
 * hunting for a scope they are missing. The key is untouched and starts working
 * again the moment the plan does.
 */
async function authenticate(db: PrismaClient, req: FastifyRequest, reply: FastifyReply): Promise<ApiPrincipal | null> {
  const principal = await principalFromApiKey(db, req.headers.authorization);
  if (!principal) {
    // WWW-Authenticate so a generic HTTP client knows what was wanted
    reply.header('www-authenticate', 'Bearer realm="apex", error="invalid_token"');
    await reply
      .code(401)
      .send({ error: { code: 'unauthorised', message: 'Provide a valid API key as: Authorization: Bearer apex_live_…' } });
    return null;
  }

  const org = await db.organisation.findUnique({ where: { id: principal.orgId }, select: { plan: true } });
  if (!planHasFeature(org?.plan ?? '', 'publicApi')) {
    const need = cheapestPlanWith('publicApi');
    await reply.code(402).send({
      error: {
        code: 'plan_required',
        message: `${FEATURE_COPY.publicApi} is included from ${need.charAt(0) + need.slice(1).toLowerCase()}. This key is still valid and will work again when the workspace is on a plan that includes it.`,
      },
    });
    return null;
  }

  return principal;
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * `db` is injectable so the routes can be exercised over real HTTP against a
 * throwaway database. Without the seam nothing could reach these handlers at all,
 * which is how three of the four spent their life answering an EMPTY 401 body:
 * the credential logic was unit-tested, the RESPONSE never was.
 */
export function registerPublicApi(app: FastifyInstance, db: PrismaClient = defaultPrisma) {
  /**
   * A description of the surface, at its root. Cheap to serve and it saves the
   * first question every integrator asks.
   */
  app.get('/api/v1', async () => ({
    data: {
      version: 'v1',
      /**
       * Derived, not hardcoded. This used to name OUR OWN hosting provider's
       * hostname, handed to every integrator of every self-hosted deployment,
       * pointing at a page that did not exist on any of them. The literal is not
       * repeated here on purpose: api-docs.test.ts greps this file for it.
       */
      documentation: `${APP_URL()}/docs/api`,
      authentication: 'Bearer token — create a key in Settings → API keys',
      endpoints: [
        { method: 'GET', path: '/api/v1/deals', description: 'Deals in your workspace', query: 'limit, cursor, stage' },
        { method: 'GET', path: '/api/v1/deals/:id', description: 'One deal with its current appraisal' },
        { method: 'GET', path: '/api/v1/exposure', description: 'Portfolio exposure, concentration and covenants' },
        { method: 'GET', path: '/api/v1/webhooks', description: 'Endpoints this workspace is notified on' },
      ],
      conventions: [
        'Money is in pounds, to the penny.',
        'Pagination is by cursor, not offset — a page cannot shift under you.',
        'A deal that is not yours answers 404, the same as one that does not exist.',
      ],
    },
  }));

  app.get<{ Querystring: { limit?: string; cursor?: string; stage?: string } }>('/api/v1/deals', async (req, reply) => {
    const principal = await authenticate(db, req, reply);
    if (!principal) return reply; // authenticate() has already answered
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
    const deals = await db.deal.findMany({
      where: {
        orgId: principal.orgId,
        ...(req.query.stage ? { stage: req.query.stage } : {}),
        ...(req.query.cursor ? { id: { lt: req.query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      // one extra row decides whether there is a next page, without a count query
      take: limit + 1,
    });
    const page = deals.slice(0, limit);
    return {
      data: page.map((d) => ({
        id: d.id,
        name: d.name,
        address: d.address,
        postcode: d.postcode,
        assetType: d.assetType,
        stage: d.stage,
        gdv: money(Number(d.gdv) / 100),
        createdAt: d.createdAt,
      })),
      pagination: {
        limit,
        // an explicit cursor rather than an offset: a page that shifts under an
        // integrator because someone added a deal is a support ticket
        nextCursor: deals.length > limit ? page[page.length - 1]!.id : null,
      },
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/deals/:id', async (req, reply) => {
    const principal = await authenticate(db, req, reply);
    if (!principal) return reply; // authenticate() has already answered
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const deal = await db.deal.findFirst({ where: { id: req.params.id, orgId: principal.orgId } });
    // the same 404 for "not yours" as for "not there": an API key must not be a
    // way to discover which deal ids exist elsewhere
    if (!deal) return fail(reply, 404, 'not_found', 'No such deal');

    const appraisal = await currentAppraisal(db.appraisal, deal.id, principal.orgId);
    const result = appraisal ? computeAppraisal(appraisalRowToEngineInput(appraisal)) : null;

    return {
      data: {
        id: deal.id,
        name: deal.name,
        address: deal.address,
        postcode: deal.postcode,
        assetType: deal.assetType,
        stage: deal.stage,
        appraisal: result
          ? {
              label: appraisal!.label,
              reviewStatus: appraisal!.reviewStatus,
              updatedAt: appraisal!.updatedAt,
              gdv: money(result.gdv),
              totalCost: money(result.totalCost),
              profit: money(result.profit),
              profitOnCost: result.poc,
              residualLandValue: money(result.residualNet),
              peakDebt: money(result.facility),
              equity: money(result.equity),
            }
          : null,
      },
    };
  });

  app.get('/api/v1/exposure', async (req, reply) => {
    const principal = await authenticate(db, req, reply);
    if (!principal) return reply; // authenticate() has already answered
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const orgId = principal.orgId;
    const [deals, appraisals, packages, policy, bankAccounts] = await Promise.all([
      db.deal.findMany({ where: { orgId }, select: { id: true, name: true, assetType: true, postcode: true, stage: true } }),
      currentAppraisals(db.appraisal, orgId),
      db.costPackage.findMany({
        where: { orgId },
        select: { dealId: true, committed: true, budget: true, spent: true, forecast: true, progressPct: true, retentionPct: true },
      }),
      db.orgPolicy.findUnique({ where: { orgId } }),
      // the same bank feed `deals.exposure` reads. This route had none, so for a
      // firm with a mapped account the two surfaces answered "how much is drawn"
      // differently — this one always with committed spend, and with no
      // `drawnSource` for a consumer to notice the difference by
      db.bankAccount.findMany({
        where: { orgId, dealId: { not: null } },
        select: { dealId: true, transactions: { select: { amount: true, classification: true } } },
      }),
    ]);

    /** Per deal, the transactions of whichever accounts fund it. */
    const cashBy = new Map<string, Array<{ amount: number; classification: string }>>();
    for (const acct of bankAccounts) {
      if (!acct.dealId) continue;
      const list = cashBy.get(acct.dealId) ?? [];
      for (const t of acct.transactions) list.push({ amount: Number(t.amount), classification: t.classification });
      cashBy.set(acct.dealId, list);
    }

    /**
     * Rolled up by the ENGINE, which is the whole point of the package.
     *
     * This route carried its own budget-weighted progress — the THIRD copy of
     * one rule, beside `deals.exposure` and `cost-report.ts` — so a change to
     * the weighting basis would have had to be made in three files, and this is
     * the surface a customer's own system reads.
     */
    const byPackages = new Map<string, CostPackageLike[]>();
    for (const p of packages) {
      const list = byPackages.get(p.dealId) ?? [];
      list.push({
        budget: Number(p.budget) / 100,
        committed: Number(p.committed) / 100,
        spent: Number(p.spent) / 100,
        forecast: Number(p.forecast) / 100,
        progressPct: p.progressPct,
        retentionPct: p.retentionPct,
      });
      byPackages.set(p.dealId, list);
    }
    const costBy = new Map<string, ReturnType<typeof costRollup>>();
    for (const [dealId, list] of byPackages) costBy.set(dealId, costRollup(list, { appraisedBuild: null }));
    const limits = {
      ltgdvMaxPct: policy?.covLtgdvMaxPct ?? null,
      ltcMaxPct: policy?.covLtcMaxPct ?? null,
      minProfitOnCostPct: policy?.covMinProfitOnCostPct ?? null,
    };
    // newest-first, first-wins — the same answer the per-deal route above gives
    const byDeal = currentByDeal(appraisals);

    const positions = deals
      .map((d) => {
        const a = byDeal.get(d.id);
        if (!a) return null;
        const r = computeAppraisal(appraisalRowToEngineInput(a));
        const cost = costBy.get(d.id);
        const cash = reconcileCash({ committed: cost?.committed ?? 0, transactions: cashBy.get(d.id) as never });
        return {
          dealId: d.id,
          name: d.name,
          assetType: d.assetType,
          region: postcodeArea(d.postcode),
          stage: d.stage,
          gdv: r.gdv,
          totalCost: r.totalCost,
          facility: r.facility,
          equity: r.equity,
          drawn: cash.drawn,
          /** which of the two it is — the same disclosure the funding pack makes */
          drawnSource: cash.drawnSource,
          paid: cash.paid,
          drawdown:
            cost && cost.weightedProgressPct != null
              ? spendAgainstProgramme({
                  constructionTotal: r.build + r.fees + r.cont,
                  periodMonths: r.period,
                  profile: (a.spendProfile ?? 'SCURVE').toLowerCase() as never,
                  monthsElapsed:
                    a.startYear && a.startMonth ? monthsBetween({ year: a.startYear, month: a.startMonth }, new Date()) : 0,
                  actualToDate: cash.drawnSource === 'bank' ? cash.paid : cost.committed,
                  progressPct: cost.weightedProgressPct,
                })
              : null,
          covenants: testCovenants({ facility: r.facility, totalCost: r.totalCost, gdv: r.gdv, profit: r.profit }, limits),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    /**
     * Money is returned in pounds to the penny, everywhere on this surface.
     * The engine works in full float precision, which is right for computing and
     * wrong for an interface — "£14,848,183.911266606" is not a figure anyone can
     * do anything with, and a consumer that wanted more could not use it anyway
     * because the domain stores pence.
     */
    const book = aggregateExposure(positions);
    const round = <T,>(value: T): T => {
      if (typeof value === 'number') return (Math.round(value * 100) / 100) as T;
      if (Array.isArray(value)) return value.map(round) as T;
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)])) as T;
      }
      return value;
    };
    return { data: round(book) };
  });

  app.get('/api/v1/webhooks', async (req, reply) => {
    const principal = await authenticate(db, req, reply);
    if (!principal) return reply; // authenticate() has already answered
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const endpoints = await db.webhookEndpoint.findMany({
      where: { orgId: principal.orgId },
      select: { id: true, url: true, events: true, active: true, createdAt: true, lastAttemptAt: true, failureCount: true },
    });
    // the secret is never returned: it is shown once when the endpoint is created
    return { data: endpoints.map((e) => ({ ...e, events: e.events.split(',').filter(Boolean) })) };
  });
}
