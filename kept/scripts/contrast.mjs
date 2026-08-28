/**
 * WCAG contrast sweep over every screen.
 *
 *   npm run build && npx vite preview --port 5183 &
 *   CHROMIUM_PATH=/path/to/chrome node scripts/contrast.mjs
 *
 * The palette came from a design handoff, and a handoff is drawn on a big
 * bright monitor. This walks what the browser ACTUALLY renders — every text
 * node, its computed colour, and the real background behind it, composited
 * through however many translucent layers sit in between — and measures the
 * ratio. Anything a person has to read is held to WCAG AA: 4.5:1, or 3:1 once
 * the text is large.
 *
 * There is no allowlist. The one exemption is the one WCAG itself grants —
 * SC 1.4.3 exempts text that is part of a logo or brand name — and it is
 * claimed by the element, via data-logotype, not by a list in this file that
 * would rot as the UI moved. Everything else that fails is either readable
 * and mis-measured, or unreadable and mis-coloured.
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.KEPT_ORIGIN ?? 'http://localhost:5183';
const EXEC = process.env.CHROMIUM_PATH;

const SWEEP = `() => {
  const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(',').map((s) => parseFloat(s));
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  // Composite src over dst at alpha a.
  const over = (src, dst, a) => src.map((v, i) => v * a + dst[i] * (1 - a));

  // The real background behind an element: walk up compositing every
  // translucent layer until something opaque is hit. Anything less and a
  // white-on-glass pill measures against transparent and reads as perfect.
  const backgroundOf = (el) => {
    let acc = null;
    let node = el;
    while (node && node !== document.documentElement.parentNode) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc === null ? { rgb: bg.rgb, a: bg.a } : { rgb: over(acc.rgb, bg.rgb, acc.a), a: acc.a + bg.a * (1 - acc.a) };
        if (acc.a >= 0.999) return acc.rgb;
      }
      node = node.parentElement;
    }
    return acc ? over(acc.rgb, [255, 255, 255], acc.a) : [255, 255, 255];
  };

  const ratio = (a, b) => {
    const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
    return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
  };

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    // Only elements with their own visible text.
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (!text) continue;
    // WCAG 1.4.3: logotypes carry no contrast minimum.
    if (el.closest('[data-logotype]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) continue;

    const bg = backgroundOf(el);
    const colour = fg.a < 1 ? over(fg.rgb, bg, fg.a) : fg.rgb;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const got = ratio(colour, bg);
    if (got < required) {
      out.push({
        text: text.slice(0, 60), tag: el.tagName.toLowerCase(),
        color: cs.color, background: 'rgb(' + bg.map(Math.round).join(', ') + ')',
        size, weight, required, ratio: Math.round(got * 100) / 100,
      });
    }
  }
  return out;
}`;


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
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
const page = await ctx.newPage();

const failures = [];
const sweep = async (label) => {
  const found = await page.evaluate(eval(SWEEP));
  for (const f of found) failures.push({ screen: label, ...f });
};

await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await sweep('onboarding 1');
await page.getByRole('button', { name: 'Next' }).click();
await page.waitForTimeout(300);
await sweep('onboarding 2');
await page.getByRole('button', { name: 'Next' }).click();
await page.waitForTimeout(300);
await sweep('onboarding 3');
// Seed THEN reload: the app reads storage once at init, so writing storage
// into a running page changes nothing — which is what the first version of
// this did, leaving the search box unaudited while reporting a pass. The seed
// also marks onboarding seen, so the reload lands straight on home.
await page.evaluate(SEED_MORE);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await sweep('home');

await page.getByRole('button', { name: /Currys, JBL/ }).click();
await page.waitForTimeout(400);
await sweep('receipt detail');
await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.waitForTimeout(400);
await sweep('edit');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Got my money back' }).click();
await page.waitForTimeout(500);
await sweep('celebrate');
await page.getByRole('button', { name: 'Back to receipts' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: /^Watch/ }).click();
await page.waitForTimeout(400);
await sweep('policy watch');
await page.getByRole('button', { name: 'Add a receipt' }).click();
await page.waitForTimeout(400);
await page.fill('#paste', 'Your Apple order · Total £129.00 · 25 Aug');
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);
await sweep('add receipt');
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(400);
await sweep('settings');

// The destructive confirm is a state, not a screen, and its red fill is a
// colour pairing that appears nowhere else — so it has to be opened to be
// swept at all.
await page.getByRole('button', { name: 'Erase everything' }).click().catch(() => {});
await page.waitForTimeout(300);
await sweep('settings · erase confirm');
await page.getByRole('button', { name: 'Keep them' }).click().catch(() => {});

// The landing page too — it is the first thing anyone reads.
const wide = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const lp = await wide.newPage();
await lp.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
await lp.waitForTimeout(800);
for (const y of [0, 900, 1800, 2700, 3600, 4500]) {
  await lp.evaluate((v) => window.scrollTo(0, v), y);
  await lp.waitForTimeout(200);
}
for (const f of await lp.evaluate(eval(SWEEP))) failures.push({ screen: 'landing', ...f });

await browser.close();

// One row per distinct colour-on-colour pairing; the same token failing in
// nine places is one decision to revisit, not nine.
const seen = new Map();
for (const f of failures) {
  const key = `${f.color}|${f.background}|${f.required}`;
  if (!seen.has(key)) seen.set(key, { ...f, screens: new Set([f.screen]), examples: [f.text] });
  else {
    const e = seen.get(key);
    e.screens.add(f.screen);
    if (e.examples.length < 3) e.examples.push(f.text);
  }
}

if (seen.size === 0) {
  console.log('✓ every text node meets WCAG AA on every screen');
  process.exit(0);
}
console.log(`✗ ${seen.size} colour pairing(s) below WCAG AA, across ${failures.length} element(s):\n`);
for (const f of [...seen.values()].sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${f.ratio}:1 (needs ${f.required}:1)  ${f.color} on ${f.background}`);
  console.log(`    ${f.size}px/${f.weight} · ${[...f.screens].join(', ')}`);
  console.log(`    e.g. ${f.examples.map((t) => JSON.stringify(t)).join(', ')}\n`);
}
process.exit(1);
