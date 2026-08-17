import { beforeAll, describe, expect, it } from 'vitest';
import { SourceCoolingOff, TTL, cached, coordKey, pruneOpenDataCache, resetCooloff } from '../src/opendata-cache.js';
import { prisma, resetDatabase } from './harness.js';

/**
 * The site pack took 25 seconds because it asked the internet the same questions
 * on every open — and one of those questions (Environment Agency floods) takes
 * eleven seconds while another (Overpass) takes six to fail.
 *
 * Two properties matter more than the speed, and both are asserted here: a
 * failure must never be cached, and the age of a value must travel with it. A
 * cache that remembers an outage for a fortnight, or that lets a screen imply a
 * flood check happened just now when it happened last month, has made the
 * product worse in exchange for making it fast.
 */

beforeAll(async () => {
  resetDatabase();
}, 120_000);

const key = (n: string) => `test:${n}:${Math.random().toString(36).slice(2)}`;

describe('the open-data cache', () => {
  it('fetches on a miss, then serves without fetching again', async () => {
    const k = key('hit');
    let calls = 0;
    const fetcher = async () => { calls++; return { items: [calls] }; };

    const first = await cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, fetcher);
    expect(first.fromCache).toBe(false);
    expect(calls).toBe(1);

    const second = await cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, fetcher);
    expect(second.fromCache).toBe(true);
    expect(second.value).toEqual({ items: [1] });
    expect(calls, 'a fresh hit must not reach the upstream').toBe(1);
  });

  it('serves a stale value immediately and refreshes behind the request', async () => {
    /**
     * The alternative — making whoever arrives first wait eleven seconds for the
     * refresh — is how a cache ends up feeling slower than none.
     */
    const k = key('stale');
    let calls = 0;
    const fetcher = async () => { calls++; return { n: calls }; };

    await cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, fetcher);
    // age it past its TTL
    await prisma.openDataCache.update({ where: { key: k }, data: { fetchedAt: new Date(Date.now() - 120_000) } });

    const stale = await cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, fetcher);
    expect(stale.value, 'the caller gets the old value, now, not a wait').toEqual({ n: 1 });
    expect(stale.fromCache).toBe(true);

    await new Promise((r) => setTimeout(r, 50)); // let the background refresh land
    const refreshed = await cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, fetcher);
    expect(refreshed.value, 'and the next reader gets the refreshed one').toEqual({ n: 2 });
  });

  it('never caches a failure, and picks the source back up when it recovers', async () => {
    /**
     * A dead upstream must not become a fortnight of confidently served
     * emptiness: nothing is written down, so there is no stale "no records here"
     * to serve later.
     *
     * The retry is deferred by the cool-off rather than immediate (see below) —
     * `resetCooloff()` stands in for that window having passed, because a test
     * that actually waited two minutes is a test nobody runs.
     */
    resetCooloff();
    const k = key('fail');
    await expect(cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, async () => { throw new Error('upstream down'); })).rejects.toThrow('upstream down');
    expect(await prisma.openDataCache.findUnique({ where: { key: k } }), 'a failure must leave nothing behind').toBeNull();

    resetCooloff();
    const recovered = await cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, async () => ({ ok: true }));
    expect(recovered.value).toEqual({ ok: true });
  });

  it('reports when the value was actually fetched, not when it was served', async () => {
    const k = key('asat');
    await cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, async () => ({ v: 1 }));
    const long_ago = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.openDataCache.update({ where: { key: k }, data: { fetchedAt: long_ago } });

    const served = await cached(prisma, { key: k, source: 'test', ttlMs: 30 * 24 * 60 * 60 * 1000 }, async () => ({ v: 2 }));
    expect(served.fetchedAt.toISOString()).toBe(long_ago.toISOString());
  });

  it('rounds coordinates so a street shares a lookup, and a TTL exists per source', () => {
    // ~100m: two sites on one street hit the same key; four decimals would be a
    // key per building, which is a cache in name only
    expect(coordKey(50.7312345, -1.8765432)).toBe('50.731,-1.877');
    expect(coordKey(50.7312999, -1.8765111)).toBe(coordKey(50.7312345, -1.8765432));

    // flood warnings are the live feed and must not be held for weeks
    expect(TTL.flood).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(TTL.sold).toBeGreaterThan(TTL.flood);
  });

  it('prunes what nothing will read again', async () => {
    const k = key('old');
    await cached(prisma, { key: k, source: 'test', ttlMs: 1 }, async () => ({ v: 1 }));
    await prisma.openDataCache.update({ where: { key: k }, data: { fetchedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } });
    await pruneOpenDataCache(prisma);
    expect(await prisma.openDataCache.findUnique({ where: { key: k } })).toBeNull();
  });
});

describe('a source that is down', () => {
  it('costs one visitor the timeout, not every visitor', async () => {
    /**
     * Not caching failures is right, but on its own it means a dead upstream is
     * re-attempted — and re-waited — by everybody. Overpass was measured taking
     * six seconds to fail, on every open of every site pack.
     */
    resetCooloff();
    const k = key('down');
    let calls = 0;
    const failing = async () => { calls++; throw new Error('HTTP 504'); };

    await expect(cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, failing)).rejects.toThrow('HTTP 504');
    expect(calls).toBe(1);

    // second caller is refused immediately rather than made to wait for the same failure
    await expect(cached(prisma, { key: k, source: 'test', ttlMs: 60_000 }, failing)).rejects.toBeInstanceOf(SourceCoolingOff);
    expect(calls, 'the upstream must not be asked again during the cool-off').toBe(1);

    // and what is remembered is the outage, not an empty result presented as data
    expect(await prisma.openDataCache.findUnique({ where: { key: k } })).toBeNull();
  });

  it('still serves what it already had, rather than refusing outright', async () => {
    /**
     * A cooling-off source with a stored value is not the same as one with
     * nothing: last week's sold prices, clearly aged, beat an empty panel.
     */
    resetCooloff();
    const k = key('down-but-known');
    await cached(prisma, { key: k, source: 'test', ttlMs: 1 }, async () => ({ v: 'known' }));
    await prisma.openDataCache.update({ where: { key: k }, data: { fetchedAt: new Date(Date.now() - 600_000) } });
    await expect(cached(prisma, { key: k, source: 'test', ttlMs: 1 }, async () => { throw new Error('down'); })).resolves.toMatchObject({
      value: { v: 'known' },
      fromCache: true,
    });
  });
});
