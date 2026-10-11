import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensurePrice, PLANS } from '../src/stripe.js';
const plan = PLANS[0]!;
const valid = { id: 'price_fixture', active: true, unit_amount: plan.pricePencePerMonth, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const returns = (price: object) => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [price] })));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};
describe('a checkout charges the price the catalogue publishes', () => {
  it('accepts the matching monthly GBP price', async () => {
    const fetcher = returns(valid);
    expect(await ensurePrice(plan)).toBe(valid.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { unit_amount: 1 }, { active: false }, { currency: 'usd' },
    { recurring: { interval: 'year', interval_count: 1 } },
    { recurring: { interval: 'month', interval_count: 2 } },
  ])('refuses a mismatched existing price without creating a replacement: %j', async mismatch => {
    const fetcher = returns({ ...valid, ...mismatch });
    await expect(ensurePrice(plan)).rejects.toThrow(/does not match the published plan/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not create duplicate products when the price lookup fails', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Stripe unavailable' } }), { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(ensurePrice(plan)).rejects.toThrow(/Stripe unavailable/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
