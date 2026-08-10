import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  aggregateExposure,
  computeAppraisal,
  monthsBetween,
  postcodeArea,
  spendAgainstProgramme,
  testCovenants,
} from '@apex/appraisal-engine';
import { prisma } from './context.js';
import { appraisalRowToEngineInput } from './mappers.js';
import { hasScope, principalFromApiKey, type ApiPrincipal } from './api-keys.js';

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

/** Resolve the key, or answer 401 in the one shape every error uses. */
async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<ApiPrincipal | null> {
  const principal = await principalFromApiKey(prisma, req.headers.authorization);
  if (!principal) {
    // WWW-Authenticate so a generic HTTP client knows what was wanted
    reply.header('www-authenticate', 'Bearer realm="apex", error="invalid_token"');
    fail(reply, 401, 'unauthorised', 'Provide a valid API key as: Authorization: Bearer apex_live_…');
    return null;
  }
  return principal;
}

const money = (n: number) => Math.round(n * 100) / 100;

export function registerPublicApi(app: FastifyInstance) {
  /**
   * A description of the surface, at its root. Cheap to serve and it saves the
   * first question every integrator asks.
   */
  app.get('/api/v1', async () => ({
    data: {
      version: 'v1',
      documentation: 'https://apex-appraise-web.fly.dev/docs/api',
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
    const principal = await authenticate(req, reply);
    if (!principal) return reply.sent ? undefined : { error: { code: 'unauthorised', message: 'unauthorised' } };
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
    const deals = await prisma.deal.findMany({
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
    const principal = await authenticate(req, reply);
    if (!principal) return undefined;
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const deal = await prisma.deal.findFirst({ where: { id: req.params.id, orgId: principal.orgId } });
    // the same 404 for "not yours" as for "not there": an API key must not be a
    // way to discover which deal ids exist elsewhere
    if (!deal) return fail(reply, 404, 'not_found', 'No such deal');

    const appraisal = await prisma.appraisal.findFirst({
      where: { dealId: deal.id, orgId: principal.orgId, isCurrent: true },
    });
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
    const principal = await authenticate(req, reply);
    if (!principal) return undefined;
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const orgId = principal.orgId;
    const [deals, appraisals, packages, policy] = await Promise.all([
      prisma.deal.findMany({ where: { orgId }, select: { id: true, name: true, assetType: true, postcode: true, stage: true } }),
      prisma.appraisal.findMany({ where: { orgId, isCurrent: true } }),
      prisma.costPackage.findMany({ where: { orgId }, select: { dealId: true, committed: true, budget: true, progressPct: true } }),
      prisma.orgPolicy.findUnique({ where: { orgId } }),
    ]);

    const costBy = new Map<string, { drawn: number; budget: number; weighted: number }>();
    for (const p of packages) {
      const cur = costBy.get(p.dealId) ?? { drawn: 0, budget: 0, weighted: 0 };
      const budget = Number(p.budget) / 100;
      cur.drawn += Number(p.committed) / 100;
      cur.budget += budget;
      cur.weighted += budget * (p.progressPct ?? 0);
      costBy.set(p.dealId, cur);
    }
    const limits = {
      ltgdvMaxPct: policy?.covLtgdvMaxPct ?? null,
      ltcMaxPct: policy?.covLtcMaxPct ?? null,
      minProfitOnCostPct: policy?.covMinProfitOnCostPct ?? null,
    };
    const byDeal = new Map(appraisals.map((a) => [a.dealId, a]));

    const positions = deals
      .map((d) => {
        const a = byDeal.get(d.id);
        if (!a) return null;
        const r = computeAppraisal(appraisalRowToEngineInput(a));
        const cost = costBy.get(d.id);
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
          drawn: cost?.drawn ?? 0,
          drawdown:
            cost && cost.budget > 0
              ? spendAgainstProgramme({
                  constructionTotal: r.build + r.fees + r.cont,
                  periodMonths: r.period,
                  profile: (a.spendProfile ?? 'SCURVE').toLowerCase() as never,
                  monthsElapsed:
                    a.startYear && a.startMonth ? monthsBetween({ year: a.startYear, month: a.startMonth }, new Date()) : 0,
                  actualToDate: cost.drawn,
                  progressPct: cost.weighted / cost.budget,
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
    const principal = await authenticate(req, reply);
    if (!principal) return undefined;
    if (!hasScope(principal, 'read')) return fail(reply, 403, 'forbidden', 'This key does not carry the read scope');

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { orgId: principal.orgId },
      select: { id: true, url: true, events: true, active: true, createdAt: true, lastAttemptAt: true, failureCount: true },
    });
    // the secret is never returned: it is shown once when the endpoint is created
    return { data: endpoints.map((e) => ({ ...e, events: e.events.split(',').filter(Boolean) })) };
  });
}
