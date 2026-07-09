import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { portfolioRollup } from '@apex/appraisal-engine';
import { figureStatusForStage, zAssetType, zDealStage } from '@apex/types';
import { P, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';

const dealOut = (d: {
  id: string; name: string; address: string; assetType: string; stage: string;
  figureStatus: string; probability: number; gdv: bigint; forecastProfit: bigint;
  roc: number; equityRequired: bigint; viability: string; nextMilestone: string | null;
  owner?: { initials: string; name: string } | null;
}) => ({
  id: d.id,
  name: d.name,
  address: d.address,
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
    .mutation(({ ctx, input }) =>
      ctx.prisma.deal.create({
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
      }),
    ),

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
