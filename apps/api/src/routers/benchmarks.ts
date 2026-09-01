import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  MIN_CONTRIBUTORS,
  MIN_POINTS,
  cohortStats,
  periodMedian,
  rankWithin,
  type CohortPoint,
} from '@apex/appraisal-engine';
import { recordAudit } from '../audit.js';
import { latestApproved } from '../current-appraisal.js';
import { METRICS, backfill, consentsToBenchmarks, feedApproved, feedOutturn, type BenchmarkMetric } from '../benchmark-feed.js';
import { adminProcedure, internalProcedure, requiresFeature, router } from '../trpc.js';

/**
 * Benchmarks built from what firms actually contribute.
 *
 * Two things were wrong with what this replaced, and they compounded:
 *
 * The "market" a firm was compared against was a pseudo-random generator in the
 * demo seed — invented figures, presented with a sample size, next to a real
 * scheme. A valuer comparing a live appraisal against numbers nobody measured is
 * a professional problem, not a cosmetic one, so provenance now travels with
 * every cohort and illustrative data is never described as market evidence.
 *
 * And contributions went nowhere. A firm pressed Contribute, the point was
 * written scoped to its own workspace, and no other firm ever read it. The screen
 * said "your deals feed the median" while the median could not see them.
 */

type Metric = BenchmarkMetric;

/**
 * Where a cohort's numbers came from.
 *
 * 'contributed' — real appraisals from other firms. Evidence.
 * 'illustrative' — demonstration figures, shown only because there is nothing
 * real yet, and labelled as such wherever they appear.
 * 'none' — nothing at all, which is a legitimate and honest answer.
 */
export type CohortBasis = 'contributed' | 'illustrative' | 'none';

/**
 * Benchmarking is a Growth feature, so READING the pool is gated — the reading is
 * the thing being sold.
 *
 * The contribution procedures below are deliberately NOT gated. setContribution
 * is a consent control, and turning it off withdraws points already given; a
 * paywall in front of it would mean a firm that shared during its trial and then
 * subscribed to Starter could no longer take its figures back out of other
 * firms' medians. Consent has to be as easy to revoke as it was to give,
 * whatever anybody is paying.
 */
const benchmarkProcedure = internalProcedure.use(requiresFeature('benchmarking'));

export const benchmarksRouter = router({
  /** Percentile strips per metric, plus where this firm sits — when that can be said honestly. */
  metrics: benchmarkProcedure
    .input(z.object({ region: z.string(), useClass: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.principal.orgId;
      const rows = await ctx.prisma.benchmarkPoint.findMany({
        where: { region: input.region, useClass: input.useClass },
        select: { value: true, metric: true, source: true, orgId: true, period: true, dealName: true },
      });

      const out: Record<string, unknown> = {};
      for (const metric of METRICS) {
        const forMetric = rows.filter((r) => r.metric === metric);

        const contributed: CohortPoint[] = forMetric
          .filter((r) => r.source === 'contributed' && r.orgId)
          .map((r) => ({ value: r.value, orgId: r.orgId! }));
        /**
         * Illustrative points share no contributor, so they would fail the
         * anonymity floor as a matter of arithmetic. They are given a synthetic
         * contributor each ONLY so the same quantile code can shape them — and
         * they are returned under their own basis, never merged with real ones.
         */
        const illustrative: CohortPoint[] = forMetric
          .filter((r) => r.source === 'illustrative')
          .map((r, i) => ({ value: r.value, orgId: `illustrative-${i}` }));

        /**
         * Fall back to illustrative figures only when there is no PUBLISHABLE
         * contributed cohort for this particular reader — which is not the same
         * as "no contributed points exist". A firm whose own schemes are the only
         * ones in a scope has nothing to compare against once its own are
         * excluded, and showing it a labelled demonstration shape is more use
         * than an empty panel, provided the label is never in doubt.
         */
        const contributedVerdict = cohortStats(contributed, { excludeOrgId: orgId });
        const useIllustrative = !contributedVerdict.published && illustrative.length > 0;
        const points = useIllustrative ? illustrative : contributed;
        const basis: CohortBasis = useIllustrative ? 'illustrative' : contributed.length ? 'contributed' : 'none';
        // a firm is never in its own cohort; irrelevant for illustrative points
        const exclude = useIllustrative ? undefined : orgId;

        const own = forMetric
          .filter((r) => r.source === 'contributed' && r.orgId === orgId)
          .sort((a, b) => a.period.localeCompare(b.period));
        const yours = own.length ? own[own.length - 1]!.value : null;

        out[metric] = {
          basis,
          cohort: cohortStats(points, { excludeOrgId: exclude }),
          yours,
          rank: rankWithin(points, yours, { excludeOrgId: exclude }),
          // deal names are this firm's own — no other firm's ever appears here
          ownDeals: own.map((o) => ({ value: o.value, dealName: o.dealName, period: o.period })),
        };
      }
      return out as Record<Metric, {
        basis: CohortBasis;
        cohort: ReturnType<typeof cohortStats>;
        yours: number | null;
        rank: number | null;
        ownDeals: Array<{ value: number; dealName: string | null; period: string }>;
      }>;
    }),

  /** Build-cost trend: the cohort median per quarter against this firm's own schemes. */
  trend: benchmarkProcedure
    .input(z.object({ region: z.string(), useClass: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.principal.orgId;
      const points = await ctx.prisma.benchmarkPoint.findMany({
        where: { region: input.region, useClass: input.useClass, metric: 'buildPsf' },
        select: { value: true, period: true, source: true, orgId: true, dealName: true },
        orderBy: { period: 'asc' },
      });

      /**
       * Decided ONCE for the whole scope, not per quarter. A series that switched
       * source between quarters would put demonstration figures and real ones on
       * the same axis, and the eye reads a line as one thing.
       */
      const contributedAll: CohortPoint[] = points
        .filter((p) => p.source === 'contributed' && p.orgId)
        .map((p) => ({ value: p.value, orgId: p.orgId! }));
      const hasIllustrative = points.some((p) => p.source === 'illustrative');
      const useIllustrative = !cohortStats(contributedAll, { excludeOrgId: orgId }).published && hasIllustrative;
      const anyContributed = !useIllustrative && contributedAll.length > 0;
      const basis: CohortBasis = useIllustrative ? 'illustrative' : anyContributed ? 'contributed' : 'none';

      const periods = [...new Set(points.map((pt) => pt.period))].sort();
      const series = periods.map((period) => {
        const inPeriod = points.filter((pt) => pt.period === period);
        const cohortPoints: CohortPoint[] = anyContributed
          ? inPeriod.filter((p) => p.source === 'contributed' && p.orgId).map((p) => ({ value: p.value, orgId: p.orgId! }))
          : inPeriod.filter((p) => p.source === 'illustrative').map((p, i) => ({ value: p.value, orgId: `illustrative-${i}` }));
        return {
          period,
          /**
           * Null where the quarter is too thin to publish. The previous version
           * took the middle of whatever it had — two points from one firm drew a
           * market median somebody could read a tender-conditions story into.
           */
          cohortMedian: periodMedian(cohortPoints, { excludeOrgId: anyContributed ? orgId : undefined }),
          // only ever this firm's own schemes, by name
          own: inPeriod
            .filter((p) => p.source === 'contributed' && p.orgId === orgId)
            .map((o) => ({ value: o.value, dealName: o.dealName })),
        };
      });
      return { basis, series };
    }),

  /**
   * REAL market index — UK House Price Index (HM Land Registry, OGL): regional
   * average price + annual growth, latest 12 published months. Genuinely
   * measured data, and distinct from the contributed appraisal cohorts above.
   */
  hpi: benchmarkProcedure.input(z.object({ region: z.string() })).query(async ({ input }) => {
    const { fetchHpi } = await import('../opendata.js');
    try {
      return { status: 'ok' as const, ...(await fetchHpi(input.region)) };
    } catch {
      return { status: 'error' as const, region: input.region, series: [] };
    }
  }),

  /** What the pool actually holds, and whether this firm is part of it. */
  contributions: internalProcedure.query(async ({ ctx }) => {
    const contributed = await ctx.prisma.benchmarkPoint.findMany({
      where: { source: 'contributed', orgId: { not: null } },
      select: { orgId: true },
    });
    const org = await ctx.prisma.organisation.findUnique({
      where: { id: ctx.principal.orgId },
      select: { contributesBenchmarks: true },
    });
    return {
      total: contributed.length,
      // the honest headline: how many FIRMS, not how many rows
      firms: new Set(contributed.map((c) => c.orgId)).size,
      yours: contributed.filter((c) => c.orgId === ctx.principal.orgId).length,
      optedIn: org?.contributesBenchmarks ?? false,
      minContributors: MIN_CONTRIBUTORS,
      minPoints: MIN_POINTS,
    };
  }),

  /**
   * Turn contribution on or off.
   *
   * Admin only: the figures are a client's, and whether they join a shared pool
   * is not a decision for whoever happens to be looking at the screen.
   */
  setContribution: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    /**
     * Both writes or neither.
     *
     * Opting out WITHDRAWS what was already given. A switch that only stops
     * future contributions would leave a firm's figures in other firms' medians
     * after it asked to leave — which is not what anyone means by turning it
     * off, and is the whole point of the test below.
     *
     * The flag was flipped first and the points deleted second, on separate
     * round trips. A fault between them — a dropped connection, the process
     * killed mid-request — left the switch reading "not contributing" while the
     * points stayed in the pool, and the audit event never written, because the
     * throw came before it. Consent withdrawn in the interface and not in the
     * data is the one direction that must not be possible: these are ratios
     * derived from client-confidential appraisals, and this repo has twice had
     * to go back for rows an erasure left behind (`1cdf171`, `77c95e2`).
     */
    let withdrawn = 0;
    await ctx.prisma.$transaction(async (tx) => {
      await tx.organisation.update({
        where: { id: ctx.principal.orgId },
        data: { contributesBenchmarks: input.enabled },
      });
      if (!input.enabled) {
        const { count } = await tx.benchmarkPoint.deleteMany({
          where: { orgId: ctx.principal.orgId, source: 'contributed' },
        });
        withdrawn = count;
      }
    });

    /**
     * Opting in puts the signed-off book in at once. Consent used to switch on a
     * button that then had to be pressed per deal, per quarter; a firm that
     * consented and pressed nothing contributed nothing, and the pool grew by
     * memory. Every deal with an approved version, and the out-turn of every
     * completed one, goes in here — through the same feed approval uses.
     */
    const actor = { userId: ctx.principal.userId, name: ctx.principal.name, ip: ctx.ip };
    const contributed = input.enabled ? await backfill(ctx.prisma, ctx.principal.orgId, actor) : 0;

    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId,
      userId: ctx.principal.userId,
      actor: ctx.principal.name,
      action: input.enabled ? 'enabled benchmark contribution' : 'disabled benchmark contribution',
      target: input.enabled
        ? `anonymised appraisal ratios · ${contributed} deal${contributed === 1 ? '' : 's'} with approved figures contributed`
        : `withdrew ${withdrawn} contributed points`,
    });
    return { enabled: input.enabled, withdrawn, contributed };
  }),

  /**
   * Contribute a deal's ratios to the shared pool, by hand.
   *
   * Approval does this automatically now (see `benchmark-feed.ts`), so this is
   * for a deal approved before the firm consented, or a scheme completed before
   * the feed existed. It contributes the latest APPROVED version, never the
   * current draft: a figure nobody has signed off is not market evidence, and
   * this used to send whatever the current row held.
   *
   * Only derived ratios leave the workspace — build £/ft², GDV £/ft², profit on
   * cost, and for a completed scheme its out-turn build £/ft². Never absolute
   * money, never the address, and the deal name is stored only so this firm can
   * find its own point again.
   */
  contribute: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    if (!(await consentsToBenchmarks(ctx.prisma, ctx.principal.orgId))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Benchmark contribution is off for this workspace. An administrator can turn it on in Benchmarking.',
      });
    }

    const deal = await ctx.prisma.deal.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
    const approved = await latestApproved(ctx.prisma.appraisal, deal.id, ctx.principal.orgId);
    if (!approved) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Approve an appraisal first — only figures the firm has signed off enter the pool.',
      });
    }
    const actor = { userId: ctx.principal.userId, name: ctx.principal.name, ip: ctx.ip };
    const fed = await feedApproved(ctx.prisma, ctx.principal.orgId, deal, approved, actor);
    if (!fed) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Appraisal has no areas/revenue yet' });
    const outturn = await feedOutturn(ctx.prisma, ctx.principal.orgId, deal, actor);
    return { region: fed.region, useClass: fed.useClass, period: fed.period, outturn: !!outturn };
  }),
});
