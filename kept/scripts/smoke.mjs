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
results['onboarding is not shown again'] = !(await page
  .getByRole('button', { name: 'Skip' })
  .isVisible()
  .catch(() => false));
// An edit must reach the screen, and the disk.
await page.getByRole('button', { name: /Zara, Wool-blend/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.waitForTimeout(300);
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
const deleted = !(await page.getByText('No7 skincare set').first().isVisible().catch(() => false));

await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(300);
await page.setInputFiles('input[type=file]', backupPath);
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Receipts', exact: true }).click();
await page.waitForTimeout(400);
results['a deleted receipt comes back from a backup'] =
  deleted && (await page.getByText('No7 skincare set').first().isVisible());

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
  refused && (await page.getByText('No7 skincare set').first().isVisible());

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
