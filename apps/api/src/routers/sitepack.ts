import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  bulkGeocode,
  fetchAmenities,
  fetchConstraints,
  fetchEpc,
  fetchFloodWarnings,
  fetchSoldPrices,
  matchPsf,
} from '../opendata.js';
import { companiesHouseConfigured, companyProfile, searchCompanies } from '../companieshouse.js';
import { TTL, cached, coordKey, locate } from '../opendata-cache.js';
import { getIntegrationCreds } from '../integration-creds.js';
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

      /**
       * `locate` distinguishes "that postcode does not exist" from "we could not
       * reach postcodes.io", which this used to collapse into `bad-postcode` —
       * so an outage at a free geocoder blanked every panel below and told the
       * valuer their own postcode was wrong. It is also cached now: this was the
       * one uncached blocking call standing in front of five cached ones.
       */
      const located = await locate(ctx.prisma, postcode);
      if (located.status !== 'located') {
        return { status: located.status, dealName: deal.name, address: deal.address, postcode };
      }
      const geo = located.geo;

      const epcCreds = await getIntegrationCreds(ctx.prisma, ctx.principal.orgId, 'EPC Register');
      const cc = coordKey(geo.latitude, geo.longitude);

      /**
       * Every source is cached and every source has a deadline, because those fix
       * two different halves of the same complaint.
       *
       * Caching fixes the SECOND visit: none of this changes while somebody is
       * looking at it (see opendata-cache.ts for the per-source reasoning).
       *
       * The deadline fixes the FIRST visit. These five ran in parallel, so the
       * response took as long as the slowest of them — measured at 11s for the
       * Environment Agency and 6s for Overpass to fail. A panel that has not
       * arrived in four seconds is reported as still fetching rather than kept
       * everybody else waiting for; the fetch it started carries on and lands in
       * the cache, so the refetch a moment later is instant and complete.
       *
       * A slow source therefore costs a second look, never a blank screen and
       * never a lie about what was checked.
       */
      const DEADLINE_MS = 4_000;
      const pending = Symbol('pending');
      const withDeadline = async <T>(p: Promise<T>): Promise<T | typeof pending> => {
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<typeof pending>((resolve) => {
          timer = setTimeout(() => resolve(pending), DEADLINE_MS);
        });
        try {
          return await Promise.race([p, deadline]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      const [soldRes, constraintsRes, epcRes, floodRes, amenityRes] = await Promise.all([
        withDeadline(cached(ctx.prisma, { key: `sold:${geo.postcode}`, source: 'HM Land Registry', ttlMs: TTL.sold }, () => fetchSoldPrices(geo.postcode))).catch(() => null),
        withDeadline(cached(ctx.prisma, { key: `constraints:${cc}`, source: 'planning.data.gov.uk', ttlMs: TTL.constraints }, () => fetchConstraints(geo.latitude, geo.longitude))).catch(() => null),
        withDeadline(cached(ctx.prisma, { key: `epc:${geo.postcode}`, source: 'EPC register', ttlMs: TTL.epc }, () => fetchEpc(geo.postcode, epcCreds))).catch(() => null),
        withDeadline(cached(ctx.prisma, { key: `flood:${cc}`, source: 'Environment Agency', ttlMs: TTL.flood }, () => fetchFloodWarnings(geo.latitude, geo.longitude))).catch(() => null),
        withDeadline(cached(ctx.prisma, { key: `amenities:${cc}`, source: 'OpenStreetMap', ttlMs: TTL.amenities }, () => fetchAmenities(geo.latitude, geo.longitude))).catch(() => null),
      ]);

      /**
       * Three outcomes, kept distinct because they mean different things to a
       * valuer: it arrived, it is still coming, or the source refused. Collapsing
       * "not back yet" into "error" would report a working service as broken;
       * collapsing it into "ok" with an empty list would report an unchecked site
       * as clear, which is the one this product must never do.
       */
      const settle = <T>(r: T | typeof pending | null) =>
        r === pending ? ({ state: 'slow' as const }) : r === null ? ({ state: 'error' as const }) : ({ state: 'ok' as const, ...(r as { value: unknown; fetchedAt: Date }) });

      const soldS = settle(soldRes);
      const constraintsS = settle(constraintsRes);
      const epcS = settle(epcRes);
      const floodS = settle(floodRes);
      const amenityS = settle(amenityRes);

      const epc =
        epcS.state === 'ok'
          ? (epcS.value as Awaited<ReturnType<typeof fetchEpc>>)
          : { status: (epcS.state === 'slow' ? 'slow' : 'error') as 'slow' | 'error', records: [], note: epcS.state === 'slow' ? 'Still fetching from the EPC register.' : 'EPC fetch failed' };
      const sold = soldS.state === 'ok' ? (soldS.value as Awaited<ReturnType<typeof fetchSoldPrices>>) : null;
      const coords = sold?.length
        ? (await cached(ctx.prisma, { key: `geo:${geo.postcode}`, source: 'postcodes.io', ttlMs: TTL.geo }, async () => Object.fromEntries(await bulkGeocode(sold.map((s) => s.postcode))))
            .then((c) => new Map(Object.entries(c.value as Record<string, { lat: number; lng: number }>)))
            .catch(() => new Map<string, { lat: number; lng: number }>()))
        : new Map<string, { lat: number; lng: number }>();

      return {
        status: 'ok' as const,
        dealName: deal.name,
        address: deal.address,
        geo,
        soldPrices: sold
          ? {
              status: 'ok' as const,
              asAt: (soldS as { fetchedAt: Date }).fetchedAt.toISOString(),
              items: sold.map((s) => {
                const c = coords.get(s.postcode.toUpperCase());
                return { ...s, psf: matchPsf(s, epc.records), lat: c?.lat ?? null, lng: c?.lng ?? null };
              }),
            }
          : { status: soldS.state, items: [] },
        constraints:
          constraintsS.state === 'ok'
            ? { status: 'ok' as const, asAt: (constraintsS as { fetchedAt: Date }).fetchedAt.toISOString(), ...(constraintsS.value as Awaited<ReturnType<typeof fetchConstraints>>) }
            : { status: constraintsS.state, checked: [], hits: [] },
        epc,
        floodWarnings:
          floodS.state === 'ok'
            ? { status: 'ok' as const, asAt: (floodS as { fetchedAt: Date }).fetchedAt.toISOString(), items: floodS.value as Awaited<ReturnType<typeof fetchFloodWarnings>> }
            : { status: floodS.state, items: [] },
        amenities:
          amenityS.state === 'ok'
            ? { status: 'ok' as const, asAt: (amenityS as { fetchedAt: Date }).fetchedAt.toISOString(), items: amenityS.value as Awaited<ReturnType<typeof fetchAmenities>> }
            : { status: amenityS.state, items: [] },
        /** true while any panel is still fetching — the UI refetches once on it */
        incomplete: [soldS, constraintsS, epcS, floodS, amenityS].some((x) => x.state === 'slow'),
        fetchedAt: new Date().toISOString(),
      };
    }),

  /** Counterparty due diligence — Companies House (self-serve key on the Integrations screen). */
  companySearch: internalProcedure.input(z.object({ q: z.string().min(2).max(80) })).query(async ({ ctx, input }) => {
    const creds = await getIntegrationCreds(ctx.prisma, ctx.principal.orgId, 'Companies House');
    if (!companiesHouseConfigured(creds?.key)) {
      return {
        status: 'not-configured' as const,
        note: 'Free API key required — register at developer.company-information.service.gov.uk, then connect Companies House on the Integrations screen.',
        results: [],
      };
    }
    return { status: 'ok' as const, results: await searchCompanies(input.q, creds?.key) };
  }),

  company: internalProcedure.input(z.object({ companyNumber: z.string().min(4).max(10) })).query(async ({ ctx, input }) => {
    const creds = await getIntegrationCreds(ctx.prisma, ctx.principal.orgId, 'Companies House');
    if (!companiesHouseConfigured(creds?.key)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Companies House key not configured' });
    return companyProfile(input.companyNumber, creds?.key);
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
