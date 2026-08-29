/**
 * Does the app contradict itself?
 *
 *   npm run build && npx vite preview --port 5183 &
 *   CHROMIUM_PATH=/path/to/chrome node scripts/agreement.mjs
 *
 * Unit tests check that each calculation is right. Smoke checks that each flow
 * works. Neither catches the failure where two surfaces are each internally
 * consistent and say different things about the same fact — which is how the
 * edit screen came to preview a deadline two days from the one on the receipt
 * it was editing. Both halves were "correct"; they were computing from
 * different starting dates.
 *
 * So this asks one question repeatedly: the same fact, from more than one
 * place, has to match. A number that appears on exactly one screen is not
 * this file's business.
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.KEPT_ORIGIN ?? 'http://localhost:5183';
const EXEC = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await browser.newContext({
  viewport: { width: 402, height: 874 },
  permissions: ['notifications'],
});
const page = await ctx.newPage();

// Capture alert copy so it can be held to the same numbers the screen shows.
await page.addInitScript(() => {
  window.__notes = [];
  class StubNotification {
    static permission = 'granted';
    static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, opts) { window.__notes.push({ title, body: opts?.body }); }
  }
  window.Notification = StubNotification;
  navigator.serviceWorker?.ready.then((reg) => {
    const original = reg.showNotification?.bind(reg);
    reg.showNotification = (title, opts) => {
      window.__notes.push({ title, body: opts?.body });
      return original ? original(title, opts).catch(() => {}) : Promise.resolve();
    };
  }).catch(() => {});
});

const disagreements = [];
const agree = (what, ...values) => {
  const unique = [...new Set(values.map((v) => String(v).trim()))];
  if (unique.length !== 1) disagreements.push({ what, saw: unique });
};

const money = (s) => ((s ?? '').match(/£[\d,]+\.\d{2}/) ?? [null])[0];
const digits = (s) => ((s ?? '').match(/-?\d+/) ?? [null])[0];

await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const alerts = await page.evaluate(() => window.__notes);
await page.getByRole('button', { name: 'Skip' }).click();
await page.waitForTimeout(500);

/*
 * Read named elements, never a regex over concatenated textContent. The first
 * version of this file did the latter and reported three disagreements that
 * were all its own: "£89.00" immediately followed by "2 days" reads as
 * "89.002 days", and a greedy \d+ happily takes "002".
 */
const hero = await page.evaluate(() => {
  const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'NEXT WINDOW TO CLOSE');
  const card = label?.closest('button');
  if (!card) return null;
  const spans = [...card.querySelectorAll('span')];
  const count = spans.find((s) => /^[\d]+$|^Today$|^Gone$/.test(s.textContent.trim()));
  const line = [...card.querySelectorAll('div')].find((d) => /goes back by/.test(d.textContent));
  const footer = [...card.querySelectorAll('span')].filter((s) => /still returnable|kept back/.test(s.textContent));
  return {
    days: count?.textContent.trim() ?? null,
    // The tail of its own element, so nothing downstream can run into it.
    deadline: (line?.textContent.match(/goes back by (.+)$/) ?? [])[1]?.trim() ?? null,
    returnable: footer.find((s) => /still returnable/.test(s.textContent))?.textContent ?? null,
    keptBack: footer.find((s) => /kept back/.test(s.textContent))?.textContent ?? null,
  };
});

// Rows carry a structured accessible name — "Shop, item, £amount, urgency" —
// which is the one place their facts are already separated for us.
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('li button')].map((b) => {
    const parts = (b.getAttribute('aria-label') ?? '').split(', ');
    return { amount: parts.at(-2) ?? '', urgency: parts.at(-1) ?? '' };
  }),
);
const firstRow = rows[0];

await page.locator('li button').first().click();
await page.waitForTimeout(400);
const detail = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 92 92"]');
  const face = svg?.nextElementSibling;
  const label = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'RETURN BY');
  return {
    days: face?.firstElementChild?.textContent?.trim() ?? null,
    returnBy: label?.nextElementSibling?.textContent?.trim() ?? null,
  };
});

agree('days left, on the hero / the row / the countdown ring', hero.days, digits(firstRow.urgency), detail.days);
agree('the deadline date, on the hero and the receipt', hero.deadline, detail.returnBy);

await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.waitForTimeout(400);

/*
 * The edit screen's preview of the deadline, checked on the DISPATCH-CLOCKED
 * receipt specifically. Any other receipt starts its window on the purchase
 * date, so the two ways of computing it agree by coincidence and the check
 * proves nothing — which is exactly the hole this suite was written after,
 * and it would have missed it aimed at the first row.
 */
for (const shop of [/Zara, Wool-blend/, /Currys, JBL/]) {
  await page.getByRole('button', { name: shop }).click();
  await page.waitForTimeout(400);
  const returnBy = await page.evaluate(() => {
    const label = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'RETURN BY');
    return label?.nextElementSibling?.textContent?.trim() ?? null;
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForTimeout(400);
  const hint = (await page.locator('#e-window-hint').textContent()) ?? '';
  agree(
    `the deadline date, on the receipt and in its edit form (${String(shop)})`,
    returnBy,
    (hint.match(/Deadline: (.+)$/) ?? [])[1],
  );
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForTimeout(400);
}

// --- The alert about that receipt ---------------------------------------
if (alerts.length > 0) {
  const alertDays = (alerts[0].body.match(/(\d+)\s*days? left/) ?? [])[1];
  agree('days left, on screen and in the alert that was sent', hero.days, alertDays);
  agree('the amount, on the row and in the alert', firstRow.amount, money(alerts[0].body));
}

// --- Totals ---------------------------------------------------------------
const rowMoney = await page.evaluate(() =>
  [...document.querySelectorAll('li button')].map((b) => {
    const label = b.getAttribute('aria-label') ?? '';
    const parts = label.split(', ');
    return { amount: parts.at(-2) ?? '', returned: parts.at(-1) === 'returned', demo: label.includes('(sample)') };
  }),
);
const sum = (list) => list.reduce((a, r) => a + Number((r.amount || '£0').replace(/[£,]/g, '')), 0);
agree(
  'money still returnable, on the hero and summed from the rows',
  Number((money(hero.returnable) ?? '£0').replace(/[£,]/g, '')).toFixed(2),
  sum(rowMoney.filter((r) => !r.returned)).toFixed(2),
);
agree(
  'money kept back, on the hero and summed from the returned rows',
  Number((money(hero.keptBack) ?? '£0').replace(/[£,]/g, '')).toFixed(2),
  sum(rowMoney.filter((r) => r.returned)).toFixed(2),
);

/*
 * --- The free-tier meter versus what is actually tracked ------------------
 *
 * The rows the PERSON added. The demo set is on the screen and does not spend
 * the allowance, which is why those rows carry a SAMPLE chip: without it the
 * meter reading 0 beside five receipts looks like a bug rather than a
 * deliberate generosity, and this check would have nothing to read them by.
 *
 * Two real receipts are added first, because a fresh install is entirely demo
 * rows and "0 versus 0" is a pass whatever the meter renders — the same
 * vacuity that has caught this codebase four times. Two, not one, so a meter
 * that counted rows instead of the free-tier rule is off by five rather than
 * coincidentally right.
 */
for (const [item, paste] of [['Sony headphones', 'Currys · Sony headphones · Total £329.00 · 20 Aug 2026'], ['Kettle', 'Argos · Kettle · Total £29.00 · 21 Aug 2026']]) {
  await page.getByRole('button', { name: 'Add a receipt' }).click();
  await page.waitForTimeout(300);
  await page.fill('#paste', paste);
  await page.getByRole('button', { name: 'Read it' }).click();
  await page.waitForTimeout(400);
  await page.fill('#add-item', item);
  await page.getByRole('button', { name: /^Save/ }).click();
  await page.waitForTimeout(500);
}
await page.getByRole('button', { name: 'Receipts', exact: true }).click();
await page.waitForTimeout(400);
const rowsNow = await page.evaluate(() =>
  [...document.querySelectorAll('li button')].map((b) => {
    const label = b.getAttribute('aria-label') ?? '';
    return { returned: label.split(', ').at(-1) === 'returned', demo: label.includes('(sample)') };
  }),
);
const activeCount = rowsNow.filter((r) => !r.returned && !r.demo).length;
if (activeCount === 0 || rowsNow.every((r) => r.demo)) {
  disagreements.push({ what: 'the free-tier meter check had no receipt the person added to count', saw: [] });
}
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(400);
const meter = await page.evaluate(() => {
  // \d+, not a hard 10: pinning the number here means this check quietly
  // finds nothing the day the free tier changes size, and reports a pass.
  const el = [...document.querySelectorAll('span')].find((s) => /of \d+ free receipts/.test(s.textContent ?? ''));
  return el?.textContent?.trim() ?? '';
});
agree('receipts counted, by the meter and on the list', (meter.match(/^(\d+)/) ?? [])[1], String(activeCount));

/*
 * --- The pricing, on the page someone buys from and inside the product -----
 *
 * Everything above this line is inside /app/, which is where this suite has
 * always stopped — and the prices were literals in the landing page AND in
 * Settings AND in the add screen's upsell, with the free tier's size written
 * out as a bare "10" twice more in the marketing copy beside a
 * FREE_TIER_LIMIT the app actually enforced. Six statements of three facts,
 * nothing holding any of them together, and half of them on a page this file
 * had never opened.
 *
 * A price that says one thing where someone bought and another inside the
 * product is not a cosmetic drift.
 */
const inApp = await page.evaluate(() => {
  const tiers = [...document.querySelectorAll('button')]
    .map((b) => b.textContent ?? '')
    .filter((t) => /^£[\d.]+(monthly|yearly|lifetime)/.test(t.replace(/BEST VALUE/, '').trim()))
    .map((t) => t.replace(/BEST VALUE/, '').trim());
  const free = ([...document.querySelectorAll('span')]
    .map((s) => s.textContent ?? '')
    .find((t) => /of \d+ free receipts/.test(t)) ?? '').match(/of (\d+) free/)?.[1];
  return { prices: tiers.map((t) => (t.match(/£[\d.]+/) ?? [])[0]).filter(Boolean), free };
});

const landing = await ctx.newPage();
await landing.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
await landing.waitForTimeout(600);
const onPage = await landing.evaluate(() => {
  // Scoped to the pricing section, not the whole page. Reading every £ amount
  // in document.innerText picked up the £1.95 Zara postal fee quoted in the
  // policy-watch card — the same species of self-inflicted disagreement this
  // suite's first version reported three of.
  const pricing = document.querySelector('#pricing');
  const text = pricing?.textContent ?? '';
  return {
    prices: [...new Set(text.match(/£\d+\.\d{2}/g) ?? [])],
    free: (text.match(/first (\d+) receipts/) ?? [])[1],
    found: !!pricing,
  };
});
await landing.close();

// A selector that matched nothing would make both checks below pass over
// empty strings, which is the shape of a sweep that reports success for a
// question it never asked.
if (!onPage.found) disagreements.push({ what: 'the landing page has no #pricing section to read', saw: [] });
// Both sides going empty would "agree" on nothing at all. There are three
// tiers; anything else means a selector stopped matching, not that the prices
// match.
for (const [where, found] of [['Settings', inApp.prices], ['the pricing cards', onPage.prices]]) {
  if (found.length !== 3) disagreements.push({ what: `three prices were not found in ${where}`, saw: found });
}
agree('the free tier’s size, in the marketing copy and on the meter', onPage.free, inApp.free);
agree(
  'the prices, on the pricing cards and in Settings',
  [...inApp.prices].sort().join(' '),
  [...onPage.prices].sort().join(' '),
);

await browser.close();

if (disagreements.length === 0) {
  console.log('✓ every fact that appears twice says the same thing');
  process.exit(0);
}
console.log(`✗ ${disagreements.length} disagreement(s):\n`);
for (const d of disagreements) console.log(`  ${d.what}\n    saw: ${d.saw.map((v) => JSON.stringify(v)).join(' vs ')}\n`);
process.exit(1);
