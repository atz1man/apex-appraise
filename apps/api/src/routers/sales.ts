import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { lettingsRollup, salesRollup } from '@apex/appraisal-engine';
import { LETTING_MILESTONES, SALES_MILESTONES } from '@apex/types';
import { depositsHeldAt } from '@apex/appraisal-engine';
import { P, moneyLabel, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';
import { assertUnchanged } from '../optimistic.js';

const salesStatusForProg = (prog: number) =>
  prog >= 7 ? 'HANDOVER' : prog >= 6 ? 'COMPLETED' : prog >= 5 ? 'EXCHANGED' : prog >= 1 ? 'RESERVED' : 'AVAILABLE';
const tenancyStatusForProg = (prog: number) =>
  prog >= 5 ? 'OCCUPIED' : prog >= 4 ? 'SIGNED' : prog >= 3 ? 'REFERENCING' : prog >= 2 ? 'APPLICATION' : 'AVAILABLE';

const unitOut = (u: any) => ({
  id: u.id,
  name: u.name,
  spec: u.spec,
  level: u.level,
  appraisedValue: P(u.appraisedValue),
  agreedValue: u.agreedValue != null ? P(u.agreedValue) : null,
  status: u.status,
  buyerName: u.buyerName,
  buyerSolicitor: u.buyerSolicitor,
  leadSource: u.leadSource,
  incentive: u.incentive,
  depositHeld: u.depositHeld != null ? P(u.depositHeld) : null,
  reservedAt: u.reservedAt,
  progress: u.progress,
  stalled: u.stalled,
  /** the stamp an in-place save has to hand back — see sales.upsertUnit */
  updatedAt: u.updatedAt,
});

const tenancyOut = (t: any) => ({
  id: t.id,
  name: t.name,
  spec: t.spec,
  level: t.level,
  ervPcm: P(t.ervPcm),
  agreedRentPcm: t.agreedRentPcm != null ? P(t.agreedRentPcm) : null,
  tenantName: t.tenantName,
  leadSource: t.leadSource,
  incentive: t.incentive,
  status: t.status,
  progress: t.progress,
  appliedAt: t.appliedAt,
  stalled: t.stalled,
  arrears: P(t.arrears),
  /** the stamp an in-place save has to hand back — see sales.upsertTenancy */
  updatedAt: t.updatedAt,
});

/**
 * What changed, in the words the drawer uses.
 *
 * "Provenance on every figure" is one of this product's non-negotiables, and
 * this router recorded nothing at all: six mutations, and an agreed sale value
 * could move by £50,000, or a plot be deleted outright, with no actor, no time
 * and no trace. The optimistic lock added earlier stops the ACCIDENTAL revert;
 * nothing recorded the deliberate one.
 *
 * Named fields rather than a blanket "edited", the same way `deals.update`
 * does it — a timeline that says only that something changed is a timeline
 * nobody reads twice.
 */
const changedFields = (before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) =>
  Object.entries(labels)
    .filter(([k]) => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map(([, label]) => label);

const UNIT_LABELS: Record<string, string> = {
  name: 'name',
  spec: 'spec',
  agreedValue: 'agreed value',
  appraisedValue: 'appraised value',
  buyerName: 'buyer',
  buyerSolicitor: 'solicitor',
  incentive: 'incentive',
  leadSource: 'lead source',
  progress: 'milestone',
  stalled: 'stalled flag',
};

const TENANCY_LABELS: Record<string, string> = {
  name: 'name',
  spec: 'spec',
  agreedRentPcm: 'agreed rent',
  ervPcm: 'ERV',
  tenantName: 'tenant',
  incentive: 'incentive',
  leadSource: 'lead source',
  progress: 'milestone',
  stalled: 'stalled flag',
  // money a tenant owes: moving it is exactly the kind of change a timeline is for
  arrears: 'arrears',
};

/** pence → the way a timeline reads it, en-GB, or an em dash for nothing agreed */
const record = (ctx: any, dealId: string, action: string, target: string) =>
  ctx.prisma.activityEvent.create({
    data: { orgId: ctx.principal.orgId, dealId, actor: ctx.principal.name, action, target },
  });

export const salesRouter = router({
  units: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const deal = await ctx.prisma.deal.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
    const units = await ctx.prisma.unit.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      orderBy: { name: 'asc' },
      include: { milestones: { orderBy: { index: 'asc' } } },
    });
    const rollup = salesRollup(
      units.map((u) => ({
        appraisedValue: P(u.appraisedValue),
        agreedValue: u.agreedValue != null ? P(u.agreedValue) : null,
        status: u.status as any,
        depositHeld: u.depositHeld != null ? P(u.depositHeld) : null,
      })),
    );
    return {
      units: units.map((u) => ({ ...unitOut(u), milestones: u.milestones.map((m) => ({ name: m.name, index: m.index, done: m.done, date: m.date })) })),
      rollup,
      milestones: SALES_MILESTONES,
    };
  }),

  tenancies: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const deal = await ctx.prisma.deal.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
    const tenancies = await ctx.prisma.tenancy.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      orderBy: { name: 'asc' },
    });
    const rollup = lettingsRollup(
      tenancies.map((t) => ({
        ervPcm: P(t.ervPcm),
        agreedRentPcm: t.agreedRentPcm != null ? P(t.agreedRentPcm) : null,
        status: t.status as any,
        arrears: P(t.arrears),
      })),
    );
    return { tenancies: tenancies.map(tenancyOut), rollup, milestones: LETTING_MILESTONES };
  }),

  upsertUnit: internalProcedure
    .input(
      z.object({
        id: z.string().optional(),
        dealId: z.string(),
        name: z.string().min(1),
        spec: z.string().default(''),
        level: z.number().int().default(0),
        appraisedValue: z.number().min(0), // £
        agreedValue: z.number().min(0).nullable().default(null),
        buyerName: z.string().nullable().default(null),
        buyerSolicitor: z.string().nullable().default(null),
        leadSource: z.string().nullable().default(null),
        incentive: z.string().nullable().default(null),
        progress: z.number().int().min(0).max(7).default(0),
        stalled: z.boolean().default(false),
        /**
         * The stamp of the plot the caller loaded.
         *
         * Required when editing an existing one. This writes EVERY field from a
         * single form — agreed value, buyer, solicitor, incentive, progress — so
         * two agents on one plot means whichever saves second reverts the other,
         * on a figure that reaches a contract.
         */
        expectedUpdatedAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const { id, dealId, appraisedValue, agreedValue, expectedUpdatedAt, ...rest } = input;
      const data = {
        ...rest,
        appraisedValue: toPence(appraisedValue),
        agreedValue: agreedValue != null && agreedValue > 0 ? toPence(agreedValue) : null,
        status: salesStatusForProg(input.progress),
        reservedAt: input.progress > 0 ? new Date() : null,
      };
      if (id) {
        const existing = await ctx.prisma.unit.findFirst({ where: { id, orgId: ctx.principal.orgId } });
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
        await assertUnchanged({
          what: `plot “${existing.name}”`,
          current: existing.updatedAt,
          expected: expectedUpdatedAt,
          advice: 'Reload to see the current details before saving yours — the agreed value may have moved.',
        });
        const updated = await ctx.prisma.unit.update({ where: { id }, data: { ...data, reservedAt: existing.reservedAt ?? data.reservedAt } });
        const changed = changedFields(existing as never, updated as never, UNIT_LABELS);
        if (changed.length) {
          await record(ctx, dealId, `updated plot — ${changed.join(', ')}`, `${updated.name} · agreed ${moneyLabel(updated.agreedValue)}`);
        }
        return updated;
      }
      const created = await ctx.prisma.unit.create({
        data: {
          ...data,
          /**
           * Set once, here, from the shared schedule. NOT on update: the drawer
           * has no deposit field, and a form that does not show a figure must
           * not rewrite it. Measured before this — a plot carrying a recorded
           * £24,400 dropped to £5,000 because somebody corrected the buyer's
           * solicitor.
           */
          depositHeld:
            input.progress > 0
              ? toPence(depositsHeldAt(input.progress, { agreedValue, appraisedValue }))
              : null,
          orgId: ctx.principal.orgId,
          dealId,
          milestones: { create: SALES_MILESTONES.map((m, idx) => ({ name: m, index: idx, done: idx < input.progress })) },
        },
      });
      await record(ctx, dealId, 'added plot', `${created.name} · appraised ${moneyLabel(created.appraisedValue)}`);
      return created;
    }),

  /**
   * Deleting a plot, and everything that was pointing at it.
   *
   * `Payment.unitId` carries no relation, so this used to leave a buyer's
   * SETTLED receipts behind — records of money that actually arrived, reachable
   * from nothing — and `User.buyerUnitId` still pointing at a plot that no
   * longer existed, so that person's portal answered NOT_FOUND on every page
   * with nobody told. The same shape as removing a colleague and silently
   * killing the valuation links they had sent.
   */
  deleteUnit: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const unit = await ctx.prisma.unit.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });

    /**
     * Money that arrived is not deletable.
     *
     * A settled payment is a receipt. Removing the plot would remove the only
     * thing it is attached to, and a plot somebody has paid for is a sale to be
     * recorded, not a row to be tidied away.
     */
    const settled = await ctx.prisma.payment.findMany({ where: { unitId: input, orgId: ctx.principal.orgId, status: 'PAID' } });
    if (settled.length) {
      const total = settled.reduce((a, p) => a + P(p.amount), 0);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `“${unit.name}” cannot be deleted — £${Math.round(total).toLocaleString('en-GB')} has been received against it across ${settled.length} payment${settled.length === 1 ? '' : 's'}. Deleting the plot would destroy the receipt.`,
      });
    }

    // nothing was received, so the unsettled schedule goes with the plot rather
    // than outliving it
    const { count: pendingPayments } = await ctx.prisma.payment.deleteMany({ where: { unitId: input, orgId: ctx.principal.orgId } });
    const { count: portalLogins } = await ctx.prisma.user.deleteMany({
      where: { buyerUnitId: input, orgId: ctx.principal.orgId, principalType: 'buyer' },
    });
    await ctx.prisma.salesMilestone.deleteMany({ where: { unitId: input } });
    await ctx.prisma.unit.delete({ where: { id: input } });
    await record(
      ctx,
      unit.dealId,
      'deleted plot',
      `${unit.name}${portalLogins ? ` · ${portalLogins} portal login${portalLogins === 1 ? '' : 's'} removed` : ''}`,
    );
    /** the caller says so before the buyer finds out by trying to log in */
    return { ok: true, portalLogins, pendingPayments };
  }),

  advanceMilestone: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const unit = await ctx.prisma.unit.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
    const progress = Math.min(SALES_MILESTONES.length - 1, unit.progress + 1);
    await ctx.prisma.salesMilestone.updateMany({ where: { unitId: unit.id, index: { lt: progress } }, data: { done: true } });
    await ctx.prisma.salesMilestone.updateMany({ where: { unitId: unit.id, index: unit.progress }, data: { date: new Date() } });
    const advanced = await ctx.prisma.unit.update({
      where: { id: unit.id },
      data: {
        progress,
        status: salesStatusForProg(progress),
        stalled: false,
        agreedValue: unit.agreedValue ?? unit.appraisedValue,
        reservedAt: unit.reservedAt ?? new Date(),
        buyerName: unit.buyerName ?? 'New record',
        leadSource: unit.leadSource ?? 'Direct',
        incentive: unit.incentive ?? 'None',
        /**
         * Advancing a milestone IS the event that takes a deposit, so this is
         * the one write that may set it — from the shared schedule, which
         * counts the reservation fee the buyer paid months ago as well as the
         * ten per cent. The old formula counted only the ten per cent, so the
         * firm's client-money figure disagreed with the buyer's own receipts.
         */
        depositHeld: toPence(
          depositsHeldAt(progress, { agreedValue: P(unit.agreedValue ?? unit.appraisedValue), appraisedValue: P(unit.appraisedValue) }),
        ),
      },
    });
    await record(
      ctx,
      unit.dealId,
      `advanced milestone to ${SALES_MILESTONES[progress] ?? progress}`,
      `${advanced.name} · deposit held ${moneyLabel(advanced.depositHeld)}`,
    );
    return advanced;
  }),

  upsertTenancy: internalProcedure
    .input(
      z.object({
        id: z.string().optional(),
        dealId: z.string(),
        name: z.string().min(1),
        spec: z.string().default(''),
        level: z.number().int().default(0),
        ervPcm: z.number().min(0),
        agreedRentPcm: z.number().min(0).nullable().default(null),
        tenantName: z.string().nullable().default(null),
        leadSource: z.string().nullable().default(null),
        incentive: z.string().nullable().default(null),
        progress: z.number().int().min(0).max(5).default(0),
        stalled: z.boolean().default(false),
        /**
         * Rent owed, and the only field here that is OPTIONAL rather than
         * defaulted.
         *
         * `Tenancy.arrears` existed with nothing able to write it. It is read in
         * three places — the lettings KPI row, a stat card and the drawer, all
         * coloured green at zero, which is an assertion that nothing is owed —
         * and it could only ever BE zero outside the demo seed. So a letting
         * agent could not record that a tenant was behind, and the screen said
         * so in green.
         *
         * Worse, `deleteTenancy` refuses a tenancy carrying arrears with
         * "Clear or write off the arrears first" — an instruction the product
         * did not offer. On the demo workspace, Apt 4 carries £1,425 and is
         * undeletable for ever.
         *
         * Optional, not `.default(0)` like its neighbours. A default here would
         * mean "any caller who does not mention this debt has written it off",
         * and that is not a thing a money column may say — a script, a future
         * screen or a partial edit would clear it by omission. A missing key
         * leaves the column alone.
         *
         * Note what this does NOT protect, because it was nearly assumed: the
         * lettings drawer sends `arrears` on every save, so the guard that keeps
         * an ordinary edit from wiping the debt is the DRAWER loading the
         * current figure, not this. Driving a mutation through
         * `e2e/lettings-arrears.spec.ts` found it — loading 0 into the edit form
         * passed every other assertion, and changing a tenant's name silently
         * cleared what they owed. Both halves are now driven, one at each end.
         */
        arrears: z.number().min(0).optional(),
        /** the stamp of the tenancy the caller loaded — see upsertUnit above */
        expectedUpdatedAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const { id, dealId, ervPcm, agreedRentPcm, arrears, expectedUpdatedAt, ...rest } = input;
      const data = {
        ...rest,
        ervPcm: toPence(ervPcm),
        agreedRentPcm: agreedRentPcm != null && agreedRentPcm > 0 ? toPence(agreedRentPcm) : null,
        // only when supplied — a missing key leaves the column alone, and the
        // column is money a tenant owes
        ...(arrears !== undefined ? { arrears: toPence(arrears) } : {}),
        status: tenancyStatusForProg(input.progress),
        appliedAt: input.progress > 0 ? new Date() : null,
      };
      if (id) {
        const existing = await ctx.prisma.tenancy.findFirst({ where: { id, orgId: ctx.principal.orgId } });
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
        await assertUnchanged({
          what: `tenancy “${existing.name}”`,
          current: existing.updatedAt,
          expected: expectedUpdatedAt,
          advice: 'Reload to see the current details before saving yours — the agreed rent may have moved.',
        });
        const updated = await ctx.prisma.tenancy.update({ where: { id }, data });
        const changed = changedFields(existing as never, updated as never, TENANCY_LABELS);
        if (changed.length) {
          await record(ctx, dealId, `updated tenancy — ${changed.join(', ')}`, `${updated.name} · agreed rent ${moneyLabel(updated.agreedRentPcm)} pcm`);
        }
        return updated;
      }
      const created = await ctx.prisma.tenancy.create({ data: { ...data, orgId: ctx.principal.orgId, dealId } });
      await record(ctx, dealId, 'added tenancy', `${created.name} · ERV ${moneyLabel(created.ervPcm)} pcm`);
      return created;
    }),

  deleteTenancy: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const t = await ctx.prisma.tenancy.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
    /** arrears are money owed against this tenancy; deleting it writes off the record of it */
    if (P(t.arrears) > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `“${t.name}” cannot be deleted — ${moneyLabel(t.arrears)} of arrears is recorded against it. Clear or write off the arrears first.`,
      });
    }
    await ctx.prisma.tenancy.delete({ where: { id: input } });
    await record(ctx, t.dealId, 'deleted tenancy', t.name);
    return { ok: true };
  }),

  advanceTenancy: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const t = await ctx.prisma.tenancy.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
    const progress = Math.min(LETTING_MILESTONES.length - 1, t.progress + 1);
    const advanced = await ctx.prisma.tenancy.update({
      where: { id: t.id },
      data: {
        progress,
        status: tenancyStatusForProg(progress),
        stalled: false,
        agreedRentPcm: t.agreedRentPcm ?? t.ervPcm,
        tenantName: t.tenantName ?? 'New applicant',
        appliedAt: t.appliedAt ?? new Date(),
      },
    });
    await record(
      ctx,
      t.dealId,
      `advanced tenancy to ${LETTING_MILESTONES[progress] ?? progress}`,
      `${advanced.name} · agreed rent ${moneyLabel(advanced.agreedRentPcm)} pcm`,
    );
    return advanced;
  }),
});
