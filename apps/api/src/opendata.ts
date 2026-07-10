/**
 * UK open-data connectors — the data moat, from free public APIs:
 *  - postcodes.io           geocoding + nearby postcodes (no key)
 *  - HM Land Registry PPD   sold prices, OGL licence (no key)
 *  - planning.data.gov.uk   planning constraints incl. flood zones (no key)
 *  - EPC register           floor areas/ratings (free key: EPC_AUTH_EMAIL + EPC_AUTH_KEY)
 * Every fetch is timeboxed and fails soft — a dead upstream degrades one panel,
 * never the whole site pack.
 */

const TIMEOUT_MS = 12_000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
}

export async function geocodePostcode(postcode: string): Promise<Geo> {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  const d = await getJson<{ result: { postcode: string; latitude: number; longitude: number; admin_district: string; region: string } }>(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`,
  );
  const r = d.result;
  return { postcode: r.postcode, latitude: r.latitude, longitude: r.longitude, district: r.admin_district, region: r.region };
}

async function nearestPostcodes(postcode: string, limit = 8): Promise<string[]> {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  try {
    const d = await getJson<{ result: Array<{ postcode: string }> | null }>(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}/nearest?limit=${limit}&radius=1000`,
    );
    return (d.result ?? []).map((r) => r.postcode);
  } catch {
    return [postcode];
  }
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
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postcodes: unique }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return out;
    const d = (await res.json()) as { result: Array<{ query: string; result: { latitude: number; longitude: number } | null }> };
    for (const r of d.result ?? []) {
      if (r.result) out.set(r.query.toUpperCase(), { lat: r.result.latitude, lng: r.result.longitude });
    }
  } catch {
    /* map stays partial — pins degrade gracefully */
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
        `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(pc)}&_pageSize=25`,
      ),
    ),
  );
  const out: SoldPrice[] = [];
  for (const b of batches) {
    if (b.status !== 'fulfilled') continue;
    for (const t of b.value.result.items ?? []) {
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
  floorAreaSqm: number;
  rating: string;
  propertyType: string;
  inspectionDate: string;
  source: string;
}

/** EPC register — free key from epc.opendatacommunities.org (EPC_AUTH_EMAIL + EPC_AUTH_KEY). */
export async function fetchEpc(postcode: string): Promise<{ status: 'ok' | 'not-configured' | 'error'; records: EpcRecord[]; note?: string }> {
  const email = process.env.EPC_AUTH_EMAIL;
  const key = process.env.EPC_AUTH_KEY;
  if (!email || !key) {
    return {
      status: 'not-configured',
      records: [],
      note: 'Free API key required — register at epc.opendatacommunities.org, then set EPC_AUTH_EMAIL and EPC_AUTH_KEY.',
    };
  }
  try {
    const auth = Buffer.from(`${email}:${key}`).toString('base64');
    const d = await getJson<{ rows?: any[] }>(
      `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=50`,
      { authorization: `Basic ${auth}` },
    );
    return {
      status: 'ok',
      records: (d.rows ?? []).map((r) => ({
        address: String(r.address ?? ''),
        floorAreaSqm: Number(r['total-floor-area']) || 0,
        rating: String(r['current-energy-rating'] ?? ''),
        propertyType: String(r['property-type'] ?? ''),
        inspectionDate: String(r['inspection-date'] ?? ''),
        source: 'EPC Register (OGL)',
      })),
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

const HPI_REGION_SLUGS: Record<string, string> = {
  'South West': 'south-west',
  'South East': 'south-east',
  London: 'london',
  Midlands: 'west-midlands',
  'East Midlands': 'east-midlands',
  'West Midlands': 'west-midlands',
  'North West': 'north-west',
  'North East': 'north-east',
  'Yorkshire and The Humber': 'yorkshire-and-the-humber',
  'East of England': 'east-of-england',
  Wales: 'wales',
  Scotland: 'scotland',
};

/**
 * UK House Price Index (HM Land Registry, OGL, no key) — REAL market levels and
 * annual growth for the region, latest N months. Data publishes ~6 weeks behind.
 */
export async function fetchHpi(region: string, months = 12): Promise<{ region: string; series: HpiPoint[] }> {
  const slug = HPI_REGION_SLUGS[region] ?? 'south-west';
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

/** Try to pair a sold price with an EPC floor area (house-number match) → £/ft². */
export function matchPsf(sold: SoldPrice, epc: EpcRecord[]): number | null {
  const num = sold.address.match(/\b(\d+[A-Za-z]?)\b/)?.[1]?.toLowerCase();
  if (!num) return null;
  const hit = epc.find((r) => {
    const rnum = r.address.match(/\b(\d+[A-Za-z]?)\b/)?.[1]?.toLowerCase();
    return rnum === num && r.floorAreaSqm > 10;
  });
  if (!hit) return null;
  return Math.round(sold.price / (hit.floorAreaSqm * 10.764));
}
