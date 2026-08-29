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
import { reportOnCrash, sayCrash } from './crash-report.mjs';
import { readFileSync } from 'node:fs';

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
reportOnCrash(report);
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
  return { prices: tiers.map((t) => (t.match(/£[\d.]+/) ?? [])[0]).filter(Boolean), free, text: document.body.innerText.toLowerCase() };
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
    text: document.body.innerText.toLowerCase(),
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
/*
 * The tagline, against the one module that owns it.
 *
 * It was three literals — the landing hero, the landing footer, the line
 * under Settings — so changing one left two others saying something else.
 * Compared by CONTAINMENT rather than equality, because Settings sets it in
 * the middle of a sentence and the hero sets it in caps on its own; the
 * shared thing is the words, not the frame around them.
 *
 * Read out of the source, not hardcoded here: pinning the current wording in
 * this file would just be a fourth copy, and a rename would then have to be
 * made in four places or this would fail for no reason.
 */
const TAGLINE = (readFileSync(new URL('../src/lib/brand.ts', import.meta.url), 'utf8')
  .match(/export const TAGLINE = '([^']+)'/) ?? [])[1];
if (!TAGLINE) {
  disagreements.push({ what: 'lib/brand.ts no longer exports a TAGLINE this check can read', saw: [] });
} else {
  for (const [where, text] of [['Settings', inApp.text], ['the landing page', onPage.text]]) {
    if (!text.includes(TAGLINE.toLowerCase())) {
      disagreements.push({ what: `${where} does not say the tagline lib/brand.ts owns`, saw: [TAGLINE, where] });
    }
  }
}
agree(
  'the prices, on the pricing cards and in Settings',
  [...inApp.prices].sort().join(' '),
  [...onPage.prices].sort().join(' '),
);

/*
 * --- The window a NEW purchase is given, when the feed has moved it -------
 *
 * The add screen takes a new receipt's window from the policy feed when the
 * feed carries a change the bundled table predates. That is what makes the
 * watch tab's promise true rather than decorative — and nothing exercised it.
 * No unit test reaches the screen, and no state the app can arrive at on its
 * own does either: every entry in the shipped feed sets `newWindowDays` to the
 * number already in `stores.ts`, deliberately, so the app as it ships has no
 * moved window to demonstrate. Take the feed back out of that line and every
 * check in this repository stays green.
 *
 * So the state is seeded rather than waited for, and what it has to produce is
 * stated here independently of what the app does with it. A seed compared
 * against a number the app derived from the same seed only agrees with itself,
 * which is the vacuity this codebase has now been caught by twice.
 */
/*
 * A shop the shipped feed does not mention, on purpose. The first version of
 * this check seeded Currys and reported that the change had not reached the
 * receipt — and the app was right: the shipped feed carries its own Currys
 * entry dated later than the seed, and a later change is the one in force.
 * Seeding a shop nobody else names leaves only the question being asked.
 */
const SHOP = 'Boots';
const SEEDED_WINDOW = 7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Relative to the day this runs, not written out. A fixed calendar date here
// is a check that starts failing for the wrong reason.
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const bought = daysAgo(5);
const boughtText = `${bought.getDate()} ${MONTHS[bought.getMonth()]} ${bought.getFullYear()}`;

await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.evaluate(({ shop, days, changedOn }) => {
  const state = JSON.parse(localStorage.getItem('kept.v1') ?? '{}');
  state.onboardingSeen = true;
  state.updates = [
    {
      id: 'u_agreement_seeded_window',
      store: shop,
      changedOn,
      text: `${shop} cut its return window to ${days} days.`,
      affectsStores: [shop],
      affectNote: 'new purchases get the shorter window',
      newWindowDays: days,
    },
    ...(state.updates ?? []),
  ];
  localStorage.setItem('kept.v1', JSON.stringify(state));
}, { shop: SHOP, days: SEEDED_WINDOW, changedOn: iso(daysAgo(60)) });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Add a receipt' }).click();
await page.waitForTimeout(300);
// A total and a date and no shop anywhere in it, because the hint below is on
// the branch the screen takes when the paste named nobody it knows.
await page.fill('#paste', `Your order · Total £329.00 · ${boughtText}`);
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);
await page.fill('#add-store', SHOP);
await page.waitForTimeout(300);

const window0 = await page.evaluate(() => {
  const wrap = document.querySelector('#add-store')?.parentElement;
  const hint = wrap ? ([...wrap.querySelectorAll('div')].map((d) => d.textContent ?? '').find((t) => /\d+ days/.test(t)) ?? '') : '';
  const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Return window');
  const row = label ? ([...label.parentElement.querySelectorAll('span')].at(-1)?.textContent ?? '') : '';
  return { hint, row, sawShop: !!wrap, sawRow: !!label };
});

if (!window0.sawShop || !window0.sawRow) {
  disagreements.push({
    what: 'the add screen never reached the state this check exists for — a typed shop and the window it would be given',
    saw: [window0.hint, window0.row],
  });
} else if (digits(window0.row) !== String(SEEDED_WINDOW)) {
  // Stated from the seed, not from the app: the check is that a change dated
  // before the purchase governs it. Reading the table's number here means the
  // feed did not reach the receipt, which is the whole feature.
  disagreements.push({
    what: `a policy change to ${SEEDED_WINDOW} days, dated before the purchase, did not reach the window a new ${SHOP} receipt is given`,
    saw: [window0.row],
  });
} else {
  agree(
    'the window a new receipt is given, in the shop hint and in the summary row below it',
    digits(window0.hint),
    digits(window0.row),
  );
}

await browser.close();

function report(crash) {
  if (!crash && disagreements.length === 0) {
    console.log('✓ every fact that appears twice says the same thing');
    process.exit(0);
  }
  if (disagreements.length > 0) {
    console.log(`✗ ${disagreements.length} disagreement(s):\n`);
    for (const d of disagreements) console.log(`  ${d.what}\n    saw: ${d.saw.map((v) => JSON.stringify(v)).join(' vs ')}\n`);
  }
  if (crash) sayCrash(crash);
  process.exit(1);
}
report();
