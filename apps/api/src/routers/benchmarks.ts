import { z } from 'zod';
import { internalProcedure, router } from '../trpc.js';

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

  /** Contribution count for the "data moat" footer. */
  contributions: internalProcedure.query(async ({ ctx }) => {
    const total = await ctx.prisma.benchmarkPoint.count({ where: { isOwn: false } });
    const yours = await ctx.prisma.benchmarkPoint.count({ where: { isOwn: true, orgId: ctx.principal.orgId } });
    return { total, yours };
  }),
});
