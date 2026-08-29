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
    return { amount: parts.at(-2) ?? '', returned: parts.at(-1) === 'returned' };
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

// --- The free-tier meter versus what is actually tracked ------------------
const activeCount = rowMoney.filter((r) => !r.returned).length;
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(400);
const meter = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((s) => /of 10 free receipts/.test(s.textContent ?? ''));
  return el?.textContent?.trim() ?? '';
});
agree('receipts counted, by the meter and on the list', (meter.match(/^(\d+)/) ?? [])[1], String(activeCount));

await browser.close();

if (disagreements.length === 0) {
  console.log('✓ every fact that appears twice says the same thing');
  process.exit(0);
}
console.log(`✗ ${disagreements.length} disagreement(s):\n`);
for (const d of disagreements) console.log(`  ${d.what}\n    saw: ${d.saw.map((v) => JSON.stringify(v)).join(' vs ')}\n`);
process.exit(1);
