import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { J, P, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';
import { assertOwned } from '../auth/owned.js';
import { assertUnchanged } from '../optimistic.js';

const zRoom = z.object({
  name: z.string(),
  condition: z.number().min(0).max(5), // 0 = not yet rated
  photos: z.number().int().min(0).default(0),
  notes: z.string().default(''),
});

const zWeights = z.object({
  salesComparison: z.number().min(0).max(100),
  cost: z.number().min(0).max(100),
  income: z.number().min(0).max(100),
});

const inspectionOut = (i: any) => ({
  id: i.id,
  dealId: i.dealId,
  surveyorId: i.surveyorId,
  inspectedAt: i.inspectedAt,
  rooms: J<Array<z.infer<typeof zRoom>>>(i.rooms, []),
  reconciledValue: i.reconciledValue != null ? P(i.reconciledValue) : null,
  approachWeights: J<z.infer<typeof zWeights>>(i.approachWeights, { salesComparison: 60, cost: 20, income: 20 }),
  status: i.status,
  /** the stamp a save has to hand back — see save.expectedUpdatedAt */
  updatedAt: i.updatedAt,
});

export const inspectionsRouter = router({
  /** Latest inspection for a deal (the field app ⇄ workbench handoff). */
  get: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const deal = await ctx.prisma.deal.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
    const row = await ctx.prisma.inspection.findFirst({
      where: { dealId: input, orgId: ctx.principal.orgId },
      orderBy: { inspectedAt: 'desc' },
    });
    return row ? inspectionOut(row) : null;
  }),

  /**
   * Latest inspection per deal across the org — one round-trip for the field
   * app's dashboard chips (the per-deal get() batch overflowed the URL limit).
   */
  statuses: internalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.inspection.findMany({
      where: { orgId: ctx.principal.orgId },
      orderBy: { inspectedAt: 'desc' },
      select: { dealId: true, status: true, rooms: true },
    });
    const out: Record<string, { status: string; progressPct: number }> = {};
    for (const r of rows) {
      if (r.dealId in out) continue;
      const rooms = J<Array<{ condition: number }>>(r.rooms, []);
      const progressPct = rooms.length ? Math.round((rooms.filter((x) => x.condition > 0).length / rooms.length) * 100) : 0;
      out[r.dealId] = { status: r.status, progressPct };
    }
    return out;
  }),

  /** Persist a field inspection — replaces the prototype's apex_field_handoff_v1. */
  save: internalProcedure
    .input(
      z.object({
        id: z.string().optional(),
        dealId: z.string(),
        rooms: z.array(zRoom),
        reconciledValue: z.number().min(0).nullable(),
        approachWeights: zWeights,
        status: z.enum(['draft', 'submitted']).default('submitted'),
        /**
         * The stamp of the inspection the caller loaded.
         *
         * Required when editing an existing one. The field app and the workbench
         * edit the same row on purpose — the get procedure above calls it "the
         * field app ⇄ workbench handoff" — and this write carries EVERY field,
         * so without a check the second save wipes the first with no version and
         * nothing to say it happened.
         *
         * Offline turns that from unlucky into systematic. A write made with no
         * signal is HELD by react-query and replayed on reconnect, so a phone's
         * older copy lands after a desk edit that happened later, by
         * construction. The bar telling a surveyor their work is held is what
         * makes them rely on it.
         */
        expectedUpdatedAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = {
        rooms: JSON.stringify(input.rooms),
        reconciledValue: input.reconciledValue != null ? toPence(input.reconciledValue) : null,
        approachWeights: JSON.stringify(input.approachWeights),
        status: input.status,
        surveyorId: ctx.principal.userId,
        inspectedAt: new Date(),
      };
      if (!input.id) {
        const created = await ctx.prisma.inspection.create({
          data: { ...data, orgId: ctx.principal.orgId, dealId: input.dealId },
        });
        return inspectionOut(created);
      }

      const existing = await assertOwned(ctx.prisma.inspection, input.id, ctx.principal.orgId);
      /**
       * Demanded rather than checked-when-present: an optional stamp silently
       * reopens the hole for whichever caller forgets next, and the person it
       * costs is a surveyor whose site notes vanish without a trace.
       */
      await assertUnchanged({
        what: 'inspection',
        current: existing.updatedAt,
        expected: input.expectedUpdatedAt,
        lastActor: async () =>
          existing.surveyorId
            ? (await ctx.prisma.user.findUnique({ where: { id: existing.surveyorId }, select: { name: true } }))?.name
            : null,
        advice: 'Reload to see the current notes before saving yours — nothing you can see here has been lost.',
      });

      const row = await ctx.prisma.inspection.update({ where: { id: existing.id }, data });
      return inspectionOut(row);
    }),
});
