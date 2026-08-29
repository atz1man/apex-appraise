/**
 * End-to-end smoke test, run against a built preview server.
 *
 *   npm run build && npx vite preview --port 5183 &
 *   CHROMIUM_PATH=/path/to/chrome node scripts/smoke.mjs
 *
 * It checks what unit tests cannot: that the swipe gesture actually returns a
 * receipt, that an edit reaches the screen and the disk, that a backup file
 * genuinely round-trips through export and restore, that state survives a
 * reload (the whole local-first promise), that the page contacts NO third
 * party, and that nothing throws on the way through.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.KEPT_ORIGIN ?? 'http://localhost:5183';
const EXEC = process.env.CHROMIUM_PATH;

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await browser.newContext({
  viewport: { width: 402, height: 874 },
  acceptDownloads: true,
  permissions: ['notifications'],
});
const page = await ctx.newPage();

// Record every notification the app tries to show, through both delivery
// paths, so alert behaviour can be asserted rather than taken on trust.
await page.addInitScript(() => {
  window.__notes = [];
  const record = (title, opts) => window.__notes.push({ title, body: opts?.body, tag: opts?.tag });
  class StubNotification {
    static permission = 'granted';
    static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, opts) { record(title, opts); }
  }
  window.Notification = StubNotification;
  navigator.serviceWorker?.ready.then((reg) => {
    const original = reg.showNotification?.bind(reg);
    reg.showNotification = (title, opts) => {
      record(title, opts);
      return original ? original(title, opts).catch(() => {}) : Promise.resolve();
    };
  }).catch(() => {});
});

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
await page.waitForTimeout(800);

// One alert for the receipt that is actually urgent, and only one — the
// gentler rung it passed on the way is recorded silently.
const opening = await page.evaluate(() => window.__notes);
const results = {
  'a due deadline raises exactly one alert': opening.length === 1 && opening[0].tag === 'seed_currys:soon',
};

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

results['swipe marks the receipt returned'] = await page.getByText('MONEY BACK').isVisible();

await page.getByRole('button', { name: 'Share the win' }).click();
await page.waitForTimeout(300);
results['share confirms'] = await page.getByRole('button', { name: /Copied/ }).isVisible();

// The tab bar floats over every screen; its buttons must stay clickable.
await page.getByRole('button', { name: 'Back to receipts' }).click();
await page.waitForTimeout(400);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
results['the return survives a reload'] = await page.getByText('MONEY BACK ✓').isVisible();
// The sent list is on disk, so a reload must not re-announce anything.
results['an alert is never repeated'] = (await page.evaluate(() => window.__notes)).length === 0;
// A returned receipt has to stay reachable: the swipe is a one-finger gesture
// on a row you might have meant to open, so it will fire by accident.
await page.getByRole('button', { name: /Currys, JBL.*returned/ }).click();
await page.waitForTimeout(400);
results['a returned receipt can still be opened'] =
  await page.getByText(/Money back · .* recovered/).isVisible();
await page.getByRole('button', { name: 'Not actually returned' }).click();
await page.waitForTimeout(400);
results['a return can be undone'] =
  (await page.getByRole('button', { name: 'Got my money back' }).isVisible()) &&
  (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('kept.v1')).receipts.find((r) => r.id === 'seed_currys').status)) === 'active';
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.waitForTimeout(300);

// Delete was the only action with no way out. It offers one now — and the
// undo has to put the receipt back, not merely hide the message.
const receiptCount = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.length);
const beforeDelete = await receiptCount();
await page.getByRole('button', { name: /Argos, Kenwood/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(400);
const afterDelete = await receiptCount();
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(400);
results['a deleted receipt can be undone'] =
  afterDelete === beforeDelete - 1 &&
  (await receiptCount()) === beforeDelete &&
  // By role, not by text: the undo bar names the receipt it deleted, so a
  // text match here could be satisfied by the message rather than the row —
  // the same trap that made the backup check pass for the wrong reason.
  (await page.getByRole('button', { name: /Argos, Kenwood/ }).isVisible());

results['onboarding is not shown again'] = !(await page
  .getByRole('button', { name: 'Skip' })
  .isVisible()
  .catch(() => false));
// An edit must reach the screen, and the disk.
await page.getByRole('button', { name: /Zara, Wool-blend/ }).click();
await page.waitForTimeout(300);
// Zara counts from dispatch. The detail screen and the edit screen must name
// the same date — they disagreed by two days, because the preview counted
// from the purchase date and the receipt counted from dispatch.
const detailDeadline = await page.evaluate(() => {
  const label = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'RETURN BY');
  return label?.nextElementSibling?.textContent?.trim() ?? null;
});
await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.waitForTimeout(300);
const editDeadline = (await page.locator('#e-window-hint').textContent()) ?? '';
results['both screens name the same deadline for a dispatch-clocked receipt'] =
  !!detailDeadline && editDeadline.includes(detailDeadline);
await page.fill('#e-item', '');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(300);
results['an invalid edit is refused, not saved'] =
  (await page.getByRole('alert').count()) > 0 &&
  (await page.getByRole('button', { name: 'Save changes' }).isVisible());

await page.fill('#e-item', 'Charcoal wool coat');
await page.fill('#e-amount', '39.50');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(400);
results['an edit reaches the receipt'] =
  (await page.getByText('Charcoal wool coat').first().isVisible()) &&
  (await page.getByText('£39.50').first().isVisible());

// Export, delete something, restore it back.
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(300);
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Export a backup' }).click(),
]);
const backupPath = join(tmpdir(), 'kept-smoke-backup.json');
await download.saveAs(backupPath);
results['the export is a kept backup'] = JSON.parse(readFileSync(backupPath, 'utf8')).app === 'kept';

await page.getByRole('button', { name: 'Receipts', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Boots, No7/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(400);
// Asserted against stored state, not text on screen: the undo bar names the
// receipt it just deleted, so "is this string visible" answers the wrong
// question — and answered it wrongly the moment that bar was added.
const holds = (item) =>
  page.evaluate(
    (needle) => JSON.parse(localStorage.getItem('kept.v1')).receipts.some((r) => r.item === needle),
    item,
  );
const deleted = !(await holds('No7 skincare set'));

await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(300);
await page.setInputFiles('input[type=file]', backupPath);
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Receipts', exact: true }).click();
await page.waitForTimeout(400);
results['a deleted receipt comes back from a backup'] =
  deleted &&
  (await holds('No7 skincare set')) &&
  (await page.getByRole('button', { name: /Boots, No7/ }).isVisible());

// A file that is not a backup must be refused without touching anything.
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(300);
const junkPath = join(tmpdir(), 'kept-smoke-junk.json');
writeFileSync(junkPath, '{"app":"not-kept"}');
await page.setInputFiles('input[type=file]', junkPath);
await page.waitForTimeout(500);
const refused = ((await page.getByRole('status').first().textContent()) ?? '').includes('not a kept backup');
await page.getByRole('button', { name: 'Receipts', exact: true }).click();
await page.waitForTimeout(300);
results['a file that is not a backup is refused, and nothing is lost'] =
  refused && (await holds('No7 skincare set'));

// An order email shared in from another app must land already read — the
// three-step strip on the Add screen promises exactly this.
const shareUrl =
  `${ORIGIN}/app/?title=${encodeURIComponent('Your Currys order')}` +
  `&text=${encodeURIComponent('Order placed 16 Aug 2026\nTotal £129.00')}`;
await page.goto(shareUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
results['a shared order lands on Add, already read'] =
  (await page.getByRole('heading', { name: 'Add a receipt' }).isVisible()) &&
  (await page.getByText('FOUND IN YOUR PASTE').isVisible());
// The payload must not linger in the address bar, or a reload re-adds it.
results['the shared payload is stripped from the URL'] = !/[?&]text=/.test(page.url());

// The policy feed must arrive from this app's own origin and replace the
// bundled copy rather than piling a second copy on top of it.
await page.getByRole('button', { name: /^Watch/ }).click();
await page.waitForTimeout(600);
const updateIds = await page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).updates.map((u) => u.id));
results['the policy feed arrives and does not duplicate the bundled one'] =
  updateIds.length === new Set(updateIds).size && updateIds.includes('u_uniqlo_online_refunds');
results['a policy change is checked against the receipts held'] =
  (await page.getByText('AFFECTS YOUR RECEIPTS').first().isVisible()) &&
  (await page.getByText(/deadline unchanged, already checked/).first().isVisible());

// The free tier is claimed on the pricing page, in Settings and on the Add
// screen. Fill it and the Save must actually refuse.
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('kept.v1'));
  const base = state.receipts[0];
  state.receipts = Array.from({ length: 10 }, (_, i) => ({ ...base, id: `q${i}`, item: `Item ${i}`, status: 'active' }));
  localStorage.setItem('kept.v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Add a receipt' }).click();
await page.waitForTimeout(300);
await page.fill('#paste', 'Your Apple order · Total £129.00 · 25 Aug');
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);
const cappedSave = page.getByRole('button', { name: /Go unlimited to save this/ });
const beforeBlocked = await page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.length);
await cappedSave.click({ force: true }).catch(() => {});
await page.waitForTimeout(300);
results['a full free tier actually refuses the save'] =
  (await cappedSave.isDisabled()) &&
  (await page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.length)) === beforeBlocked;

/*
 * The marketing page embeds this same build at this same origin, so the demo
 * was reading and writing the real app's storage — swipe a receipt in the shop
 * window and you had changed what the installed app shows. It must be able to
 * do anything and change nothing.
 */
const storedBefore = await page.evaluate(() => localStorage.getItem('kept.v1'));
const landing = await ctx.newPage();
await landing.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
await landing.waitForTimeout(1200);
// This context is phone-width, so the demo sits well below the fold. Without
// scrolling to it the drag below lands on empty page and the check measures
// nothing.
await landing.locator('iframe[title="kept — live app demo"]').scrollIntoViewIfNeeded();
await landing.waitForTimeout(600);
const demo = landing.frameLocator('iframe[title="kept — live app demo"]');
const demoRow = demo.getByRole('button', { name: /Currys, JBL/ });
const demoBox = await demoRow.boundingBox();
if (demoBox) {
  const y = demoBox.y + demoBox.height / 2;
  await landing.mouse.move(demoBox.x + demoBox.width - 30, y);
  await landing.mouse.down();
  for (let dx = 0; dx <= 110; dx += 22) {
    await landing.mouse.move(demoBox.x + demoBox.width - 30 - dx, y);
    await landing.waitForTimeout(30);
  }
  await landing.mouse.up();
  await landing.waitForTimeout(700);
}
results['the landing demo works'] = await demo.getByText('MONEY BACK').isVisible().catch(() => false);
results['the landing demo cannot touch the real app’s data'] =
  (await page.evaluate(() => localStorage.getItem('kept.v1'))) === storedBefore;
await landing.close();

results['nothing is fetched from a third party'] = foreign.size === 0;

// The manifest has to be installable-shaped, because "add it to your home
// screen" is how the share target and the offline promise are reached at all.
const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
results['the manifest is installable and declares the share target'] =
  !!manifest.name && !!manifest.start_url && manifest.display === 'standalone' &&
  Array.isArray(manifest.icons) && manifest.icons.some((i) => i.sizes === '512x512') &&
  manifest.share_target?.method === 'GET';

/*
 * Offline, for real. "Works offline" is the app's central claim — a deadline
 * you can check on the train, in the shop, with no signal — and it is the one
 * claim that cannot be verified by reading the code. The network is cut
 * completely, then the app has to launch, render receipts, load its
 * self-hosted fonts, and still navigate.
 */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await ctx.setOffline(true);
await page.goto(`${ORIGIN}/app/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(1200);
results['the app launches with the network cut'] =
  (await page.getByText('RETURN DEADLINES, WATCHED').isVisible().catch(() => false)) &&
  (await page.evaluate(() => document.fonts.check('700 16px "Space Grotesk"')));
// Whichever row happens to be first — earlier steps in this script rewrite
// the receipt list, so naming a specific shop here would be testing the
// fixture rather than the app.
await page.locator('li button').first().click().catch(() => {});
await page.waitForTimeout(600);
results['it is still usable offline, not just painted'] =
  await page.getByText('STORE POLICY').isVisible().catch(() => false);
await ctx.setOffline(false);

/*
 * A write that does not land. There is no server behind this app, so a failed
 * save means the receipts are gone at the next launch while the screen still
 * shows them — it used to happen in complete silence. Its own context, because
 * breaking storage would derail every check after it.
 */
{
  const fullCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const fullPage = await fullCtx.newPage();
  await fullPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await fullPage.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await fullPage.waitForTimeout(300);
  await fullPage.evaluate(() => {
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => {
      if (k === 'kept.v1') throw new DOMException('Quota', 'QuotaExceededError');
      return real(k, v);
    };
  });
  // Any change at all triggers a write.
  await fullPage.getByRole('button', { name: /Zara, Wool-blend/ }).click();
  await fullPage.waitForTimeout(300);
  await fullPage.getByRole('button', { name: 'Got my money back' }).click();
  await fullPage.waitForTimeout(500);
  await fullPage.getByRole('button', { name: 'Back to receipts' }).click();
  await fullPage.waitForTimeout(500);
  results['a failed save is not silent'] =
    await fullPage.getByText(/This device isn.t saving/).isVisible().catch(() => false);
  await fullCtx.close();
}

/*
 * Midnight, without a reload. Phones resume a PWA from the background rather
 * than reloading it, so a deadline tracker left open overnight must notice the
 * date turning over — it did not, and went on reporting yesterday's counts.
 * Its own page and context, because installing a clock rewrites timers.
 */
{
  const clockCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const clockPage = await clockCtx.newPage();
  await clockPage.clock.install({ time: new Date('2026-09-10T22:00:00Z') });
  await clockPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await clockPage.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await clockPage.waitForTimeout(400);
  const heroDays = () =>
    clockPage.evaluate(() => {
      const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'NEXT WINDOW TO CLOSE');
      const spans = [...(label?.closest('button')?.querySelectorAll('span') ?? [])];
      return spans.find((s) => /^\d+$|^Today$|^Gone$/.test(s.textContent.trim()))?.textContent.trim() ?? null;
    });
  const beforeMidnight = await heroDays();
  await clockPage.clock.fastForward('03:00:00');
  await clockPage.waitForTimeout(600);
  const afterMidnight = await heroDays();
  results['the day count follows the clock past midnight'] =
    beforeMidnight === '2' && afterMidnight === '1';
  await clockCtx.close();
}

/*
 * A single unreadable row on disk must not take the app down. It did: a
 * receipt with no purchase date produced a completely blank screen on every
 * launch, with no way out but clearing site data by hand.
 */
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('kept.v1'));
  s.receipts = [{ ...s.receipts[0], id: 'corrupt', purchasedOn: undefined }, ...s.receipts.slice(1)];
  localStorage.setItem('kept.v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
results['a corrupt stored receipt does not blank the app'] =
  (await page.getByText('RETURN DEADLINES, WATCHED').isVisible().catch(() => false)) &&
  (await page.evaluate(() => document.body.innerText.length)) > 100;

// Last, because it takes everything with it: erase must clear the disk, not
// just the screen, and must not resurrect the demo data on the next launch.
await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Erase everything' }).click();
await page.waitForTimeout(300);
const heldBeforeWipe = await receiptCount();
await page.getByRole('button', { name: 'Keep them' }).click();
await page.waitForTimeout(300);
results['the first tap only asks'] = (await receiptCount()) === heldBeforeWipe && heldBeforeWipe > 0;

await page.getByRole('button', { name: 'Erase everything' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Erase everything' }).click();
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
results['erasing clears the disk and does not reseed'] =
  (await receiptCount()) === 0 && (await page.getByText('Nothing tracked yet').isVisible());

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
