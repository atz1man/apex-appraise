import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { J, P, moneyLabel, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';
import { assertOwned } from '../auth/owned.js';
import { assertUnchanged } from '../optimistic.js';
import { recordAudit } from '../audit.js';

const zRoom = z.object({
  name: z.string(),
  condition: z.number().min(0).max(5), // 0 = not yet rated
  /**
   * The PHOTOGRAPHS, by id, not a count of them.
   *
   * This was `z.number().int().min(0)`, and the field app's shutter incremented
   * it: the viewfinder was a static gradient labelled "CAPTURING · KITCHEN", the
   * thumbnails were decorative gradients from the design tokens, and the
   * inspection went to the workbench reporting "12 photos" of a property nobody
   * had photographed. A surveyor's record of what they saw is the evidence a Red
   * Book valuation rests on, and `audit.ts` names a lender's credit committee and
   * an RICS review as its readers.
   *
   * The schema's own comment on `Inspection.rooms` has said `photos[]` since the
   * model was written, so the data model always meant the list; the app degraded
   * it to a tally.
   */
  photos: z.array(z.string()).max(60).default([]),
  notes: z.string().default(''),
});

/**
 * An inspection loaded from a row written before the photographs were real.
 *
 * Those rows carry `photos: 12` — a number. It becomes an empty list, and that is
 * not information lost: the count was of photographs that were never taken, so
 * there is nothing for an id to point at. Accepting both shapes on READ is what
 * stops an old inspection throwing inside `inspectionOut` the first time somebody
 * opens it.
 */
const roomsIn = (raw: unknown): Array<z.infer<typeof zRoom>> =>
  (Array.isArray(raw) ? raw : []).map((r: any) => ({
    name: String(r?.name ?? ''),
    condition: Number(r?.condition ?? 0),
    photos: Array.isArray(r?.photos) ? r.photos.filter((x: unknown): x is string => typeof x === 'string') : [],
    notes: String(r?.notes ?? ''),
  }));

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
  rooms: roomsIn(J<unknown[]>(i.rooms, [])),
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

      /**
       * Every photograph named is one this server HOLDS, on this deal.
       *
       * Without this the list is only a nicer-looking tally: a client could send
       * any ids it liked and the inspection would claim photographs that are not
       * there, which is the defect the list replaced wearing a different shape.
       * Filtered on `orgId` as well as `dealId`, because the two are independent
       * inputs (`auth/owned.ts`) and a photograph of another firm's site in a
       * valuation record is worse than a missing one.
       *
       * It REFUSES rather than dropping the unknown ids: a save that silently
       * files eight of the twelve photographs a surveyor took would be the
       * quietest possible way to lose evidence.
       */
      const named = [...new Set(input.rooms.flatMap((r) => r.photos))];
      if (named.length) {
        const held = await ctx.prisma.sitePhoto.findMany({
          where: { id: { in: named }, orgId: ctx.principal.orgId, dealId: input.dealId },
          select: { id: true },
        });
        const missing = named.filter((id) => !held.some((h) => h.id === id));
        if (missing.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              `${missing.length} photograph${missing.length === 1 ? '' : 's'} named by this inspection `
              + 'could not be found on this deal. Nothing has been saved — retry the uploads that failed.',
          });
        }
      }

      const data = {
        rooms: JSON.stringify(input.rooms),
        reconciledValue: input.reconciledValue != null ? toPence(input.reconciledValue) : null,
        approachWeights: JSON.stringify(input.approachWeights),
        status: input.status,
        surveyorId: ctx.principal.userId,
        inspectedAt: new Date(),
      };
      /**
       * The surveyor's own record of what they saw, and the value they
       * reconciled from it — the evidence a Red Book valuation rests on. The row
       * stamps `surveyorId` and `inspectedAt`, but that is only ever the LATEST
       * author: every earlier reconciled value was replaced with nothing to say
       * by whom or when. `audit.ts` names an insurer, a lender's credit
       * committee and an RICS review as the readers of this trail, and "who
       * changed the valuation" as one of the four questions it exists to answer.
       */
      const note = async (action: string) => {
        await recordAudit(ctx.prisma, {
          orgId: ctx.principal.orgId,
          dealId: input.dealId,
          userId: ctx.principal.userId,
          actor: ctx.principal.name,
          action,
          target:
            // the photograph count is now a count of photographs, so it is worth
            // recording: it is part of what the inspection claims to have seen
            (input.reconciledValue != null
              ? `${input.rooms.length} rooms, reconciled at ${moneyLabel(toPence(input.reconciledValue))}`
              : `${input.rooms.length} rooms, no reconciled value`)
            + `, ${named.length} photograph${named.length === 1 ? '' : 's'}`,
          ip: ctx.ip,
        });
      };

      if (!input.id) {
        const created = await ctx.prisma.inspection.create({
          data: { ...data, orgId: ctx.principal.orgId, dealId: input.dealId },
        });
        await note(input.status === 'submitted' ? 'submitted an inspection' : 'started an inspection');
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
      await note(
        existing.status !== 'submitted' && input.status === 'submitted'
          ? 'submitted an inspection'
          : 'updated an inspection',
      );
      return inspectionOut(row);
    }),
});
