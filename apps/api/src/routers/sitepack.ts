import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { bulkGeocode, fetchConstraints, fetchEpc, fetchSoldPrices, geocodePostcode, matchPsf } from '../opendata.js';
import { internalProcedure, router } from '../trpc.js';

/**
 * Site pack — one postcode in, the public record out: real sold prices (Land
 * Registry), planning constraints + flood zones (planning.data.gov.uk), EPC floor
 * areas when configured. Each source succeeds or fails independently with its own
 * status; nothing here is mocked or fabricated.
 */
export const sitePackRouter = router({
  get: internalProcedure
    .input(z.object({ dealId: z.string(), postcode: z.string().min(5).max(9).optional() }))
    .query(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const postcode = (input.postcode ?? deal.postcode ?? '').trim();
      if (!postcode) return { status: 'no-postcode' as const, dealName: deal.name, address: deal.address };

      // persist a newly supplied postcode on the deal
      if (input.postcode && input.postcode !== deal.postcode) {
        await ctx.prisma.deal.update({ where: { id: deal.id }, data: { postcode: input.postcode } });
      }

      let geo;
      try {
        geo = await geocodePostcode(postcode);
      } catch {
        return { status: 'bad-postcode' as const, dealName: deal.name, address: deal.address, postcode };
      }

      const [soldRes, constraintsRes, epcRes] = await Promise.allSettled([
        fetchSoldPrices(geo.postcode),
        fetchConstraints(geo.latitude, geo.longitude),
        fetchEpc(geo.postcode),
      ]);

      const epc = epcRes.status === 'fulfilled' ? epcRes.value : { status: 'error' as const, records: [], note: 'EPC fetch failed' };
      const sold = soldRes.status === 'fulfilled' ? soldRes.value : null;
      const coords = sold ? await bulkGeocode(sold.map((s) => s.postcode)) : new Map<string, { lat: number; lng: number }>();

      return {
        status: 'ok' as const,
        dealName: deal.name,
        address: deal.address,
        geo,
        soldPrices: sold
          ? {
              status: 'ok' as const,
              items: sold.map((s) => {
                const c = coords.get(s.postcode.toUpperCase());
                return { ...s, psf: matchPsf(s, epc.records), lat: c?.lat ?? null, lng: c?.lng ?? null };
              }),
            }
          : { status: 'error' as const, items: [] },
        constraints:
          constraintsRes.status === 'fulfilled'
            ? { status: 'ok' as const, ...constraintsRes.value }
            : { status: 'error' as const, checked: [], hits: [] },
        epc,
        fetchedAt: new Date().toISOString(),
      };
    }),

  /** Turn selected sold-price records into real comparables on the deal. */
  applyComps: internalProcedure
    .input(
      z.object({
        dealId: z.string(),
        comps: z
          .array(
            z.object({
              address: z.string(),
              date: z.string(),
              price: z.number(),
              propertyType: z.string(),
              psf: z.number().nullable(),
              lat: z.number().nullable().optional(),
              lng: z.number().nullable().optional(),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      let created = 0;
      for (const c of input.comps) {
        const dateLabel = c.date
          ? new Date(c.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
          : 'date n/a';
        await ctx.prisma.comparable.create({
          data: {
            orgId: ctx.principal.orgId,
            dealId: deal.id,
            address: c.address,
            meta: `Sold ${dateLabel} · £${Math.round(c.price).toLocaleString('en-GB')} · ${c.propertyType} · HM Land Registry PPD`,
            // £/ft² when an EPC floor-area match exists; otherwise parked at 0 for the analyst to set
            basePsf: c.psf ?? 0,
            lat: c.lat ?? null,
            lng: c.lng ?? null,
          },
        });
        created++;
      }
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: deal.id,
          actor: 'HM Land Registry',
          action: 'imported',
          target: `${created} sold-price comparable${created === 1 ? '' : 's'} (site pack)`,
        },
      });
      return { created };
    }),
});
