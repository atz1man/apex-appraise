/**
 * Minimal Stripe REST client — no SDK dependency. All calls are form-encoded per
 * Stripe's API. Absent STRIPE_SECRET_KEY every helper reports 'not-configured'
 * so callers degrade to labelled demo behaviour.
 */

const API = 'https://api.stripe.com/v1';

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
export const stripePublishableKey = () => process.env.STRIPE_PUBLISHABLE_KEY ?? null;

export async function stripeFetch<T = any>(
  path: string,
  params?: Record<string, string>,
  method: 'POST' | 'GET' = params ? 'POST' : 'GET',
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe not configured');
  const url = method === 'GET' && params ? `${API}${path}?${new URLSearchParams(params)}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' && params ? new URLSearchParams(params) : undefined,
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `Stripe ${res.status}`);
  return body;
}

export interface PlanDef {
  key: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  name: string;
  pricePencePerMonth: number;
  blurb: string;
  features: string[];
}

export const PLANS: PlanDef[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    pricePencePerMonth: 4900,
    blurb: 'For a single developer running a handful of deals',
    features: ['3 active deals', '2 team members', 'Appraisal engine + reports', 'Site pack (open data)'],
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    pricePencePerMonth: 14900,
    blurb: 'For teams running a live pipeline',
    features: ['Unlimited deals', '10 team members', 'AI Development Director', 'Buyer + investor portals', 'Benchmarking'],
  },
  {
    key: 'ENTERPRISE',
    name: 'Enterprise',
    pricePencePerMonth: 39900,
    blurb: 'Multi-entity groups and funds',
    features: ['Everything in Growth', 'Unlimited members', 'Priority support', 'Data exports + API access'],
  },
];

/** Idempotent product+price per plan via lookup_key. Returns the price id. */
export async function ensurePrice(plan: PlanDef): Promise<string> {
  const lookupKey = `apex_${plan.key.toLowerCase()}_monthly`;
  const existing = await stripeFetch<{ data: Array<{ id: string }> }>(
    `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&limit=1`,
    undefined,
    'GET',
  ).catch(() => ({ data: [] as Array<{ id: string }> }));
  if (existing.data?.[0]?.id) return existing.data[0].id;
  const product = await stripeFetch<{ id: string }>('/products', {
    name: `Apex Appraise ${plan.name}`,
    description: plan.blurb,
  });
  const price = await stripeFetch<{ id: string }>('/prices', {
    product: product.id,
    unit_amount: String(plan.pricePencePerMonth),
    currency: 'gbp',
    'recurring[interval]': 'month',
    lookup_key: lookupKey,
  });
  return price.id;
}
