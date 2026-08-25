/**
 * Minimal Stripe REST client — no SDK dependency. All calls are form-encoded per
 * Stripe's API. Absent STRIPE_SECRET_KEY every helper reports 'not-configured'
 * so callers degrade to labelled demo behaviour.
 */

const API = 'https://api.stripe.com/v1';

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
// `||`: compose sends `${STRIPE_PUBLISHABLE_KEY:-}`, and '' is not null — a
// caller checking for null would have been handed an empty string instead
export const stripePublishableKey = () => process.env.STRIPE_PUBLISHABLE_KEY || null;

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

/**
 * The plan catalogue lives in @apex/types/plan — the landing page renders the
 * same three columns and used to keep its own copy, which had already drifted.
 * Re-exported here so every existing import still resolves.
 */
import { PLANS, type PlanDef } from '@apex/types/plan';
export { PLANS };
export type { PlanDef };

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
