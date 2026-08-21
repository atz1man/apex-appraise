import type { PrismaClient } from '@prisma/client';
import { type Geo, geocodePostcode, isNotFound } from './opendata.js';

/**
 * Caching for the public open-data lookups behind the site pack.
 *
 * The screen took twenty-five seconds. Not because it was doing anything
 * unreasonable — five sources, already fanned out in parallel — but because it
 * asked the internet the same questions every single time it was opened, and one
 * of those questions (Environment Agency floods) reliably takes eleven seconds
 * while another (Overpass) takes six to fail. A valuer opening the same site
 * twice paid twice.
 *
 * None of it is data that changes while somebody is looking at it. Land Registry
 * price paid data is published monthly; planning constraints and EPC certificates
 * move over weeks; a railway station is where it was this morning. Flood WARNINGS
 * are the one genuinely live feed, and they get minutes rather than weeks.
 *
 * Three properties make this honest rather than merely fast:
 *
 *  - A failure is never cached. A dead upstream must not turn into a fortnight of
 *    confidently served emptiness — the panel says it failed, and it is tried
 *    again shortly.
 *  - An OUTAGE, though, is remembered for two minutes (see the cool-off below),
 *    so a source that is down costs one visitor the timeout rather than all of
 *    them. What is remembered is "this failed", never "there was nothing there".
 *  - The age travels with the value. Every cached panel reports when it was
 *    actually fetched, so the screen can say "as at" rather than implying it was
 *    all pulled the moment you looked.
 */

/** How long each source stays fresh. */
export const TTL = {
  /** published monthly; a week is already conservative */
  sold: 7 * 24 * 60 * 60 * 1000,
  /** designations change on a planning committee's timetable */
  constraints: 30 * 24 * 60 * 60 * 1000,
  /** certificates are lodged continuously but a site's set moves slowly */
  epc: 14 * 24 * 60 * 60 * 1000,
  /** the live one: an active flood warning is not a monthly publication */
  flood: 10 * 60 * 1000,
  /** shops and stations do not move */
  amenities: 30 * 24 * 60 * 60 * 1000,
  /** coordinates for a postcode are effectively permanent */
  geo: 90 * 24 * 60 * 60 * 1000,
} as const;

export interface Cached<T> {
  value: T;
  /** when the underlying fetch actually happened */
  fetchedAt: Date;
  /** served from store rather than fetched during this request */
  fromCache: boolean;
}

/**
 * In-flight refreshes, so a stale key being read by five people at once triggers
 * one background fetch rather than five. Process-local on purpose: the failure
 * mode of getting this wrong across instances is a duplicated request, which
 * costs nothing anybody notices.
 */
const refreshing = new Set<string>();

/**
 * Sources that just failed, and until when to stop asking.
 *
 * Not caching failures is right — a dead upstream must not become a fortnight of
 * served emptiness — but taken alone it means a source that is DOWN costs every
 * single visitor the full timeout. Overpass was measured failing after six
 * seconds, so every open of every site pack bought the same six seconds of
 * nothing.
 *
 * So the OUTAGE is remembered, briefly, while the DATA still is not. During the
 * window the panel reports unavailable immediately — which is both faster and
 * exactly as true as waiting to find out. Two minutes, because a source coming
 * back should be noticed by the next person who looks, not by the next shift.
 */
const COOLOFF_MS = 2 * 60 * 1000;
const coolingOff = new Map<string, number>();

/** Thrown instead of re-attempting a source known to be failing. */
export class SourceCoolingOff extends Error {
  constructor(key: string) {
    super(`Source recently failed and is cooling off: ${key}`);
    this.name = 'SourceCoolingOff';
  }
}

/** Test seam: forget every recorded outage. */
export const resetCooloff = () => coolingOff.clear();

export async function cached<T>(
  prisma: PrismaClient,
  opts: { key: string; source: string; ttlMs: number },
  fetcher: () => Promise<T>,
): Promise<Cached<T>> {
  const row = await prisma.openDataCache.findUnique({ where: { key: opts.key } }).catch(() => null);

  /**
   * A source known to be down is not asked again until its cool-off expires —
   * unless something is stored, in which case the stored value is still better
   * than nothing and is served below with its true age attached.
   */
  const cooling = (coolingOff.get(opts.key) ?? 0) > Date.now();
  if (cooling && !row) throw new SourceCoolingOff(opts.key);

  if (row) {
    const age = Date.now() - row.fetchedAt.getTime();
    const value = JSON.parse(row.payload) as T;
    if (age <= opts.ttlMs) return { value, fetchedAt: row.fetchedAt, fromCache: true };

    /**
     * Stale, so serve it and refresh behind the request. The alternative — making
     * the person who happened to arrive first wait eleven seconds for the
     * Environment Agency — is how a cache ends up feeling slower than none.
     */
    if (!refreshing.has(opts.key) && !cooling) {
      refreshing.add(opts.key);
      void fetcher()
        .then((fresh) => {
          coolingOff.delete(opts.key);
          return write(prisma, opts, fresh);
        })
        .catch(() => coolingOff.set(opts.key, Date.now() + COOLOFF_MS))
        .finally(() => refreshing.delete(opts.key));
    }
    return { value, fetchedAt: row.fetchedAt, fromCache: true };
  }

  // Nothing stored: this caller waits, and only a SUCCESS is written down.
  try {
    const value = await fetcher();
    coolingOff.delete(opts.key);
    await write(prisma, opts, value);
    return { value, fetchedAt: new Date(), fromCache: false };
  } catch (err) {
    /**
     * Remember the outage, never the emptiness — and a 404 is emptiness. The
     * cool-off exists to stop us hammering an upstream that is DOWN, and an
     * upstream that answered "no such thing" has proved it is up. Treating that
     * as an outage also lost the reason: the second look inside the cool-off
     * throws SourceCoolingOff rather than the original 404, so a genuinely bad
     * postcode reported "isn't a recognised postcode" the first time and "the
     * lookup is unavailable" on exactly the retry that message asks for.
     */
    if (!isNotFound(err)) coolingOff.set(opts.key, Date.now() + COOLOFF_MS);
    throw err;
  }
}

async function write(prisma: PrismaClient, opts: { key: string; source: string }, value: unknown) {
  const payload = JSON.stringify(value);
  await prisma.openDataCache
    .upsert({
      where: { key: opts.key },
      create: { key: opts.key, source: opts.source, payload, fetchedAt: new Date() },
      update: { payload, fetchedAt: new Date(), source: opts.source },
    })
    .catch(() => undefined); // a cache that cannot write must not break the request
}

/**
 * Coordinates rounded to ~100m before they become a cache key.
 *
 * Two sites on the same street should share a constraints lookup; without
 * rounding, every deal gets its own key and the cache never hits. Four decimal
 * places would be a unique key per building, which is a cache in name only.
 */
export const coordKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

/**
 * Drop rows nothing will read again. Called on boot rather than on a timer: the
 * table is small, and a cache that grows forever on a machine with a disk quota
 * eventually stops being a performance feature.
 */
export async function pruneOpenDataCache(prisma: PrismaClient, olderThanMs = 60 * 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.openDataCache.deleteMany({ where: { fetchedAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  return count;
}

/**
 * Where a deal is, and — when it cannot be placed — WHY.
 *
 * The subject's own geocode was the one uncached, unguarded call sitting in
 * front of five cached and deadlined ones, and every failure of it was reported
 * as `bad-postcode`: a confident claim about the customer's data. So a
 * postcodes.io outage told a valuer that the site postcode they had typed
 * correctly "isn't a recognised UK postcode", and blanked the whole site pack —
 * sold prices, flood risk, constraints, EPC — behind that sentence.
 *
 * This is the flood-chip lesson again: "there is nothing there" and "we could
 * not look" are the same picture and opposite facts. postcodes.io answers 404
 * for a postcode that does not exist, which is a fact about the postcode;
 * anything else — a timeout, a 5xx, a refused connection — is a fact about
 * postcodes.io, and the two must not print the same sentence.
 *
 * Cached for the same reason the rest of the pack is: coordinates for a postcode
 * are effectively permanent, so asking again on every open bought nothing and
 * cost a round trip in front of everything else.
 */
export type Located =
  | { status: 'located'; geo: Geo; fetchedAt: Date }
  /** the deal has no postcode to look up */
  | { status: 'no-postcode' }
  /** the upstream answered, and this postcode is not a real one */
  | { status: 'bad-postcode'; postcode: string }
  /** we could not ask — say so, and never dress it as the customer's mistake */
  | { status: 'unavailable'; postcode: string };

export async function locate(prisma: PrismaClient, postcode: string | null | undefined): Promise<Located> {
  const clean = (postcode ?? '').trim();
  if (!clean) return { status: 'no-postcode' };
  try {
    const hit = await cached(prisma, { key: `geocode:${clean.replace(/\s+/g, '').toUpperCase()}`, source: 'postcodes.io', ttlMs: TTL.geo }, () =>
      geocodePostcode(clean),
    );
    return { status: 'located', geo: hit.value, fetchedAt: hit.fetchedAt };
  } catch (e) {
    return isNotFound(e) ? { status: 'bad-postcode', postcode: clean } : { status: 'unavailable', postcode: clean };
  }
}
