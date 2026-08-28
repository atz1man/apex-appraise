/**
 * Accessibility audit over every screen, using axe-core.
 *
 *   npm run build && npx vite preview --port 5183 &
 *   CHROMIUM_PATH=/path/to/chrome node scripts/a11y.mjs
 *
 * The contrast sweep next door measures one thing very precisely. This asks
 * the broader questions a person using a screen reader or a keyboard would
 * run into: is every control named, is the heading order sane, are landmarks
 * present, does anything rely on colour alone.
 *
 * axe-core ships in devDependencies only and is injected into the page at
 * audit time — it is never imported by the app and never reaches a bundle.
 *
 * Colour-contrast rules are disabled here on purpose: scripts/contrast.mjs
 * already does that job against the real composited backgrounds, including
 * the translucent tab bar, which axe declines to judge and reports as
 * "incomplete" rather than pass or fail.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core'), 'utf8');

const ORIGIN = process.env.KEPT_ORIGIN ?? 'http://localhost:5183';
const EXEC = process.env.CHROMIUM_PATH;


// The search box only appears above a handful of receipts, so the seeded
// five would leave it unaudited. Top the list up first.
const SEED_MORE = () => {
  const s = JSON.parse(localStorage.getItem('kept.v1'));
  const base = s.receipts[0];
  const extra = ['Sony WH-1000XM5', 'Dyson V15', 'Le Creuset casserole', 'Adidas Sambas'];
  s.receipts = s.receipts.concat(
    extra.map((item, i) => ({ ...base, id: 'seedmore' + i, item, status: 'active' })),
  );
  s.onboardingSeen = true;
  localStorage.setItem('kept.v1', JSON.stringify(s));
};

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});

async function audit(page, label, findings) {
  await page.evaluate(AXE_SOURCE);
  const results = await page.evaluate(async () => {
    return await window.axe.run(document, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    });
  });
  for (const v of results.violations) {
    findings.push({
      screen: label,
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 120)),
    });
  }
}

const findings = [];

const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
const page = await ctx.newPage();
await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await audit(page, 'onboarding', findings);
// Seed THEN reload: the app reads storage once at init, so writing it into a
// running page changes nothing — which is exactly what the first version of
// this did, leaving the search box unaudited while reporting a pass.
await page.evaluate(SEED_MORE);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Skip' }).click().catch(() => {});
await page.waitForTimeout(400);
await audit(page, 'home', findings);

await page.getByRole('button', { name: /Currys, JBL/ }).click();
await page.waitForTimeout(400);
await audit(page, 'receipt detail', findings);

await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.waitForTimeout(400);
await audit(page, 'edit', findings);
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Got my money back' }).click();
await page.waitForTimeout(500);
await audit(page, 'celebrate', findings);
await page.getByRole('button', { name: 'Back to receipts' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: /^Watch/ }).click();
await page.waitForTimeout(400);
await audit(page, 'policy watch', findings);

await page.getByRole('button', { name: 'Add a receipt' }).click();
await page.waitForTimeout(300);
await page.fill('#paste', 'Your Apple order · Total £129.00 · 25 Aug');
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);
await audit(page, 'add receipt', findings);

await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(400);
await audit(page, 'settings', findings);

const wide = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const lp = await wide.newPage();
await lp.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
await lp.waitForTimeout(800);
await audit(lp, 'landing', findings);

await browser.close();

// One row per rule, listing the screens it fires on: the same mistake in nine
// places is one thing to fix, not nine.
const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.id)) byRule.set(f.id, { ...f, screens: new Set([f.screen]) });
  else byRule.get(f.id).screens.add(f.screen);
}

if (byRule.size === 0) {
  console.log('✓ no accessibility violations on any screen');
  process.exit(0);
}
console.log(`✗ ${byRule.size} rule(s) violated, across ${findings.length} occurrence(s):\n`);
for (const f of [...byRule.values()]) {
  console.log(`  [${f.impact}] ${f.id} — ${f.help}`);
  console.log(`    ${[...f.screens].join(', ')}`);
  for (const n of f.nodes) console.log(`    ${n}`);
  console.log('');
}
process.exit(1);
