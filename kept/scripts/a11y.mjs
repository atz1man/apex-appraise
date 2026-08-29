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

// A distance purchase renders a second statutory right — a second chip in the
// disclosure's header and a second body under it. The seeded Currys receipt
// was bought in a shop and carries only one, so this state needs opening by
// name to be audited at all.
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Zara, Wool-blend/ }).click();
await page.waitForTimeout(400);
await audit(page, 'receipt detail · distance purchase', findings);

// Its edit form, which is where the "Arrived on" field lives — only a
// delivered order has one, and the seeded receipt these sweeps open by default
// was bought over a counter, so nothing would ever have rendered it.
await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.waitForTimeout(400);
await audit(page, 'edit · delivered order', findings);
await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Currys, JBL/ }).click();
await page.waitForTimeout(400);

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

// The parser names no shop rather than guessing one, so the add screen asks.
// That field, its hint, and the hint's second wording once a known shop is
// typed are three things nothing else on any screen renders.
await page.fill('#paste', 'Your Vinted order · walking boots · Total £40.00 · 20 Aug 2026');
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);
await audit(page, 'add receipt · shop not recognised', findings);
await page.fill('#add-store', 'Boots');
await page.waitForTimeout(300);
await audit(page, 'add receipt · shop named by hand', findings);
await page.fill('#paste', 'Your Apple order · Total £129.00 · 25 Aug');
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(400);
await audit(page, 'settings', findings);

// The destructive confirm is a state, not a screen, and its red fill is a
// colour pairing that appears nowhere else — so it has to be opened to be
// swept at all.
await page.getByRole('button', { name: 'Erase everything' }).click().catch(() => {});
await page.waitForTimeout(300);
await audit(page, 'settings · erase confirm', findings);
await page.getByRole('button', { name: 'Keep them' }).click().catch(() => {});

// The upgrade sheet — a modal, which is the one thing on here that can trap a
// keyboard or announce itself as nothing at all, and it is reachable only by
// tapping a price.
await page.getByRole('button', { name: /£39\.99/ }).click().catch(() => {});
await page.waitForTimeout(300);
await audit(page, 'settings · upgrade notice', findings);
await page.getByRole('button', { name: 'Not now' }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(300);


/*
 * States, not screens. Nothing above navigates to these, so until now none of
 * them were audited at all — the same gap the erase confirm had.
 */
await page.getByRole('button', { name: 'Receipts', exact: true }).click().catch(() => {});
await page.waitForTimeout(300);

// The paste error card.
await page.getByRole('button', { name: 'Add a receipt' }).click().catch(() => {});
await page.waitForTimeout(300);
await page.fill('#paste', 'nothing a parser could use');
await page.getByRole('button', { name: 'Read it' }).click().catch(() => {});
await page.waitForTimeout(300);
await audit(page, 'add receipt · unreadable paste', findings);

// A returned receipt's detail, reachable only from the money-back list.
await page.getByRole('button', { name: 'Receipts', exact: true }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: /IKEA, MALM/ }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Got my money back' }).click().catch(() => {});
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Back to receipts' }).click().catch(() => {});
await page.waitForTimeout(400);
await page.getByRole('button', { name: /IKEA, MALM.*returned/ }).click().catch(() => {});
await page.waitForTimeout(400);
await audit(page, 'receipt detail · returned', findings);

// The undo offer after a delete.
await page.getByRole('button', { name: 'Delete' }).click().catch(() => {});
await page.waitForTimeout(400);
await audit(page, 'home · delete undo', findings);

// The standing warning when the device will not save.
await page.evaluate(() => {
  const real = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k, v) => {
    if (k === 'kept.v1') throw new DOMException('Quota', 'QuotaExceededError');
    return real(k, v);
  };
});
await page.getByRole('button', { name: /Zara, Wool-blend/ }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Got my money back' }).click().catch(() => {});
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Back to receipts' }).click().catch(() => {});
await page.waitForTimeout(500);
await audit(page, 'home · this device is not saving', findings);

const wide = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const lp = await wide.newPage();
await lp.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
await lp.waitForTimeout(800);
await audit(lp, 'landing', findings);

/*
 * Reduced motion, which axe does not check and nothing else here exercised.
 *
 * The stylesheet has honoured `prefers-reduced-motion` since it was written —
 * for the three animation CLASSES it names. Five transitions are declared
 * inline on the element instead, including the swipe row's `transform .25s`,
 * and an inline style is unreachable from a media query. So the setting was
 * stopping the decorative marquee and leaving the motion that moves a whole
 * row under someone's finger.
 *
 * Asked of the real screens rather than of the stylesheet: with the setting
 * on, nothing may still be running an endless animation, and no transition may
 * be long enough to be motion.
 */

/*
 * The screen shown when the app cannot render. It is a state, not a route, so
 * nothing here would ever have opened it — and it introduces a full-page
 * palette of its own. Reached the way the smoke suite reaches it: by making a
 * platform call the render depends on throw, which needs no test-only hook in
 * the app.
 */
{
  const brokenCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const brokenPage = await brokenCtx.newPage();
  await brokenPage.addInitScript(() => {
    // money() formats every amount on every screen through this.
    Number.prototype.toLocaleString = function toLocaleString() {
      throw new Error('simulated platform failure');
    };
  });
  // The first load is onboarding, which formats no money and renders fine.
  await brokenPage.goto(`${ORIGIN}/app/`, { waitUntil: 'domcontentloaded' });
  await brokenPage.waitForTimeout(500);
  await brokenPage.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('kept.v1') ?? '{}');
    stored.onboardingSeen = true;
    localStorage.setItem('kept.v1', JSON.stringify(stored));
  });
  await brokenPage.reload({ waitUntil: 'domcontentloaded' });
  await brokenPage.waitForTimeout(700);
  await audit(brokenPage, 'render failure', findings);
  await brokenPage.getByRole('button', { name: 'Save my receipts to a file' }).click().catch(() => {});
  await brokenPage.waitForTimeout(300);
  await audit(brokenPage, 'render failure · saved', findings);
  await brokenCtx.close();
}

/*
 * Where focus goes when the screen changes — the other question axe cannot
 * ask, because nothing about the markup is wrong.
 *
 * Every screen here is a swap inside one page, so the control that was clicked
 * unmounts as the new screen arrives and the browser has nowhere to put focus
 * but `document.body`. Measured: three of four transitions lost it. A keyboard
 * user's next Tab then restarts at the top of the document instead of
 * continuing in the screen they just opened, and a screen reader announces
 * nothing at all — the app silently becomes a different app.
 *
 * The requirement is not "focus always moves to the heading", which would take
 * focus off the tab bar and leave the app's primary navigation reachable only
 * by tabbing through an entire screen. It is: focus never falls to the
 * document, and the change is always discoverable — by landing on the new
 * heading, or by a live region saying which screen this now is.
 */
const focusCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
const focusPage = await focusCtx.newPage();
const lostFocus = [];
await focusPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
for (const [label, go] of [
  ['onboarding → home', async () => focusPage.getByRole('button', { name: 'Skip' }).click()],
  ['home → a receipt', async () => focusPage.getByRole('button', { name: /Currys, JBL/ }).click()],
  ['receipt → edit', async () => focusPage.getByRole('button', { name: 'Edit', exact: true }).click()],
  ['edit → back', async () => focusPage.getByRole('button', { name: 'Cancel' }).click()],
  ['receipt → watch tab', async () => focusPage.getByRole('button', { name: /^Watch/ }).click()],
  ['watch → settings', async () => focusPage.getByRole('button', { name: 'Settings', exact: true }).click()],
]) {
  await go();
  await focusPage.waitForTimeout(400);
  const landed = await focusPage.evaluate(() => {
    const el = document.activeElement;
    const heading = document.querySelector('main h1')?.textContent?.trim() ?? '';
    const spoken = [...document.querySelectorAll('[aria-live],[role="status"]')]
      .map((n) => (n.textContent ?? '').trim())
      .filter(Boolean);
    if (!el || el === document.body) return { lost: true, heading, spoken };
    return { lost: false, tag: el.tagName, onHeading: el.tagName === 'H1' && !!el.closest('main'), heading, spoken };
  });
  if (landed.lost) lostFocus.push([label, 'focus fell to the document']);
  else if (!landed.onHeading && !landed.spoken.includes(landed.heading)) {
    lostFocus.push([label, `focus stayed on ${landed.tag} and nothing announced "${landed.heading}"`]);
  }
}
await focusCtx.close();

const motionCtx = await browser.newContext({ viewport: { width: 402, height: 874 }, reducedMotion: 'reduce' });
const motionPage = await motionCtx.newPage();
function stillMovingIn() {
  const bad = [];
  const secs = (v) =>
    Math.max(0, ...String(v).split(',').map((x) => (x.includes('ms') ? parseFloat(x) / 1000 : parseFloat(x)) || 0));
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.animationName !== 'none' && s.animationIterationCount.split(',').includes('infinite')) {
      bad.push(['endless animation', s.animationName, (typeof el.className === 'string' && el.className) || el.tagName]);
    } else if (s.animationName !== 'none' && secs(s.animationDuration) > 0.05) {
      bad.push(['animation', s.animationDuration, (typeof el.className === 'string' && el.className) || el.tagName]);
    }
    if (secs(s.transitionDuration) > 0.05) bad.push(['transition', s.transitionDuration, (typeof el.className === 'string' && el.className) || el.tagName]);
  }
  return bad;
}

const stillMoving = [];
for (const [label, go] of [
  ['home', async () => {
    await motionPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
    await motionPage.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  }],
  ['receipt detail', async () => { await motionPage.getByRole('button', { name: /Currys, JBL/ }).click(); }],
  ['settings', async () => { await motionPage.getByRole('button', { name: 'Settings', exact: true }).click(); }],
  ['landing', async () => { await motionPage.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' }); }],
]) {
  await go();
  await motionPage.waitForTimeout(500);
  // A screen that rendered nothing would report a clean pass over an empty
  // page, which is the shape of a sweep that never asked its question.
  const rendered = await motionPage.evaluate(() => document.querySelectorAll('main *, section *').length);
  if (rendered < 5) stillMoving.push([label, 'nothing rendered to check', String(rendered), 'the walk broke here']);
  for (const row of await motionPage.evaluate(stillMovingIn)) stillMoving.push([label, ...row]);
}

// The ticker must be stopped outright, not merely run once by the blanket
// rule — the two class rules above it in the stylesheet are what do that.
await motionPage.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
const ticker = await motionPage.evaluate(() => {
  const el = document.querySelector('.k-ticker');
  return el ? getComputedStyle(el).animationName : 'missing';
});
if (ticker !== 'none') stillMoving.push(['landing', 'the marquee is not stopped', ticker, '.k-ticker']);
await motionCtx.close();

await browser.close();

if (lostFocus.length > 0) {
  console.log(`✗ focus is not managed across ${lostFocus.length} screen change(s):\n`);
  for (const [label, why] of lostFocus) console.log(`  ${label} — ${why}`);
  console.log('');
  process.exit(1);
}

if (stillMoving.length > 0) {
  console.log(`✗ ${stillMoving.length} thing(s) still moving with reduced motion on:\n`);
  const seen = new Set();
  for (const [screen, kind, value, who] of stillMoving) {
    const key = `${kind}|${value}|${who}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${kind} ${value} — ${String(who).slice(0, 60)} (${screen})`);
  }
  console.log('');
  process.exit(1);
}

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
