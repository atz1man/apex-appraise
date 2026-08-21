import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * "That postcode does not exist" and "we could not reach the geocoder" are
 * different facts, and one of them is an accusation.
 *
 * Every failure to geocode the subject used to return `bad-postcode`, so a
 * postcodes.io outage told a valuer that the site postcode they had typed
 * correctly "isn't a recognised UK postcode" — and blanked the entire site pack
 * behind that sentence, sold prices and flood risk included.
 *
 * Only `geocodePostcode` is replaced here. HttpError and isNotFound are the real
 * ones, because the thing under test IS how a failure is classified: a mocked
 * classifier would agree with whatever the test asserted.
 */
const geocodePostcode = vi.fn();

vi.mock('../src/opendata.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/opendata.js')>()),
  geocodePostcode,
  // the site pack's other sources, stubbed so the router reaches its geocode
  fetchSoldPrices: vi.fn(async () => []),
  fetchConstraints: vi.fn(async () => ({ checked: [], hits: [] })),
  fetchEpc: vi.fn(async () => ({ status: 'ok' as const, records: [], note: '' })),
  fetchFloodWarnings: vi.fn(async () => []),
  fetchAmenities: vi.fn(async () => []),
  bulkGeocode: vi.fn(async () => new Map()),
  matchPsf: vi.fn(() => null),
}));

const { HttpError } = await import('../src/opendata.js');
const { callerFor, makeTenant, prisma, resetDatabase } = await import('./harness.js');
type Tenant = Awaited<ReturnType<typeof makeTenant>>;

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Geocode');
}, 120_000);

/** A fresh postcode per test: the cool-off is keyed by postcode. */
let n = 0;
const postcodeFor = () => `ZZ${++n} 9ZZ`;

async function sitePackFor(postcode: string) {
  await prisma.deal.update({ where: { id: T.dealId }, data: { postcode } });
  return (await callerFor(T.principal).sitePack.get({ dealId: T.dealId } as never)) as { status: string; postcode?: string };
}

describe('a subject that cannot be placed', () => {
  it('blames the postcode only when the upstream actually said so', async () => {
    const pc = postcodeFor();
    geocodePostcode.mockRejectedValueOnce(new HttpError(404, 'https://api.postcodes.io/postcodes/X'));
    expect((await sitePackFor(pc)).status).toBe('bad-postcode');
  });

  it('blames itself when the geocoder is unreachable', async () => {
    const pc = postcodeFor();
    // what a timeout looks like from fetch: not an HTTP status at all
    geocodePostcode.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    const res = await sitePackFor(pc);
    expect(res.status).toBe('unavailable');
    // the sentence a customer reads must not send them to fix correct data
    expect(res.postcode).toBe(pc);
  });

  it('a 500 from the geocoder is an outage, not a bad postcode', async () => {
    const pc = postcodeFor();
    geocodePostcode.mockRejectedValueOnce(new HttpError(503, 'https://api.postcodes.io/postcodes/X'));
    expect((await sitePackFor(pc)).status).toBe('unavailable');
  });

  /**
   * "check it and try again" is the advice the bad-postcode screen gives, so the
   * try-again has to say the same thing. It did not: a failure set a two-minute
   * cool-off, and the second look inside it threw SourceCoolingOff instead of the
   * original 404 — which is not an HttpError, so it read as an outage.
   */
  it('still says the same thing on the retry it asks the user to make', async () => {
    const pc = postcodeFor();
    geocodePostcode.mockRejectedValue(new HttpError(404, 'https://api.postcodes.io/postcodes/X'));
    expect((await sitePackFor(pc)).status).toBe('bad-postcode');
    expect((await sitePackFor(pc)).status).toBe('bad-postcode');
    geocodePostcode.mockReset();
  });

  /** An outage, by contrast, SHOULD cool off — that is what the cool-off is for. */
  it('does not hammer a geocoder that is down', async () => {
    const pc = postcodeFor();
    geocodePostcode.mockRejectedValue(new HttpError(503, 'https://api.postcodes.io/postcodes/X'));
    expect((await sitePackFor(pc)).status).toBe('unavailable');
    const askedOnce = geocodePostcode.mock.calls.length;
    expect((await sitePackFor(pc)).status).toBe('unavailable');
    expect(geocodePostcode.mock.calls.length, 'the second look asked a source known to be down').toBe(askedOnce);
    geocodePostcode.mockReset();
  });
});

describe('the comparables map', () => {
  it('locates the subject server-side, so the browser never calls postcodes.io', async () => {
    const pc = postcodeFor();
    await prisma.deal.update({ where: { id: T.dealId }, data: { postcode: pc } });
    geocodePostcode.mockResolvedValueOnce({ postcode: pc, latitude: 50.73, longitude: -1.87, district: 'Bournemouth', region: 'South West' });

    const res = (await callerFor(T.principal).comparables.list(T.dealId)) as {
      subject: { status: string; geo?: { latitude: number; longitude: number } };
    };
    expect(res.subject.status).toBe('located');
    expect(res.subject.geo?.latitude).toBe(50.73);
    geocodePostcode.mockReset();
  });

  it('says the subject has no postcode rather than that the lookup failed', async () => {
    await prisma.deal.update({ where: { id: T.dealId }, data: { postcode: null } });
    const res = (await callerFor(T.principal).comparables.list(T.dealId)) as { subject: { status: string } };
    expect(res.subject.status).toBe('no-postcode');
    // and it must not have asked: there was nothing to ask about
    expect(geocodePostcode).not.toHaveBeenCalled();
  });
});
