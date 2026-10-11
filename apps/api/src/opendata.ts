/**
 * UK open-data connectors — the data moat, from free public APIs:
 *  - postcodes.io           geocoding + nearby postcodes (no key)
 *  - HM Land Registry PPD   sold prices, OGL licence (no key)
 *  - planning.data.gov.uk   planning constraints incl. flood zones (no key)
 *  - EPC register           floor areas/ratings (free key: EPC_AUTH_EMAIL + EPC_AUTH_KEY)
 * Every fetch is timeboxed and fails soft — a dead upstream degrades one panel,
 * never the whole site pack.
 */

import { hpiSlugFor } from '@apex/types/uk-regions';
import { analysedPsf, SQFT_PER_SQM } from '@apex/appraisal-engine';

const TIMEOUT_MS = 12_000;

/**
 * A refusal that carries its status code.
 *
 * "The postcode does not exist" and "the geocoder is down" arrive here as the
 * same thrown Error, and callers were reduced to one catch block that had to
 * pick a story — which is how a postcodes.io outage came to tell valuers that
 * their site's postcode was not a real one. Keeping the code lets a caller say
 * which of the two actually happened.
 */
export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}`);
    this.name = 'HttpError';
  }
}

/** The upstream answered, and the answer was "that does not exist". */
export const isNotFound = (e: unknown) => e instanceof HttpError && (e.status === 404 || e.status === 400);

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface Geo {
  postcode: string;
  latitude: number;
  longitude: number;
  district: string;
  region: string;
  country?: 'England' | 'Wales' | 'Scotland' | 'Northern Ireland' | null;
}

export async function geocodePostcode(postcode: string): Promise<Geo> {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  const d = await getJson<{ result: { postcode: string; latitude: number; longitude: number; admin_district: string; region: string; country?: string | null } }>(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`,
  );
  const r = d.result;
  const country: Geo['country'] = r.country === 'England' || r.country === 'Wales' || r.country === 'Scotland' || r.country === 'Northern Ireland' ? r.country : null;
  return { postcode: r.postcode, latitude: r.latitude, longitude: r.longitude, district: r.admin_district, region: r.region, country };
}

async function nearestPostcodes(postcode: string, limit = 8): Promise<string[]> {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  const d = await getJson<{ result: Array<{ postcode: string }> | null }>(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}/nearest?limit=${limit}&radius=1000`,
  );
  if (d.result !== null && !Array.isArray(d.result)) throw new Error('Invalid nearby-postcode response');
  // A valid empty neighbourhood still permits looking up the subject itself.
  // An outage must not silently narrow a nearby search to one postcode.
  return [...new Set([postcode, ...(d.result ?? []).map((r) => r.postcode)])].slice(0, limit);
}

export interface SoldPrice {
  price: number;
  date: string; // ISO yyyy-mm-dd
  address: string;
  postcode: string;
  propertyType: string;
  newBuild: boolean;
  estateType: string;
  source: string;
  lat?: number | null;
  lng?: number | null;
}

/** Bulk postcode → coordinates (postcodes.io, max 100 per call). */
export async function bulkGeocode(postcodes: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const unique = [...new Set(postcodes.filter(Boolean))].slice(0, 100);
  const out = new Map<string, { lat: number; lng: number }>();
  if (!unique.length) return out;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postcodes: unique }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new HttpError(res.status, 'https://api.postcodes.io/postcodes');
    const d = (await res.json()) as { result: Array<{ query: string; result: { latitude: number; longitude: number } | null }> };
    if (!Array.isArray(d.result)) throw new Error('Invalid bulk postcode response');
    for (const r of d.result) {
      if (r.result) out.set(r.query.toUpperCase(), { lat: r.result.latitude, lng: r.result.longitude });
    }
  } finally {
    // Keep the deadline through JSON consumption, including a stalled body.
    clearTimeout(timer);
  }
  return out;
}

const label = (v: unknown): string => {
  if (typeof v === 'string') return v.split('/').pop() ?? v;
  if (Array.isArray(v)) return label(v[0]);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return label(o._value ?? o.label ?? '');
  }
  return '';
};

/** HM Land Registry Price Paid Data around a postcode (fans out over nearby postcodes). */
export async function fetchSoldPrices(postcode: string): Promise<SoldPrice[]> {
  const codes = await nearestPostcodes(postcode);
  const batches = await Promise.allSettled(
    codes.map((pc) =>
      getJson<{ result: { items: any[] } }>(
        `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(pc)}&_pageSize=40&_sort=-transactionDate`,
      ),
    ),
  );
  // An incomplete fan-out is an unavailable search, not an empty or complete
  // result. In particular cached() must never store an outage for a week.
  if (batches.some((b) => b.status === 'rejected')) throw new Error('HM Land Registry search incomplete; retry later');
  const out: SoldPrice[] = [];
  for (const b of batches) {
    if (b.status !== 'fulfilled') continue;
    if (!Array.isArray(b.value.result?.items)) throw new Error('Invalid HM Land Registry response');
    for (const t of b.value.result.items) {
      const a = t.propertyAddress ?? {};
      const addressParts = [a.saon, a.paon, label(a.street) || a.street, a.town].filter(Boolean);
      const date = new Date(t.transactionDate);
      out.push({
        price: Number(t.pricePaid) || 0,
        date: Number.isNaN(date.getTime()) ? String(t.transactionDate ?? '') : date.toISOString().slice(0, 10),
        address: addressParts
          .map((s: string) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()))
          .join(', '),
        postcode: a.postcode ?? '',
        propertyType: label(t.propertyType) || 'other',
        newBuild: t.newBuild === true || t.newBuild === 'true',
        estateType: label(t.estateType) || '',
        source: 'HM Land Registry Price Paid Data (OGL)',
      });
    }
  }
  // newest first, de-dupe identical address+date+price
  const seen = new Set<string>();
  return out
    .filter((s) => {
      const k = `${s.address}|${s.date}|${s.price}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, 40);
}

export interface Constraint {
  dataset: string;
  name: string;
  reference: string;
  entryDate: string;
  source: string;
}

const CONSTRAINT_DATASETS = [
  'conservation-area',
  'green-belt',
  'flood-risk-zone',
  'listed-building-outline',
  'article-4-direction-area',
  'tree-preservation-zone',
  'area-of-outstanding-natural-beauty',
  'site-of-special-scientific-interest',
  'scheduled-monument',
  'brownfield-land',
];

/** Planning constraints intersecting the site point (planning.data.gov.uk). */
export async function fetchConstraints(lat: number, lng: number): Promise<{ checked: string[]; hits: Constraint[] }> {
  const qs = CONSTRAINT_DATASETS.map((d) => `dataset=${d}`).join('&');
  const d = await getJson<{ entities: any[] }>(
    `https://www.planning.data.gov.uk/entity.json?longitude=${lng}&latitude=${lat}&${qs}&limit=50`,
  );
  return {
    checked: CONSTRAINT_DATASETS,
    hits: (d.entities ?? []).map((e) => ({
      dataset: String(e.dataset ?? ''),
      name: String(e.name ?? e.reference ?? 'Unnamed'),
      reference: String(e.reference ?? ''),
      entryDate: String(e['entry-date'] ?? ''),
      source: 'planning.data.gov.uk (OGL)',
    })),
  };
}

export interface EpcRecord {
  address: string;
  postcode?: string;
  certificateNumber?: string;
  floorAreaSqm: number;
  rating: string;
  propertyType: string;
  inspectionDate: string;
  source: string;
}

const EPC_API = 'https://api.get-energy-performance-data.communities.gov.uk';

/**
 * EPC register — MHCLG's "get energy performance data" service (the old
 * epc.opendatacommunities.org domain was retired May 2026). Auth is a Bearer
 * token; credentials come from the org's self-serve integration settings,
 * falling back to the EPC_BEARER_TOKEN env var. The search endpoint returns
 * summaries only, so floor areas are joined from per-certificate lookups
 * (bounded, concurrent — well inside the 6000/5min rate limit).
 */
export async function fetchEpc(
  postcode: string,
  creds?: { key?: string } | null,
): Promise<{ status: 'ok' | 'not-configured' | 'error'; records: EpcRecord[]; note?: string }> {
  const key = creds?.key || process.env.EPC_BEARER_TOKEN;
  if (!key) {
    return {
      status: 'not-configured',
      records: [],
      note: 'Free API key required — register at get-energy-performance-data.communities.gov.uk, then connect EPC Register on the Integrations screen.',
    };
  }
  const auth = { authorization: `Bearer ${key}`, accept: 'application/json' };
  // the service 404s when a register has no certificates for the postcode — that's an empty result, not an error
  const search = async (register: 'domestic' | 'non-domestic') => {
    try {
      const d = await getJson<{ data?: any[] }>(`${EPC_API}/api/${register}/search?postcode=${encodeURIComponent(postcode)}`, auth);
      return d.data ?? [];
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) return [];
      throw e;
    }
  };
  try {
    const [dom, nonDom] = await Promise.all([search('domestic'), search('non-domestic')]);
    const summaries = [...dom, ...nonDom].slice(0, 24);
    // per-certificate details carry total_floor_area — fetch them concurrently
    const details = await Promise.allSettled(
      summaries.map((s) =>
        getJson<{ data?: any }>(`${EPC_API}/api/certificate?certificate_number=${encodeURIComponent(String(s.certificateNumber))}`, auth),
      ),
    );
    return {
      status: 'ok',
      records: summaries.map((s, i) => {
        const det = details[i]?.status === 'fulfilled' ? ((details[i] as PromiseFulfilledResult<{ data?: any }>).value.data ?? {}) : {};
        return {
          address: [s.addressLine1, s.addressLine2, s.addressLine3, s.addressLine4].filter(Boolean).join(', '),
          postcode: String(s.postcode ?? det.postcode ?? postcode),
          certificateNumber: String(s.certificateNumber ?? ''),
          // domestic certificates carry total_floor_area at the top level;
          // non-domestic (CEPC) nest it under technical_information.floor_area
          floorAreaSqm: Number(det.total_floor_area) || Number(det.technical_information?.floor_area) || 0,
          rating: String(s.currentEnergyEfficiencyBand ?? det.current_energy_efficiency_band ?? ''),
          propertyType: String(det.property_type ?? det.dwelling_type ?? ''),
          inspectionDate: String(s.registrationDate ?? det.registration_date ?? ''),
          source: 'EPC Register (OGL)',
        };
      }),
    };
  } catch (e) {
    return { status: 'error', records: [], note: e instanceof Error ? e.message : 'EPC fetch failed' };
  }
}

export interface FloodWarning {
  severity: string;
  severityLevel: number;
  description: string;
  message: string;
  source: string;
}

/** Live Environment Agency flood warnings within ~10km of the site (no key). */
export async function fetchFloodWarnings(lat: number, lng: number): Promise<FloodWarning[]> {
  const d = await getJson<{ items: any[] }>(
    `https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${lat}&long=${lng}&dist=10`,
  );
  return (d.items ?? []).slice(0, 6).map((i) => ({
    severity: String(i.severity ?? ''),
    severityLevel: Number(i.severityLevel) || 4,
    description: String(i.description ?? ''),
    message: String(i.message ?? '').slice(0, 240),
    source: 'Environment Agency flood-monitoring (OGL)',
  }));
}

export interface Amenity {
  kind: 'station' | 'school' | 'supermarket' | 'pharmacy';
  name: string;
  lat: number;
  lng: number;
}

/** Walkable amenities within 800m via OpenStreetMap Overpass (needs a UA header). */
export async function fetchAmenities(lat: number, lng: number): Promise<Amenity[]> {
  const q = `[out:json][timeout:15];(node(around:800,${lat},${lng})["railway"="station"];node(around:800,${lat},${lng})["amenity"="school"];node(around:800,${lat},${lng})["shop"="supermarket"];node(around:800,${lat},${lng})["amenity"="pharmacy"];);out 30;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ApexAppraise/1.0 (site pack)' },
      body: new URLSearchParams({ data: q }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()) as { elements: any[] };
    return (d.elements ?? [])
      .map((e): Amenity | null => {
        const t = e.tags ?? {};
        const kind = t.railway === 'station' ? 'station' : t.amenity === 'school' ? 'school' : t.shop === 'supermarket' ? 'supermarket' : t.amenity === 'pharmacy' ? 'pharmacy' : null;
        if (!kind || !e.lat || !e.lon) return null;
        return { kind, name: String(t.name ?? 'Unnamed'), lat: e.lat, lng: e.lon };
      })
      .filter((a): a is Amenity => a !== null)
      .slice(0, 20);
  } finally {
    clearTimeout(timer);
  }
}

export interface HpiPoint {
  month: string; // yyyy-mm
  averagePrice: number;
  annualChangePct: number | null;
}


/**
 * UK House Price Index (HM Land Registry, OGL, no key) — REAL market levels and
 * annual growth for the region, latest N months. Data publishes ~6 weeks behind.
 */
export async function fetchHpi(region: string, months = 12): Promise<{ region: string; series: HpiPoint[] }> {
  /**
   * The slug, or nothing. This carried its own copy of the region list — the
   * only one of the four that knew all twelve — and ended `?? 'south-west'`,
   * so a region it did not recognise was answered with South West house prices
   * under the asked-for region's name. A market index labelled as somewhere it
   * is not is worse than no index: the reader has no way to tell.
   */
  const slug = hpiSlugFor(region);
  if (!slug) return { region, series: [] };
  const now = new Date();
  now.setMonth(now.getMonth() - 2); // publication lag
  const wanted: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    wanted.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const results = await Promise.allSettled(
    wanted.map((m) =>
      getJson<{ result: { primaryTopic?: any } & any }>(`https://landregistry.data.gov.uk/data/ukhpi/region/${slug}/month/${m}.json`).then((d) => {
        const r = d.result?.primaryTopic ?? d.result ?? {};
        return {
          month: m,
          averagePrice: Number(r.averagePrice) || 0,
          annualChangePct: r.percentageAnnualChange != null ? Number(r.percentageAnnualChange) : null,
        } as HpiPoint;
      }),
    ),
  );
  const series = results
    .filter((r): r is PromiseFulfilledResult<HpiPoint> => r.status === 'fulfilled' && r.value.averagePrice > 0)
    .map((r) => r.value);
  return { region, series };
}

/**
 * A rate needs one identifiable floor-area record. House numbers alone join
 * different streets and flats, which puts another property's area under a
 * real sale price. Keep unclear or ambiguous addresses unknown for the analyst
 * to verify; spelling/punctuation differences are not a licence for fuzzy joins.
 */
export function matchPsf(sold: SoldPrice, epc: EpcRecord[]): number | null {
  const addressKey = (address: string) => address.toUpperCase().replace(/[,\s]+/g, ' ').trim();
  const postcodeKey = (postcode: string) => postcode.toUpperCase().replace(/\s+/g, '');
  const address = addressKey(sold.address);
  const postcode = postcodeKey(sold.postcode);
  if (!address || !postcode || !Number.isFinite(sold.price) || sold.price <= 0) return null;
  const matches = epc.filter((r) => addressKey(r.address) === address && !!r.postcode && postcodeKey(r.postcode) === postcode);
  if (matches.length !== 1) return null;
  const hit = matches[0]!;
  if (!Number.isFinite(hit.floorAreaSqm) || hit.floorAreaSqm <= 10) return null;
  const floorAreaSqft = hit.floorAreaSqm * SQFT_PER_SQM;
  if (!Number.isFinite(floorAreaSqft)) return null;
  return analysedPsf(sold.price, floorAreaSqft);
}
