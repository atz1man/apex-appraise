import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { currentAppraisals, currentByDeal } from '../current-appraisal.js';
import { portfolioRollup } from '@apex/appraisal-engine';
import { figureStatusForStage, zAssetType, zDealStage } from '@apex/types';
import { P, moneyLabel, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';
import { assertCanAddDeal } from '../entitlements.js';
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
import { appraisalRowToEngineInput } from '../mappers.js';
import { emitWebhook } from '../webhook-delivery.js';

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
    const [deals, appraisals, packages, policy, bankAccounts] = await Promise.all([
      ctx.prisma.deal.findMany({ where: { orgId }, select: { id: true, name: true, assetType: true, postcode: true, stage: true } }),
      currentAppraisals(ctx.prisma.appraisal, orgId),
      ctx.prisma.costPackage.findMany({
        where: { orgId },
        // spent and forecast are read so the packages can be handed to the
        // engine whole rather than re-derived here — see costBy below
        select: { dealId: true, committed: true, budget: true, spent: true, forecast: true, progressPct: true, retentionPct: true },
      }),
      ctx.prisma.orgPolicy.findUnique({ where: { orgId } }),
      // the bank feed, where one exists — cash beats a proxy built from invoices
      ctx.prisma.bankAccount.findMany({
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
    const limits = {
      ltgdvMaxPct: policy?.covLtgdvMaxPct ?? null,
      ltcMaxPct: policy?.covLtcMaxPct ?? null,
      minProfitOnCostPct: policy?.covMinProfitOnCostPct ?? null,
    };
    /**
     * The packages, grouped by deal and rolled up BY THE ENGINE.
     *
     * This used to do its own weighting — each package's budget times its
     * progress, accumulated here and divided at the point of use — with
     * `cost-report.ts` doing the same thing under `weightedProgressPct`, and
     * `public-api.ts` doing it a third time. Three implementations of one rule, and
     * the argument FOR the rule written out twice as well: the comment here and
     * the comment there both explained that a 2%-complete groundworks package
     * and a 2%-complete £5m frame package are not equally informative.
     *
     * They print on different surfaces — the engine's copy drives the cost
     * monitor's build-programme bar, this one drove the funding pack's
     * overspending verdict — so a change to the weighting basis would have
     * moved one and not the other, and the pack would have contradicted the
     * screen it says it agrees with. `one-engine-sweep` now asks this of the
     * whole tree rather than leaving it to be found again.
     */
    const byPackages = new Map<string, CostPackageLike[]>();
    for (const p of packages) {
      const list = byPackages.get(p.dealId) ?? [];
      list.push({
        budget: P(p.budget),
        committed: P(p.committed),
        spent: P(p.spent),
        forecast: P(p.forecast),
        progressPct: p.progressPct,
        retentionPct: p.retentionPct,
      });
      byPackages.set(p.dealId, list);
    }
    const costBy = new Map<string, ReturnType<typeof costRollup>>();
    for (const [dealId, list] of byPackages) {
      costBy.set(dealId, costRollup(list, { appraisedBuild: null }));
    }
    /**
     * Newest-first from `currentAppraisals`, first-wins here — so a portfolio
     * row and that deal's own report resolve to the same version. This was
     * `new Map(appraisals.map(...))`, which keeps whichever row arrived LAST.
     */
    const byDeal = currentByDeal(appraisals);

    const positions = deals
      .map((d) => {
        const a = byDeal.get(d.id);
        // a deal with no appraisal has no facility to be exposed to — it is a
        // prospect, not a position, and padding the book with zeroes would
        // understate every concentration
        if (!a) return null;
        const r = computeAppraisal(appraisalRowToEngineInput(a));
        const cost = costBy.get(d.id);
        const cash = reconcileCash({
          committed: cost?.committed ?? 0,
          transactions: cashBy.get(d.id) as never,
        });
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
          /**
           * Drawn comes from the bank when the deal has a mapped account, and
           * from committed spend when it does not. `drawnSource` travels with it
           * so the funding pack can say which — a figure taken from a statement
           * and one inferred from invoices do not deserve equal confidence.
           */
          drawn: cash.drawn,
          drawnSource: cash.drawnSource,
          paid: cash.paid,
          invoicedUnpaid: cash.invoicedUnpaid,
          paidUnbilled: cash.paidUnbilled,
          unclassifiedIn: cash.unclassifiedIn,
          drawdown:
            // only where there is something to measure: a deal with no cost
            // packages has no works to compare money against, and inventing a
            // 0%-complete reading would report every such deal as underspending
            // the engine returns null for the weighting when there is nothing
            // costed to weight by; that null IS the "nothing to compare" case
            cost && cost.weightedProgressPct != null
              ? spendAgainstProgramme({
                  constructionTotal: r.build + r.fees + r.cont,
                  periodMonths: r.period,
                  profile: (a.spendProfile ?? 'SCURVE').toLowerCase() as never,
                  monthsElapsed:
                    a.startYear && a.startMonth ? monthsBetween({ year: a.startYear, month: a.startMonth }, new Date()) : 0,
                  // works are certified against what has actually been PAID once
                  // a bank feed exists; invoiced-not-paid is a payables position
                  actualToDate: cash.drawnSource === 'bank' ? cash.paid : cost.committed,
                  progressPct: cost.weightedProgressPct,
                })
              : null,
          covenants: testCovenants(
            { facility: r.facility, totalCost: r.totalCost, gdv: r.gdv, profit: r.profit },
            limits,
          ),
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
      const created = await ctx.prisma.deal.create({
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
      // its siblings both record — `setStage` writes "moved deal to", `update`
      // writes what changed — so a deal's activity feed began at its first EDIT
      // and never said who opened it or on what figures
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: created.id,
          userId: ctx.principal.userId,
          actor: ctx.principal.name,
          action: 'created the deal',
          target: `${created.name} · ${created.address} · GDV ${moneyLabel(created.gdv)}`,
        },
      });
      await emitWebhook(ctx.prisma, ctx.principal.orgId, 'deal.created', {
        dealId: created.id,
        name: created.name,
        address: created.address,
        assetType: created.assetType,
        stage: created.stage,
        createdBy: ctx.principal.name,
        createdAt: created.createdAt,
      });
      // through the mapper, like every read of this row — see sales.ts for why
      return dealOut(created);
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
      return dealOut(updated);
    }),

  /**
   * The details a person owns, and only those.
   *
   * This used to accept gdv, forecastProfit, equityRequired, roc and viability
   * as well — every headline figure on the deal card. Those are ENGINE-OWNED:
   * appraisal.save writes them from computeAppraisal output, under a comment
   * that says so, and viability is derived from profit on cost by threshold.
   * A caller could set a GDV by hand that no engine had produced, and it would
   * stand on the pipeline, in portfolio exposure and in the funding pack until
   * the next appraisal save silently overwrote it.
   *
   * That is the one rule this product does not bend: one shared calculation
   * engine for every surface. It survived only because nothing in the app called
   * this procedure, so nobody had walked through the door. Removing them breaks
   * no caller for exactly the same reason.
   *
   * deals.create still takes an early GDV estimate, and that is different: there
   * is no appraisal yet, and the first save takes ownership of the figure.
   */
  update: internalProcedure
    .input(
      z.object({
        id: z.string(),
        patch: z.object({
          name: z.string().min(1).max(120).optional(),
          address: z.string().min(1).max(200).optional(),
          postcode: z.string().max(9).optional(),
          probability: z.number().int().min(0).max(100).optional(),
          nextMilestone: z.string().max(120).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.id, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await ctx.prisma.deal.update({ where: { id: deal.id }, data: input.patch });

      /**
       * Recorded, because the address on a valuation workfile is not cosmetic:
       * comparables, the site pack and the Red Book report all read it, and a
       * valuer asked months later why a scheme moved street needs an answer.
       * Only what actually changed.
       */
      const changed = (Object.keys(input.patch) as Array<keyof typeof input.patch>).filter(
        (k) => input.patch[k] !== undefined && input.patch[k] !== (deal as Record<string, unknown>)[k],
      );
      if (changed.length) {
        await ctx.prisma.activityEvent.create({
          data: {
            orgId: ctx.principal.orgId,
            dealId: deal.id,
            actor: ctx.principal.name,
            action: 'edited deal details',
            target: changed.join(', '),
          },
        });
      }
      return dealOut(updated);
    }),
});
