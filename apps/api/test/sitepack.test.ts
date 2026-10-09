import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The site pack's five sources run in parallel, so the response used to take as
 * long as the SLOWEST of them: 11s for the Environment Agency, 6s for Overpass to
 * fail, on a screen whose sold prices arrived in 400ms.
 *
 * Mocked at the connector boundary, because the point under test is the router's
 * behaviour when an upstream is slow — not whether the Land Registry is up. A
 * test that reached the real APIs would be slow, flaky, and would prove the
 * opposite of what it claims on the day one of them was down.
 */
vi.mock('../src/opendata.js', async (importOriginal) => ({
  /**
   * Spread the real module first: the caching layer classifies failures with
   * this module's own isNotFound, and a mock that replaced it wholesale left
   * that classifier undefined — so the one code path that decides whether to
   * blame the customer's postcode or our own outage would have thrown instead
   * of running, in the suite meant to cover it.
   */
  ...(await importOriginal<typeof import('../src/opendata.js')>()),
  geocodePostcode: vi.fn(async () => ({ postcode: 'BH8 8EW', latitude: 50.7312, longitude: -1.8765, district: 'Bournemouth', region: 'South West' })),
  fetchSoldPrices: vi.fn(async () => [
    { price: 425000, date: '2026-02-01', address: '1 Test Street', postcode: 'BH8 8EW', propertyType: 'terraced', newBuild: false, estateType: 'freehold', source: 'HM Land Registry Price Paid Data (OGL)' },
  ]),
  fetchConstraints: vi.fn(async () => ({ checked: ['flood-risk-zone'], hits: [] })),
  fetchEpc: vi.fn(async () => ({ status: 'ok' as const, records: [], note: '' })),
  // the slow one: never resolves within the router's deadline
  fetchFloodWarnings: vi.fn(() => new Promise(() => {})),
  fetchAmenities: vi.fn(async () => []),
  bulkGeocode: vi.fn(async () => new Map()),
  matchPsf: vi.fn(() => null),
}));

const { callerFor, makeTenant, prisma, resetDatabase } = await import('./harness.js');
type Tenant = Awaited<ReturnType<typeof makeTenant>>;

let T: Tenant;

beforeAll(async () => {
  vi.stubEnv('EPC_BEARER_TOKEN', 'epc-fixture');
  resetDatabase();
  T = await makeTenant('SitePack');
  await prisma.deal.update({ where: { id: T.dealId }, data: { postcode: 'BH8 8EW' } });
}, 120_000);
afterAll(() => vi.unstubAllEnvs());

describe('a slow source', () => {
  it('does not hold the page, and is reported as still fetching rather than as clear', async () => {
    const started = Date.now();
    const res = (await callerFor(T.principal).sitePack.get({ dealId: T.dealId } as never)) as {
      status: string;
      incomplete: boolean;
      floodWarnings: { status: string; items: unknown[] };
      soldPrices: { status: string; items: unknown[]; asAt?: string };
    };
    const elapsed = Date.now() - started;

    expect(res.status).toBe('ok');
    // the whole point: one hanging upstream costs seconds, not minutes
    expect(elapsed, `took ${elapsed}ms`).toBeLessThan(8_000);

    // and the panel that did not arrive says so — NOT 'ok' with an empty list,
    // which on this panel would read as "no flood warnings near this site"
    expect(res.floodWarnings.status).toBe('slow');
    expect(res.incomplete).toBe(true);

    // everything that did arrive is there, with the age of the data attached
    expect(res.soldPrices.status).toBe('ok');
    expect(res.soldPrices.items).toHaveLength(1);
    expect(res.soldPrices.asAt).toBeTruthy();
  });

  it('serves the second look from the cache, without asking the upstreams again', async () => {
    const opendata = await import('../src/opendata.js');
    const soldCalls = (opendata.fetchSoldPrices as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    await callerFor(T.principal).sitePack.get({ dealId: T.dealId } as never);

    expect(
      (opendata.fetchSoldPrices as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
      'a second open must not re-ask the Land Registry',
    ).toBe(soldCalls);
  });
});

describe('sold-price lookup failure', () => {
  it('reports unavailable evidence, leaves no successful cache, and accepts a real empty search after recovery', async () => {
    const opendata = await import('../src/opendata.js');
    const { resetCooloff } = await import('../src/opendata-cache.js');
    await prisma.openDataCache.deleteMany({ where: { key: { startsWith: 'sold:' } } });
    resetCooloff();
    vi.mocked(opendata.fetchSoldPrices).mockRejectedValueOnce(new Error('HM Land Registry search incomplete'));
    vi.mocked(opendata.fetchFloodWarnings).mockResolvedValueOnce([]);

    const failed = await callerFor(T.principal).sitePack.get({ dealId: T.dealId } as never);
    expect(failed.status).toBe('ok');
    if (failed.status !== 'ok') throw new Error('Expected located site');
    expect(failed.soldPrices.status).toBe('error');
    expect(failed.soldPrices.items).toEqual([]);
    expect('asAt' in failed.soldPrices).toBe(false);
    expect(await prisma.openDataCache.findUnique({ where: { key: 'sold:v2:BH8 8EW' } })).toBeNull();

    resetCooloff();
    vi.mocked(opendata.fetchSoldPrices).mockResolvedValueOnce([]);
    const recovered = await callerFor(T.principal).sitePack.get({ dealId: T.dealId } as never);
    if (recovered.status !== 'ok') throw new Error('Expected located site');
    expect(recovered.soldPrices.status).toBe('ok');
    expect(recovered.soldPrices.items).toEqual([]);
    expect('asAt' in recovered.soldPrices).toBe(true);
  });
});

describe('source territory and recovery', () => {
  it.each([
    ['Scotland', 'EH1 1AA', 'out-of-coverage', 'out-of-coverage'],
    ['Northern Ireland', 'BT1 1AA', 'out-of-coverage', 'out-of-coverage'],
    ['Wales', 'CF10 1AA', 'ok', 'out-of-coverage'],
  ] as const)('does not report empty English searches as evidence for %s', async (country, postcode, soldStatus, planningStatus) => {
    const opendata = await import('../src/opendata.js');
    vi.mocked(opendata.geocodePostcode).mockResolvedValueOnce({ postcode, country, latitude: 55, longitude: -3, district: 'Fixture', region: 'Fixture' });
    const res = await callerFor(T.principal).sitePack.get({ dealId: T.dealId, postcode });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('Expected a located site');
    expect(res.soldPrices.status).toBe(soldStatus);
    expect(res.constraints.status).toBe(planningStatus);
    expect(res.floodWarnings.status).toBe('out-of-coverage');
    if (country !== 'Wales') expect(res.epc.status).toBe('out-of-coverage');
  });

  it('does not cache a failed EPC response as two weeks of unavailable evidence', async () => {
    const opendata = await import('../src/opendata.js');
    vi.mocked(opendata.geocodePostcode).mockResolvedValueOnce({ postcode: 'CF10 2AA', country: 'Wales', latitude: 51, longitude: -3, district: 'Fixture', region: 'Fixture' });
    vi.mocked(opendata.fetchEpc).mockResolvedValueOnce({ status: 'error', records: [], note: 'Fixture upstream failure' });
    const input = { dealId: T.dealId, postcode: 'CF10 2AA' };
    const before = vi.mocked(opendata.fetchEpc).mock.calls.length;
    const first = await callerFor(T.principal).sitePack.get(input);
    expect(first.status === 'ok' && first.epc.status).toBe('error');
    expect(await prisma.openDataCache.findUnique({ where: { key: `epc:v4:${T.orgId}:CF10 2AA` } })).toBeNull();
    // Simulate the short upstream cool-off elapsing; no fortnight-long failure cache.
    (await import('../src/opendata-cache.js')).resetCooloff();
    const second = await callerFor(T.principal).sitePack.get(input);
    expect(second.status === 'ok' && second.epc.status).toBe('ok');
    expect(vi.mocked(opendata.fetchEpc).mock.calls.length).toBe(before + 2);
  });
});

// A missing-key result must not prevent an immediate later configured lookup.
it('keeps missing EPC configuration out of shared successful caches', async () => {
  const opendata = await import('../src/opendata.js');
  vi.mocked(opendata.geocodePostcode).mockResolvedValueOnce({ postcode: 'CF10 3AA', country: 'Wales', latitude: 51, longitude: -3, district: 'Fixture', region: 'Fixture' });
  vi.stubEnv('EPC_BEARER_TOKEN', '');
  const input = { dealId: T.dealId, postcode: 'CF10 3AA' };
  const missing = await callerFor(T.principal).sitePack.get(input);
  expect(missing.status === 'ok' && missing.epc.status).toBe('not-configured');
  expect(await prisma.openDataCache.findUnique({ where: { key: `epc:v4:${T.orgId}:CF10 3AA` } })).toBeNull();
  vi.stubEnv('EPC_BEARER_TOKEN', 'epc-fixture');
  const connected = await callerFor(T.principal).sitePack.get(input);
  expect(connected.status === 'ok' && connected.epc.status).toBe('ok');
});
