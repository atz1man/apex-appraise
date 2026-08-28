/**
 * End-to-end smoke test, run against a built preview server.
 *
 *   npm run build && npx vite preview --port 5183 &
 *   CHROMIUM_PATH=/path/to/chrome node scripts/smoke.mjs
 *
 * It checks the four things unit tests cannot: that the swipe gesture
 * actually returns a receipt, that state survives a reload (the whole
 * local-first promise), that the page contacts NO third party, and that
 * nothing throws on the way through.
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.KEPT_ORIGIN ?? 'http://localhost:5183';
const EXEC = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
const page = await ctx.newPage();

const problems = [];
const foreign = new Set();
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.origin !== ORIGIN && u.protocol !== 'data:' && u.protocol !== 'blob:') foreign.add(u.origin);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});

await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Skip' }).click();
await page.waitForTimeout(300);

// Swipe the urgent row left past the commit threshold.
const row = page.getByRole('button', { name: /Currys, JBL/ });
const box = await row.boundingBox();
const y = box.y + box.height / 2;
await page.mouse.move(box.x + box.width - 40, y);
await page.mouse.down();
for (let dx = 0; dx <= 110; dx += 22) {
  await page.mouse.move(box.x + box.width - 40 - dx, y);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(600);

const results = {
  'swipe marks the receipt returned': await page.getByText('MONEY BACK').isVisible(),
};

await page.getByRole('button', { name: 'Share the win' }).click();
await page.waitForTimeout(300);
results['share confirms'] = await page.getByRole('button', { name: /Copied/ }).isVisible();

// The tab bar floats over every screen; its buttons must stay clickable.
await page.getByRole('button', { name: 'Back to receipts' }).click();
await page.waitForTimeout(400);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
results['the return survives a reload'] = await page.getByText('MONEY BACK ✓').isVisible();
results['onboarding is not shown again'] = !(await page
  .getByRole('button', { name: 'Skip' })
  .isVisible()
  .catch(() => false));
results['nothing is fetched from a third party'] = foreign.size === 0;
results['no console or page errors'] = problems.length === 0;

await browser.close();

let failed = false;
for (const [name, ok] of Object.entries(results)) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed = true;
}
if (foreign.size) console.log('  third-party origins:', [...foreign].join(', '));
for (const p of problems) console.log('  ' + p);
process.exit(failed ? 1 : 0);
