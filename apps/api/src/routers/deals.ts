import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { portfolioRollup } from '@apex/appraisal-engine';
import { figureStatusForStage, zAssetType, zDealStage } from '@apex/types';
import { P, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';
import { assertCanAddDeal } from '../entitlements.js';
import { aggregateExposure, computeAppraisal, monthsBetween, postcodeArea, spendAgainstProgramme } from '@apex/appraisal-engine';
import { appraisalRowToEngineInput } from '../mappers.js';

const dealOut = (d: {
  id: string; name: string; address: string; postcode?: string | null; assetType: string; stage: string;
  figureStatus: string; probability: number; gdv: bigint; forecastProfit: bigint;
  roc: number; equityRequired: bigint; viability: string; nextMilestone: string | null;
  owner?: { initials: string; name: string } | null;
}) => ({
  id: d.id,
  name: d.name,
  address: d.address,
  postcode: d.postcode ?? null,
  assetType: d.assetType,
  stage: d.stage,
  figureStatus: d.figureStatus,
  probability: d.probability,
  gdv: P(d.gdv),
  forecastProfit: P(d.forecastProfit),
  roc: d.roc,
  equityRequired: P(d.equityRequired),
  viability: d.viability,
  nextMilestone: d.nextMilestone,
  owner: d.owner ? { initials: d.owner.initials, name: d.owner.name } : null,
});

export const dealsRouter = router({
  list: internalProcedure
    .input(z.object({ stage: zDealStage.optional(), assetType: zAssetType.optional(), q: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const deals = await ctx.prisma.deal.findMany({
        where: {
          orgId: ctx.principal.orgId,
          ...(input?.stage ? { stage: input.stage } : {}),
          ...(input?.assetType ? { assetType: input.assetType } : {}),
          ...(input?.q ? { name: { contains: input.q } } : {}),
        },
        include: { owner: { select: { initials: true, name: true } } },
        orderBy: { probability: 'desc' },
      });
      const rollup = portfolioRollup(
        deals.map((d) => ({
          gdv: P(d.gdv),
          forecastProfit: P(d.forecastProfit),
          equityRequired: P(d.equityRequired),
          probability: d.probability,
          stage: d.stage,
        })),
      );
      return { deals: deals.map(dealOut), rollup };
    }),

  get: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const d = await ctx.prisma.deal.findFirst({
      where: { id: input, orgId: ctx.principal.orgId },
      include: {
        owner: { select: { initials: true, name: true } },
        _count: { select: { units: true, documents: true, comparables: true, scenarios: true, costPackages: true, tasks: true } },
      },
    });
    if (!d) throw new TRPCError({ code: 'NOT_FOUND' });
    return { ...dealOut(d), counts: d._count };
  }),

  /**
   * Portfolio exposure — the lender's view of the book.
   *
   * Facility is RE-COMPUTED from each deal's current appraisal rather than read
   * from a stored figure. Peak debt is a property of the whole monthly model, so
   * a cached number can only be as good as the day it was written; recomputing
   * means the book always agrees with the deals it sums.
   *
   * Drawn comes from cost monitoring — committed spend is what the borrower has
   * actually called on, and it is the only figure here that does not come from
   * the appraisal.
   */
  exposure: internalProcedure.query(async ({ ctx }) => {
    const orgId = ctx.principal.orgId;
    const [deals, appraisals, packages] = await Promise.all([
      ctx.prisma.deal.findMany({ where: { orgId }, select: { id: true, name: true, assetType: true, postcode: true, stage: true } }),
      ctx.prisma.appraisal.findMany({ where: { orgId, isCurrent: true } }),
      ctx.prisma.costPackage.findMany({ where: { orgId }, select: { dealId: true, committed: true, budget: true, progressPct: true } }),
    ]);
    /**
     * Progress is weighted by BUDGET, not averaged across packages. A 2%-complete
     * groundworks package and a 2%-complete £5m frame package are not equally
     * informative, and a plain mean lets a trivial package drag the number.
     */
    const costBy = new Map<string, { drawn: number; budget: number; weighted: number }>();
    for (const p of packages) {
      const cur = costBy.get(p.dealId) ?? { drawn: 0, budget: 0, weighted: 0 };
      const budget = Number(p.budget) / 100;
      cur.drawn += Number(p.committed) / 100;
      cur.budget += budget;
      cur.weighted += budget * (p.progressPct ?? 0);
      costBy.set(p.dealId, cur);
    }
    const byDeal = new Map(appraisals.map((a) => [a.dealId, a]));

    const positions = deals
      .map((d) => {
        const a = byDeal.get(d.id);
        // a deal with no appraisal has no facility to be exposed to — it is a
        // prospect, not a position, and padding the book with zeroes would
        // understate every concentration
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
            // only where there is something to measure: a deal with no cost
            // packages has no works to compare money against, and inventing a
            // 0%-complete reading would report every such deal as underspending
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
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return aggregateExposure(positions);
  }),

  create: internalProcedure
    .input(
      z.object({
        name: z.string().min(1),
        address: z.string().min(1),
        assetType: zAssetType,
        stage: zDealStage.default('SOURCING'),
        probability: z.number().int().min(0).max(100).default(50),
        gdv: z.number().min(0).default(0), // £
        forecastProfit: z.number().min(0).default(0),
        equityRequired: z.number().min(0).default(0),
        nextMilestone: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
      await assertCanAddDeal(ctx.prisma, ctx.principal.orgId, org?.plan ?? 'TRIAL');
      return ctx.prisma.deal.create({
        data: {
          orgId: ctx.principal.orgId,
          name: input.name,
          address: input.address,
          assetType: input.assetType,
          stage: input.stage,
          figureStatus: figureStatusForStage[input.stage],
          probability: input.probability,
          gdv: toPence(input.gdv),
          forecastProfit: toPence(input.forecastProfit),
          equityRequired: toPence(input.equityRequired),
          roc: input.gdv > 0 && input.forecastProfit > 0 ? input.forecastProfit / Math.max(input.gdv - input.forecastProfit, 1) : 0,
          nextMilestone: input.nextMilestone,
          ownerId: ctx.principal.userId,
        },
      });
    }),

  setStage: internalProcedure
    .input(z.object({ id: z.string(), stage: zDealStage }))
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.id, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      // stage transitions harden the figure status: estimate → committed → actual
      const updated = await ctx.prisma.deal.update({
        where: { id: deal.id },
        data: { stage: input.stage, figureStatus: figureStatusForStage[input.stage] },
      });
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: deal.id,
          actor: ctx.principal.name,
          action: 'moved deal to',
          target: `${input.stage.replace('_', ' / ').toLowerCase()} (figures ${figureStatusForStage[input.stage].toLowerCase()})`,
        },
      });
      return updated;
    }),

  update: internalProcedure
    .input(
      z.object({
        id: z.string(),
        patch: z.object({
          name: z.string().optional(),
          address: z.string().optional(),
          postcode: z.string().max(9).optional(),
          probability: z.number().int().min(0).max(100).optional(),
          nextMilestone: z.string().optional(),
          viability: z.enum(['PROCEED', 'CAUTION', 'DECLINE']).optional(),
          gdv: z.number().min(0).optional(),
          forecastProfit: z.number().optional(),
          equityRequired: z.number().min(0).optional(),
          roc: z.number().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.id, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const { gdv, forecastProfit, equityRequired, ...rest } = input.patch;
      return ctx.prisma.deal.update({
        where: { id: deal.id },
        data: {
          ...rest,
          ...(gdv != null ? { gdv: toPence(gdv) } : {}),
          ...(forecastProfit != null ? { forecastProfit: toPence(forecastProfit) } : {}),
          ...(equityRequired != null ? { equityRequired: toPence(equityRequired) } : {}),
        },
      });
    }),
});
