/**
 * Companies House public data API — counterparty due diligence. Free API key
 * from developer.company-information.service.gov.uk → set COMPANIES_HOUSE_KEY.
 * Without the key every call reports 'not-configured' so the UI degrades
 * honestly (same pattern as the EPC connector).
 */

const API = 'https://api.company-information.service.gov.uk';

export const companiesHouseConfigured = (orgKey?: string | null) => Boolean(orgKey || process.env.COMPANIES_HOUSE_KEY);

async function chFetch<T>(path: string, orgKey?: string | null): Promise<T> {
  const key = orgKey || process.env.COMPANIES_HOUSE_KEY;
  if (!key) throw new Error('not-configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Companies House ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface CompanySummary {
  companyNumber: string;
  name: string;
  status: string;
  type: string;
  incorporated: string;
  address: string;
}

export async function searchCompanies(q: string, orgKey?: string | null): Promise<CompanySummary[]> {
  const d = await chFetch<{ items: any[] }>(`/search/companies?q=${encodeURIComponent(q)}&items_per_page=8`, orgKey);
  return (d.items ?? []).map((i) => ({
    companyNumber: String(i.company_number ?? ''),
    name: String(i.title ?? ''),
    status: String(i.company_status ?? ''),
    type: String(i.company_type ?? ''),
    incorporated: String(i.date_of_creation ?? ''),
    address: String(i.address_snippet ?? ''),
  }));
}

export interface CompanyProfile {
  summary: CompanySummary;
  sicCodes: string[];
  officers: Array<{ name: string; role: string; appointed: string }>;
  charges: ChargeSummary;
  accountsOverdue: boolean;
}

export interface ChargeSummary {
  /** every charge on the register, from the API's own count */
  total: number;
  /** how many are not fully satisfied — a lender still holds security */
  outstanding: number;
  /**
   * Whether `outstanding` was counted over the whole register.
   *
   * False when the register holds more charges than one page returned, in which
   * case the count is a floor and the screen must say so. An understated figure
   * presented as exact is the defect this replaced.
   */
  complete: boolean;
  /** the handful the panel lists; presentation, never the population counted */
  items: Array<{ description: string; status: string; created: string; personsEntitled: string[] }>;
}

/**
 * Shape the charges response.
 *
 * Split out from the fetch so it can be exercised. `total` came from the API's
 * `total_count` while `outstanding` was counted inside the SIX items the panel
 * lists, so one sentence — "N outstanding of M" — measured its two halves
 * against different populations, and a company with twenty charges could never
 * report more than six outstanding however many it had. On a due-diligence
 * panel about how much of a counterparty's assets are already pledged, that
 * error only ever runs one way.
 */
export function shapeCharges(raw: {
  total_count?: number;
  unfiltered_count?: number;
  items?: Array<Record<string, any>>;
}): ChargeSummary {
  const all = raw.items ?? [];
  const total = Number(raw.total_count ?? raw.unfiltered_count ?? all.length) || all.length;
  return {
    total,
    // "part-satisfied" is still a charge on the assets, so anything short of
    // fully satisfied counts
    outstanding: all.filter((c) => String(c.status ?? '') !== 'fully-satisfied').length,
    complete: all.length >= total,
    items: all.slice(0, 6).map((c) => ({
      description: String(c.classification?.description ?? c.charge_code ?? 'Charge'),
      status: String(c.status ?? ''),
      created: String(c.created_on ?? ''),
      personsEntitled: (c.persons_entitled ?? []).map((pe: any) => String(pe.name)).slice(0, 3),
    })),
  };
}

/** Profile + officers + charges — the "who are we buying from?" answer. */
export async function companyProfile(companyNumber: string, orgKey?: string | null): Promise<CompanyProfile> {
  const [profile, officers, charges] = await Promise.allSettled([
    chFetch<any>(`/company/${companyNumber}`, orgKey),
    chFetch<{ items: any[] }>(`/company/${companyNumber}/officers?items_per_page=10`, orgKey),
    // 100, not the default page: the outstanding count is only meaningful over
    // the whole register, and `complete` below says so when it is not
    chFetch<{ total_count?: number; unfiltered_count?: number; items?: any[] }>(
      `/company/${companyNumber}/charges?items_per_page=100`,
      orgKey,
    ),
  ]);
  if (profile.status !== 'fulfilled') throw new Error('company not found');
  const p = profile.value;
  const off = officers.status === 'fulfilled' ? (officers.value.items ?? []) : [];
  const ch = charges.status === 'fulfilled' ? charges.value : { items: [] as any[] };
  return {
    summary: {
      companyNumber: String(p.company_number ?? companyNumber),
      name: String(p.company_name ?? ''),
      status: String(p.company_status ?? ''),
      type: String(p.type ?? ''),
      incorporated: String(p.date_of_creation ?? ''),
      address: [p.registered_office_address?.address_line_1, p.registered_office_address?.locality, p.registered_office_address?.postal_code]
        .filter(Boolean)
        .join(', '),
    },
    sicCodes: (p.sic_codes ?? []).slice(0, 4).map(String),
    officers: off
      .filter((o: any) => !o.resigned_on)
      .slice(0, 6)
      .map((o: any) => ({ name: String(o.name ?? ''), role: String(o.officer_role ?? ''), appointed: String(o.appointed_on ?? '') })),
    charges: shapeCharges(ch),
    accountsOverdue: Boolean(p.accounts?.overdue),
  };
}
