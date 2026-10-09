import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bulkGeocode, fetchSoldPrices, geocodePostcode } from '../src/opendata.js';
import { cached, resetCooloff } from '../src/opendata-cache.js';

const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const neighbours = () => response({ result: [{ postcode: 'BH8 8EW' }, { postcode: 'BH8 8EX' }] });
const transaction = (date = '2026-02-01') => ({
  pricePaid: 425000, transactionDate: date, propertyAddress: { paon: '1', street: 'TEST STREET', postcode: 'BH8 8EW' },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetCooloff();
});

describe('sold-price evidence completeness', () => {
  it('keeps a genuine empty search distinct from an outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/nearest?') ? neighbours() : response({ result: { items: [] } })));
    await expect(fetchSoldPrices('BH8 8EW')).resolves.toEqual([]);
  });

  it('rejects total source failure instead of producing cacheable emptiness', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/nearest?') ? neighbours() : new Response('', { status: 503 })));
    const upsert = vi.fn();
    const prisma = { openDataCache: { findUnique: vi.fn(async () => null), upsert } } as unknown as PrismaClient;
    await expect(cached(prisma, { key: 'sold:reliability', source: 'HM Land Registry', ttlMs: 60_000 }, () => fetchSoldPrices('BH8 8EW'))).rejects.toThrow(/incomplete/);
    expect(upsert, 'an unavailable search must not be recorded as a successful empty result').not.toHaveBeenCalled();
  });

  it('rejects a partial neighbourhood instead of silently certifying it as complete', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/nearest?')) return neighbours();
      if (url.includes('BH8%208EX')) throw new Error('network unavailable');
      return response({ result: { items: [transaction()] } });
    }));
    await expect(fetchSoldPrices('BH8 8EW')).rejects.toThrow(/incomplete/);
  });

  it('does not silently narrow the search when neighbour discovery fails', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchSoldPrices('BH8 8EW')).rejects.toThrow(/HTTP 503/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid source payload rather than claiming no records', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/nearest?') ? neighbours() : response({ result: {} })));
    await expect(fetchSoldPrices('BH8 8EW')).rejects.toThrow(/Invalid HM Land Registry/);
  });

  it('asks for the newest 40 per postcode before combining and deduplicating the sample', async () => {
    const fetcher = vi.fn(async (url: string) => url.includes('/nearest?') ? neighbours() : response({ result: { items: [transaction('2025-01-01'), transaction()] } }));
    vi.stubGlobal('fetch', fetcher);
    const sold = await fetchSoldPrices('BH8 8EW');
    expect(sold.map((s) => s.date)).toEqual(['2026-02-01', '2025-01-01']);
    for (const [url] of fetcher.mock.calls.filter(([u]) => u.includes('transaction-record'))) {
      const params = new URL(url).searchParams;
      expect(params.get('_sort')).toBe('-transactionDate');
      expect(params.get('_pageSize')).toBe('40');
    }
  });
});

describe('postcode pin lookup deadlines', () => {
  it('aborts a stalled response body, then clears its timer', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return { ok: true, json: () => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) };
    }));
    const result = expect(bulkGeocode(['BH8 8EW'])).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(12_000);
    await result;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer even when connecting fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused'); }));
    await expect(bulkGeocode(['BH8 8EW'])).rejects.toThrow('connection refused');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects refused geocoding instead of caching empty coordinates, while accepting genuinely unknown postcodes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const upsert = vi.fn();
    const prisma = { openDataCache: { findUnique: vi.fn(async () => null), upsert } } as unknown as PrismaClient;
    await expect(cached(prisma, { key: 'geo:reliability', source: 'postcodes.io', ttlMs: 60_000 }, () => bulkGeocode(['BH8 8EW']))).rejects.toThrow(/HTTP 503/);
    expect(upsert).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn(async () => response({ result: [{ query: 'ZZ1 1ZZ', result: null }] })));
    await expect(bulkGeocode(['ZZ1 1ZZ'])).resolves.toEqual(new Map());
  });
});

describe('postcode country coverage', () => {
  it('retains Scotland for callers deciding whether an England/Wales source covers this site', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ result: {
      postcode: 'EH1 1YZ', latitude: 55.95, longitude: -3.19, admin_district: 'City of Edinburgh', region: null, country: 'Scotland',
    } })));
    expect((await geocodePostcode('EH1 1YZ')).country).toBe('Scotland');
  });

  it('leaves an unrecognised or missing country unknown instead of assuming England', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ result: { postcode: 'EH1 1YZ', latitude: 55.95, longitude: -3.19, country: 'Unknown' } })));
    expect((await geocodePostcode('EH1 1YZ')).country).toBeNull();
  });
});
