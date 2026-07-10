import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { appraisalRowToEngineInput, P } from '../mappers.js';
import { computeAppraisal } from '@apex/appraisal-engine';
import { internalProcedure, router } from '../trpc.js';

const REGION_BY_COUNTY: Array<[RegExp, string]> = [
  [/dorset|bournemouth|poole|hampshire|devon|somerset|bristol/i, 'South West'],
  [/london/i, 'London'],
  [/kent|surrey|sussex|berkshire|oxford/i, 'South East'],
];

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export const benchmarksRouter = router({
  /** Percentile strips for build £/ft², GDV £/ft² and profit-on-cost + your marker + rank. */
  metrics: internalProcedure
    .input(z.object({ region: z.string(), useClass: z.string() }))
    .query(async ({ ctx, input }) => {
      const metrics = ['buildPsf', 'gdvPsf', 'poc'] as const;
      const out: Record<string, unknown> = {};
      for (const metric of metrics) {
        const market = await ctx.prisma.benchmarkPoint.findMany({
          where: { region: input.region, useClass: input.useClass, metric, isOwn: false },
          select: { value: true },
        });
        const own = await ctx.prisma.benchmarkPoint.findMany({
          where: { region: input.region, useClass: input.useClass, metric, isOwn: true, orgId: ctx.principal.orgId },
          select: { value: true, dealName: true, period: true },
        });
        const values = market.map((v) => v.value).sort((a, b) => a - b);
        const yours = own.length ? own[own.length - 1].value : null;
        const rank = yours != null && values.length ? Math.round((values.filter((v) => v <= yours).length / values.length) * 100) : null;
        out[metric] = {
          lo: quantile(values, 0.05),
          p25: quantile(values, 0.25),
          median: quantile(values, 0.5),
          p75: quantile(values, 0.75),
          hi: quantile(values, 0.95),
          yours,
          rank,
          sampleSize: values.length,
          ownDeals: own,
        };
      }
      return out as Record<'buildPsf' | 'gdvPsf' | 'poc', {
        lo: number; p25: number; median: number; p75: number; hi: number;
        yours: number | null; rank: number | null; sampleSize: number;
        ownDeals: Array<{ value: number; dealName: string | null; period: string }>;
      }>;
    }),

  /** Build-cost trend: market median per quarter vs your deals. */
  trend: internalProcedure
    .input(z.object({ region: z.string(), useClass: z.string() }))
    .query(async ({ ctx, input }) => {
      const points = await ctx.prisma.benchmarkPoint.findMany({
        where: { region: input.region, useClass: input.useClass, metric: 'buildPsf' },
        select: { value: true, period: true, isOwn: true, dealName: true },
        orderBy: { period: 'asc' },
      });
      const periods = [...new Set(points.map((pt) => pt.period))].sort();
      return periods.map((period) => {
        const market = points.filter((pt) => pt.period === period && !pt.isOwn).map((pt) => pt.value).sort((a, b) => a - b);
        const own = points.filter((pt) => pt.period === period && pt.isOwn);
        const mid = market.length ? market[Math.floor(market.length / 2)] : 0;
        return { period, marketMedian: mid, own: own.map((o) => ({ value: o.value, dealName: o.dealName })) };
      });
    }),

  /**
   * REAL market index — UK House Price Index (HM Land Registry, OGL): regional
   * average price + annual growth, latest 12 published months. This is genuine
   * market data, distinct from the org-contributed appraisal benchmarks.
   */
  hpi: internalProcedure.input(z.object({ region: z.string() })).query(async ({ input }) => {
    const { fetchHpi } = await import('../opendata.js');
    try {
      return { status: 'ok' as const, ...(await fetchHpi(input.region)) };
    } catch {
      return { status: 'error' as const, region: input.region, series: [] };
    }
  }),

  /** Contribution count for the "data moat" footer. */
  contributions: internalProcedure.query(async ({ ctx }) => {
    const total = await ctx.prisma.benchmarkPoint.count({ where: { isOwn: false } });
    const yours = await ctx.prisma.benchmarkPoint.count({ where: { isOwn: true, orgId: ctx.principal.orgId } });
    return { total, yours };
  }),

  /**
   * The data moat: contribute a deal's appraisal metrics (build £/ft², GDV £/ft²,
   * profit on cost) into the anonymised aggregate. Region inferred from the address;
   * only derived ratios leave the org — never absolute money or the address itself.
   */
  contribute: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const deal = await ctx.prisma.deal.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
    const row = await ctx.prisma.appraisal.findFirst({
      where: { dealId: deal.id, orgId: ctx.principal.orgId, isCurrent: true },
    });
    if (!row) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Save an appraisal before contributing' });
    const R = computeAppraisal(appraisalRowToEngineInput(row));
    if (R.gia <= 0 || R.gdv <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Appraisal has no areas/revenue yet' });
    const region = REGION_BY_COUNTY.find(([re]) => re.test(deal.address))?.[1] ?? 'South West';
    const now = new Date();
    const period = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    const points: Array<[string, number]> = [
      ['buildPsf', R.buildRate],
      ['gdvPsf', R.gdv / R.gia],
      ['poc', R.poc],
    ];
    // replace this deal's previous contribution for the period, then write fresh points
    await ctx.prisma.benchmarkPoint.deleteMany({
      where: { isOwn: true, orgId: ctx.principal.orgId, dealName: deal.name, period },
    });
    for (const [metric, value] of points) {
      await ctx.prisma.benchmarkPoint.create({
        data: {
          region,
          useClass: deal.assetType,
          metric,
          period,
          value,
          isOwn: true,
          orgId: ctx.principal.orgId,
          dealName: deal.name,
        },
      });
    }
    await ctx.prisma.activityEvent.create({
      data: { orgId: ctx.principal.orgId, dealId: deal.id, actor: ctx.principal.name, action: 'contributed to benchmark', target: `${region} · ${deal.assetType.toLowerCase()} · ${period}` },
    });
    return { region, useClass: deal.assetType, period };
  }),
});
