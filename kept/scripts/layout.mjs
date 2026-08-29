/**
 * Layout robustness: narrow screens, and data that is not tidy.
 *
 *   npm run build && npx vite preview --port 5183 &
 *   CHROMIUM_PATH=/path/to/chrome node scripts/layout.mjs
 *
 * Everything else in this repo is driven at 402px with the seeded demo data,
 * which is the width the design was drawn at and the content it was drawn
 * with. Real phones go down to 320px, and real receipts have long shop names,
 * long item names and amounts in the thousands. A page that scrolls sideways
 * on a phone is broken in a way no screenshot at design width will show.
 *
 * The empty and all-returned states are swept too: both exist in the code,
 * both are what a new user and a diligent user actually see, and neither
 * appears in the seeded data.
 */
import { chromium } from 'playwright';

const ORIGIN = process.env.KEPT_ORIGIN ?? 'http://localhost:5183';
const EXEC = process.env.CHROMIUM_PATH;
/** iPhone SE / small Android, and the design width. */
const WIDTHS = [320, 402];

const ADVERSARIAL = [
  {
    id: 'long', store: 'Marks and Spencer Outlet — Bournemouth Retail Park',
    item: 'Extra-long-staple Egyptian cotton oxford shirt, slim fit, 16.5" collar',
    cat: 'clothing', amount: 129999999, purchasedOn: null, windowDays: 35,
    policy: 'A policy sentence that runs on and on, the way a real retailer writes one, with clauses about condition, packaging, proof of purchase and exclusions that never seem to end.',
    // Bought online, so the legal card carries TWO chips beside its label
    // and a chevron — the row most likely to widen a 320px screen.
    distance: true, status: 'active',
    warranty: { months: 120, note: 'A guarantee note that is also considerably longer than anyone would expect it to be' },
    gotcha: 'A gotcha that is long enough to wrap onto several lines on the narrowest phone anyone still uses.',
  },
];

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const failures = [];
/**
 * How much scrolling the covered-button check actually had to work with. A
 * sweep over screens that all fit reports "no button is covered" without ever
 * putting one near the bar, which is a pass for a question it never asked —
 * exactly how the first version of that check behaved.
 */
let everScrolled = 0;

/** Anything wider than the viewport makes the page scroll sideways. */
/**
 * Every button has to be the thing you actually hit when you tap it.
 *
 * The handoff shipped a Celebrate screen whose "Back to receipts" sat
 * underneath the floating tab bar — fully visible, completely unclickable,
 * and invisible to every check here, because nothing overflows and nothing
 * fails contrast when a control is simply covered. Found by eye once; this is
 * the mechanical form of it, run at the BOTTOM of each screen, which is where
 * a floating bar and the last button in a scroller meet.
 */
/** Short enough that every screen here has something to scroll. */
const SHORT_HEIGHT = 560;

async function checkCovered(page, label, width) {
  // Deliberately shortened first. At the sweep's own 844 none of these screens
  // overflows, so the question was never being asked — the check reported a
  // clean pass over content that never met the bar. A phone with the keyboard
  // up is this short, and it is the state where a floating bar and the last
  // button in a scroller actually meet.
  await page.setViewportSize({ width, height: SHORT_HEIGHT });
  await page.waitForTimeout(250);
  const scrolled = await page
    .evaluate(() => {
      // The SCREEN's own container, not any scroller inside it. The Watch
      // feed is a fixed-height region that always has more content than it
      // shows, so a looser selector reported scrolling on every run and made
      // the vacuity guard below unfalsifiable.
      const scroller = document.querySelector('main > div[style*="overflow"]');
      if (!scroller) return 0;
      scroller.scrollTop = scroller.scrollHeight;
      return scroller.scrollHeight - scroller.clientHeight;
    })
    .catch(() => 0);
  await page.waitForTimeout(350);
  const covered = await page.evaluate(() => {
    // While a modal is open, everything behind it is SUPPOSED to be
    // untappable — that is what modal means — so the question narrows to the
    // sheet's own buttons. Without this the check reports the scrim covering
    // the tab bar as a defect, which would train a reader to ignore it.
    const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
    const root = modal ?? document;
    return [...root.querySelectorAll('button')]
      .filter((b) => !b.disabled)
      .map((b) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) return null;
        const hit = document.elementFromPoint(x, y);
        if (!hit || b.contains(hit) || hit.contains(b)) return null;
        return {
          text: (b.textContent ?? '').trim().slice(0, 30),
          covering: (hit.closest('button')?.textContent ?? hit.tagName).trim().slice(0, 30),
        };
      })
      .filter(Boolean);
  });
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(200);
  if (covered.length > 0) {
    failures.push({
      label,
      width,
      kind: 'a button cannot be tapped where it sits',
      detail: covered.map((c) => `"${c.text}" covered by "${c.covering}"`).join('; '),
    });
  }
  return scrolled;
}

async function checkOverflow(page, label, width) {
  const bad = await page.evaluate((w) => {
    const out = [];
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Right edge past the viewport, or left edge before it.
      if (r.right > w + 1 || r.left < -1) {
        const cs = getComputedStyle(el);
        // An element inside its own horizontal scroller is fine — that is the
        // documented escape hatch for wide content.
        let node = el.parentElement;
        let contained = false;
        while (node) {
          const p = getComputedStyle(node);
          if (p.overflowX === 'auto' || p.overflowX === 'scroll' || p.overflowX === 'hidden') { contained = true; break; }
          node = node.parentElement;
        }
        if (contained) continue;
        out.push({ tag: el.tagName.toLowerCase(), cls: cs.position, right: Math.round(r.right), left: Math.round(r.left), text: (el.textContent ?? '').trim().slice(0, 40) });
      }
    }
    return { docOverflow, offenders: out.slice(0, 4) };
  }, width);

  if (bad.docOverflow > 0) {
    failures.push({ label, width, kind: 'page scrolls sideways', detail: `${bad.docOverflow}px`, offenders: bad.offenders });
  }
}

async function sweep(width, seedState, label, steps) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => failures.push({ label, width, kind: 'pageerror', detail: e.message }));
  await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  if (seedState) {
    await page.evaluate(seedState);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await page.waitForTimeout(400);
  for (const [name, act] of steps) {
    await act(page).catch((e) => failures.push({ label, width, kind: 'step failed', detail: `${name}: ${e.message}` }));
    await page.waitForTimeout(400);
    await checkOverflow(page, `${label} · ${name}`, width);
    everScrolled += await checkCovered(page, `${label} · ${name}`, width);
  }
  await ctx.close();
}

const seedAdversarial = (rows) => `() => {
  const s = JSON.parse(localStorage.getItem('kept.v1') ?? '{}');
  const rows = ${JSON.stringify(rows)};
  const today = new Date();
  s.receipts = rows.map((r, i) => {
    const d = new Date(today); d.setDate(d.getDate() - 5);
    return { ...r, id: 'x' + i, purchasedOn: d.toISOString().slice(0, 10) };
  });
  s.onboardingSeen = true;
  localStorage.setItem('kept.v1', JSON.stringify(s));
}`;

const wipeTo = (status) => `() => {
  const s = JSON.parse(localStorage.getItem('kept.v1') ?? '{}');
  s.receipts = ${status === 'none' ? '[]' : `s.receipts.map(r => ({ ...r, status: 'returned' }))`};
  s.onboardingSeen = true;
  localStorage.setItem('kept.v1', JSON.stringify(s));
}`;

const screens = [
  ['home', async () => {}],
  ['detail', async (p) => { await p.locator('li button').first().click(); }],
  ['edit', async (p) => { await p.getByRole('button', { name: 'Edit', exact: true }).click(); }],
  ['back to home', async (p) => { await p.getByRole('button', { name: 'Cancel' }).click(); await p.getByRole('button', { name: 'Back', exact: true }).click(); }],
  ['watch', async (p) => { await p.getByRole('button', { name: /^Watch/ }).click(); }],
  ['add', async (p) => { await p.getByRole('button', { name: 'Add a receipt' }).click(); }],
  ['settings', async (p) => { await p.getByRole('button', { name: 'Settings', exact: true }).click(); }],
  // A modal, so it sizes itself rather than inheriting the page's padding —
  // the one surface here that can push a 320px viewport sideways on its own.
  ['settings · upgrade notice', async (p) => {
    await p.getByRole('button', { name: 'Settings', exact: true }).click();
    await p.waitForTimeout(250);
    await p.getByRole('button', { name: /£39\.99/ }).click({ timeout: 2000 }).catch(() => {});
  }],
];

for (const width of WIDTHS) {
  await sweep(width, null, 'seeded', screens);
  await sweep(width, seedAdversarial(ADVERSARIAL), 'long content', screens);
  await sweep(width, wipeTo('none'), 'no receipts', [['home', async () => {}], ['add', async (p) => { await p.getByRole('button', { name: 'Add a receipt' }).click(); }]]);
  await sweep(width, wipeTo('returned'), 'all returned', [['home', async () => {}]]);
}

// The landing page has to survive the same phone.
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  for (const y of [0, 1500, 3000, 4500, 6000]) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(200);
    await checkOverflow(page, `landing @${y}`, width);
  }
  await ctx.close();
}

await browser.close();

// Before the verdict, not after it: this guard was written below the success
// path's process.exit and was therefore unreachable — a vacuity check that
// could itself never run, which is the joke it exists to prevent.
if (everScrolled === 0) {
  failures.push({
    label: 'the covered-button check',
    width: 0,
    kind: 'never had a scrolling screen to examine',
    detail: 'every screen fitted at the short viewport, so "no button is covered" was a pass over nothing',
  });
}

if (failures.length === 0) {
  console.log(`✓ no sideways scroll, no covered buttons, at ${WIDTHS.join('px, ')}px, on any screen or state`);
  process.exit(0);
}
console.log(`✗ ${failures.length} layout problem(s):\n`);

for (const f of failures) {
  console.log(`  [${f.width}px] ${f.label} — ${f.kind}: ${f.detail}`);
  for (const o of f.offenders ?? []) console.log(`      <${o.tag}> left ${o.left} right ${o.right} — ${JSON.stringify(o.text)}`);
}
process.exit(1);
