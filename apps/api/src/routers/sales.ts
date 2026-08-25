import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { lettingsRollup, salesRollup } from '@apex/appraisal-engine';
import { LETTING_MILESTONES, SALES_MILESTONES } from '@apex/types';
import { depositsHeldAt } from '@apex/appraisal-engine';
import { P, toPence } from '../mappers.js';
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
        return ctx.prisma.unit.update({ where: { id }, data: { ...data, reservedAt: existing.reservedAt ?? data.reservedAt } });
      }
      return ctx.prisma.unit.create({
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
    }),

  deleteUnit: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const unit = await ctx.prisma.unit.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
    await ctx.prisma.salesMilestone.deleteMany({ where: { unitId: input } });
    await ctx.prisma.unit.delete({ where: { id: input } });
    return { ok: true };
  }),

  advanceMilestone: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const unit = await ctx.prisma.unit.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
    const progress = Math.min(SALES_MILESTONES.length - 1, unit.progress + 1);
    await ctx.prisma.salesMilestone.updateMany({ where: { unitId: unit.id, index: { lt: progress } }, data: { done: true } });
    await ctx.prisma.salesMilestone.updateMany({ where: { unitId: unit.id, index: unit.progress }, data: { date: new Date() } });
    return ctx.prisma.unit.update({
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
        /** the stamp of the tenancy the caller loaded — see upsertUnit above */
        expectedUpdatedAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const { id, dealId, ervPcm, agreedRentPcm, expectedUpdatedAt, ...rest } = input;
      const data = {
        ...rest,
        ervPcm: toPence(ervPcm),
        agreedRentPcm: agreedRentPcm != null && agreedRentPcm > 0 ? toPence(agreedRentPcm) : null,
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
        return ctx.prisma.tenancy.update({ where: { id }, data });
      }
      return ctx.prisma.tenancy.create({ data: { ...data, orgId: ctx.principal.orgId, dealId } });
    }),

  deleteTenancy: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const t = await ctx.prisma.tenancy.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
    await ctx.prisma.tenancy.delete({ where: { id: input } });
    return { ok: true };
  }),

  advanceTenancy: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const t = await ctx.prisma.tenancy.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
    const progress = Math.min(LETTING_MILESTONES.length - 1, t.progress + 1);
    return ctx.prisma.tenancy.update({
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
  }),
});
