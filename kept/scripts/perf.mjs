/**
 * How the app behaves as the library grows. A diagnostic, not a gate.
 *
 *   npm run build && npx vite preview --port 5183 &
 *   N=500 CHROMIUM_PATH=/path/to/chrome node scripts/perf.mjs
 *
 * The free tier caps at ten active receipts and the seeded demo has five, so
 * every other suite here runs against a small list. This one answers the
 * question none of them ask: what happens to someone on the paid tier who has
 * been using it for two years.
 *
 * It is deliberately not in CI. Wall-clock numbers on a shared runner measure
 * the runner as much as the app, and a threshold picked from them would fail
 * for reasons nobody could act on. Run it when changing how the list renders.
 *
 * Measured on this container, for comparison rather than as a promise:
 *
 *     25 receipts   625ms to first row   23ms to filter
 *     60 receipts   647ms                19ms
 *    150 receipts   708ms                31ms
 *    500 receipts   904ms                57ms
 *
 * Boot is about 620ms of that regardless; the list costs roughly 0.6ms per
 * receipt. Nothing here needs virtualising — and the reading that matters is
 * the SHAPE, which is linear, not the absolute numbers, which is why the
 * filter column moving by half between two sets of runs is recorded and not
 * explained: it was measured, and nothing in the app plausibly did it.
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.KEPT_ORIGIN ?? 'http://localhost:5183';
const EXEC = process.env.CHROMIUM_PATH;
const N = Number(process.env.N ?? 500);

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));

await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.evaluate((count) => {
  const s = JSON.parse(localStorage.getItem('kept.v1'));
  const base = s.receipts[0];
  const shops = ['Currys', 'Argos', 'Zara', 'Boots', 'IKEA', 'ASOS', 'Next', 'John Lewis', 'M&S', 'Uniqlo'];
  const today = new Date();
  s.receipts = Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (i % 300));
    return {
      ...base, id: `perf${i}`, store: shops[i % shops.length], item: `Item number ${i}`,
      purchasedOn: d.toISOString().slice(0, 10), windowDays: 30 + (i % 60),
      status: i % 7 === 0 ? 'returned' : 'active',
    };
  });
  s.onboardingSeen = true;
  s.settings = { ...s.settings, plan: 'pro' };
  localStorage.setItem('kept.v1', JSON.stringify(s));
}, N);

const t0 = Date.now();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('li button');
const paint = Date.now() - t0;
await page.waitForTimeout(400);

// Every keystroke re-filters and re-derives, so this is the interaction most
// likely to feel slow before anything else does.
const t1 = Date.now();
await page.fill('#receipt-search', 'item number 4');
await page.waitForFunction((total) => document.querySelectorAll('li button').length < total, N, { timeout: 5000 });
const filter = Date.now() - t1;

console.log(`${N} receipts: ${paint}ms to first row, ${filter}ms to filter, ${await page.locator('li button').count()} rows shown`);
if (problems.length) console.log('errors:', problems.join('; '));
await browser.close();
