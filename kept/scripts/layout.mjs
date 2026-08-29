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
let everNamed = 0;

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

/**
 * A name squeezed to nothing.
 *
 * Nothing above catches this: a flex sibling that eats a row's primary label
 * neither overflows the page nor covers a button, so every sweep stays green
 * while the store column reads "Cu…" and "Z…" — two characters of the one word
 * that says whose return it is. Measured after adding a second chip beside the
 * store name; the design was reverted, and this is what would have said so.
 *
 * The rule is deliberately loose: either the name fits, or it gets a readable
 * share of itself. A long shop name truncating on a 320px phone is fine and
 * intended; being cut to a couple of glyphs by something beside it is not.
 */
const MIN_NAME_PX = 64;

async function checkNames(page, label, width) {
  const names = await page.evaluate((min) =>
    [...document.querySelectorAll('li button [data-name]')]
      .map((el) => ({
        text: (el.textContent ?? '').trim().slice(0, 24),
        shown: el.clientWidth,
        natural: el.scrollWidth,
        crushed: el.scrollWidth > el.clientWidth + 1 && el.clientWidth < min,
      })), MIN_NAME_PX);
  const crushed = names.filter((n) => n.crushed);
  if (crushed.length > 0) {
    failures.push({
      label,
      width,
      kind: 'a row’s name is squeezed past reading',
      detail: crushed.map((c) => `"${c.text}" given ${c.shown}px of ${c.natural}px`).join('; '),
    });
  }
  return names.length;
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

async function sweep(width, seedState, label, steps, { blockFonts = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  /*
   * The state a cold cache paints.
   *
   * The typefaces are self-hosted precisely so the app renders with no
   * signal — which makes the FALLBACK a real state this app ships in, and
   * nothing had ever looked at it. It is wider than Space Grotesk, so it is
   * the state where a row's chips stop fitting beside its shop name and where
   * a hero wraps a line it did not before.
   */
  if (blockFonts) await ctx.route('**/fonts/*.woff2', (r) => r.abort());
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
    everNamed += await checkNames(page, `${label} · ${name}`, width);
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
  await sweep(width, null, 'webfont blocked', screens, { blockFonts: true });
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

/*
 * And the same phone with the text turned up.
 *
 * A browser's minimum-font-size setting is a floor, not a preference: it
 * raises every px size below it, and this app's smallest type is the 10px on
 * the tab bar. At 18px those labels take the bar from 280px to 370px — wider
 * than a 320px screen — and the bar is centred with translateX(-50%), so it
 * left the screen at BOTH ends: the R of "Receipts" cut off at one edge and
 * "Settings" at the other, on the app's only navigation.
 *
 * Every check above was blind to it. The shell is `overflow: hidden`, so the
 * document reported no sideways scroll; nothing overflowed a row; no text
 * failed contrast. It needs its own browser because the setting is a launch
 * flag, not something a context can be given.
 */
const bigTextFailures = [];
{
  const big = await chromium.launch({
    ...(EXEC ? { executablePath: EXEC } : {}),
    // 20, not 18, and the number is the point. Measured on a 320px screen:
    // 16px gives a 288px bar, 18px a 310px bar — both still on the screen —
    // and 20px a 333px one, which is not. Below 20 the narrow-width padding
    // alone is enough, so a sweep at 18 would pass with the cap deleted and
    // pin nothing.
    args: ['--blink-settings=minimumFontSize=20,minimumLogicalFontSize=20'],
  });
  let smallestLabel = 0;
  for (const width of WIDTHS) {
    const ctx = await big.newContext({ viewport: { width, height: 780 } });
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Skip' }).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
    for (const [name, go] of [['home', null], ['watch', /^Watch/], ['settings', 'Settings'], ['add', 'Add a receipt']]) {
      if (go) {
        await page.getByRole('button', { name: go, exact: typeof go === 'string' }).click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(350);
      }
      const seen = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Main"]');
        if (!nav) return null;
        const w = document.documentElement.clientWidth;
        const b = nav.getBoundingClientRect();
        const labels = [...nav.querySelectorAll('button')].map((btn) => {
          const span = btn.querySelector('span:not([aria-hidden])');
          const r = (span ?? btn).getBoundingClientRect();
          return {
            name: (btn.textContent ?? '').trim() || btn.getAttribute('aria-label') || '?',
            fontSize: span ? parseFloat(getComputedStyle(span).fontSize) : 0,
            left: Math.round(r.left),
            right: Math.round(r.right),
            // How much of the word survives the ellipsis. A ratio rather than
            // a pixel floor, so it means the same thing at any text size.
            shown: span && span.scrollWidth > 0 ? span.clientWidth / span.scrollWidth : 1,
          };
        });
        return { w, left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), labels };
      });
      if (!seen) {
        bigTextFailures.push({ label: `${name} with the text turned up`, width, kind: 'no tab bar', detail: 'nav[aria-label="Main"] was not on the page, so nothing was measured' });
        continue;
      }
      for (const l of seen.labels) if (l.fontSize > smallestLabel) smallestLabel = l.fontSize;
      /*
       * Trimmed is allowed; erased is not.
       *
       * Capping the bar makes the shrink land on the labels, and at the bar's
       * ordinary padding it landed hard enough to leave "Rec…", "W…" and
       * "Set…" — three tabs identifiable only by their icons. The narrow-width
       * padding buys back about 20px a tab. Measured at 320px with the text
       * at 20px: 87, 87 and 88 per cent of the three words with it, and 61,
       * 60 and 60 without. The floor sits at three quarters because that is
       * between the two, and because a threshold picked from one side only is
       * a threshold nobody has shown can fail.
       */
      for (const l of seen.labels) {
        if (l.shown < 0.75) {
          bigTextFailures.push({
            label: `${name} with the text turned up`,
            width,
            kind: 'a tab label is trimmed past reading',
            detail: `"${l.name}" shows ${Math.round(l.shown * 100)}% of its word`,
          });
        }
      }
      if (seen.left < -0.5 || seen.right > seen.w + 0.5) {
        bigTextFailures.push({
          label: `${name} with the text turned up`,
          width,
          kind: 'the tab bar is off the screen',
          detail: `the bar is ${seen.width}px wide and runs from ${seen.left} to ${seen.right} on a ${seen.w}px screen`,
          offenders: seen.labels.filter((l) => l.left < -0.5 || l.right > seen.w + 0.5).map((l) => ({ tag: 'tab', left: l.left, right: l.right, text: l.name })),
        });
      }
    }
    await ctx.close();
  }
  // A pass here means nothing if the setting never applied — the labels are
  // 10px by design, so anything at or below that is the ordinary render and
  // this whole section measured the state it was written to escape.
  if (smallestLabel <= 10) {
    bigTextFailures.push({
      label: 'the large-text check',
      width: 0,
      kind: 'the minimum-font-size setting never took effect',
      detail: `the biggest tab label computed to ${smallestLabel}px, so the bar was measured at its ordinary size`,
    });
  }
  await big.close();
}
failures.push(...bigTextFailures);

await browser.close();

// Before the verdict, not after it: this guard was written below the success
// path's process.exit and was therefore unreachable — a vacuity check that
// could itself never run, which is the joke it exists to prevent.
if (everNamed === 0) {
  failures.push({
    label: 'the crushed-name check',
    width: 0,
    kind: 'never found a row name to measure',
    detail: 'no [data-name] element was on any screen, so "no name is squeezed" was a pass over nothing',
  });
}

if (everScrolled === 0) {
  failures.push({
    label: 'the covered-button check',
    width: 0,
    kind: 'never had a scrolling screen to examine',
    detail: 'every screen fitted at the short viewport, so "no button is covered" was a pass over nothing',
  });
}

if (failures.length === 0) {
  console.log(`✓ no sideways scroll, no covered buttons, no crushed names, no tab bar off the screen with the text turned up, at ${WIDTHS.join('px, ')}px, on any screen or state`);
  process.exit(0);
}
console.log(`✗ ${failures.length} layout problem(s):\n`);

for (const f of failures) {
  console.log(`  [${f.width}px] ${f.label} — ${f.kind}: ${f.detail}`);
  for (const o of f.offenders ?? []) console.log(`      <${o.tag}> left ${o.left} right ${o.right} — ${JSON.stringify(o.text)}`);
}
process.exit(1);
