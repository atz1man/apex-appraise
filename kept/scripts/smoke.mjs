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

/**
 * "Nobody else" is a promise on the privacy card, so every request this suite
 * can see is checked against it.
 *
 * Watched at the CONTEXT rather than the page, because it was on the page and
 * the page is only the app. The landing page opens as a second page in this
 * same context, and the landing page is where a Google Fonts <link> would
 * plausibly come back — measured: one added there was loaded by the browser
 * and the check still reported a clean pass. Every context this script opens
 * is watched now, and the verdict is read at the very end so a request made on
 * the last screen counts the same as one made on the first.
 */
const watchOrigins = (context) => {
  // Page-initiated requests only, which is the right scope: Chromium itself
  // dials accounts.google.com and its own component updater on startup, and
  // that is the harness, not the app. Checked rather than assumed — opening
  // this page records no non-origin request at all, and about:blank in the
  // same browser records the same nothing.

  context.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== ORIGIN && u.protocol !== 'data:' && u.protocol !== 'blob:') foreign.add(u.origin);
  });
};
watchOrigins(ctx);

page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});

await page.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// A fresh install interrupts nobody. The demo set looks urgent — the home
// screen leads with "2 days left" — and a notification is not a
// demonstration: on a lock screen it is indistinguishable from a real one,
// and it carries £89 nobody spent.
const opening = await page.evaluate(() => window.__notes);
const results = {
  'a fresh install does not ping you about the sample receipts': opening.length === 0,
};

await page.getByRole('button', { name: 'Skip' }).click();
await page.waitForTimeout(300);

/*
 * And one alert for a receipt the person actually added — only one, because
 * the gentler rung it passed on the way is recorded silently.
 *
 * Its own context: the alert fires on load, so it needs a launch with the
 * receipt already on disk, and this page's own state is about to be swiped
 * and edited by everything below.
 */
{
  const alertCtx = await browser.newContext({ viewport: { width: 402, height: 874 }, permissions: ['notifications'] });
  watchOrigins(alertCtx);
  const alertPage = await alertCtx.newPage();
  // Both delivery paths, like the main harness above: with a worker
  // registered, deliver() goes through registration.showNotification and the
  // constructor is only the fallback — a stub for one of them records nothing
  // and reads as "no alert was raised".
  await alertPage.addInitScript(() => {
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
  await alertPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await alertPage.waitForTimeout(500);
  await alertPage.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kept.v1'));
    const { demo, ...urgent } = s.receipts.find((r) => r.id === 'seed_currys');
    s.receipts = [...s.receipts, { ...urgent, id: 'mine_urgent', item: 'My own headphones' }];
    s.onboardingSeen = true;
    localStorage.setItem('kept.v1', JSON.stringify(s));
  });
  await alertPage.reload({ waitUntil: 'networkidle' });
  await alertPage.waitForTimeout(900);
  const raised = await alertPage.evaluate(() => window.__notes);
  results['a due deadline on your own receipt raises exactly one alert'] =
    raised.length === 1 && raised[0].tag === 'mine_urgent:soon';
  await alertCtx.close();
}

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

/*
 * Sharing the win, both ways it can go.
 *
 * This check used to be `is the button now saying "Copied"` — which passed
 * because the button said that whether or not the copy happened. The clipboard
 * write fails on an insecure origin (every deployment of this over plain HTTP)
 * and wherever the permission is refused, and the person found out by pasting
 * nothing into a message to a friend.
 *
 * Its own contexts, because the only way to test what the screen says about
 * the clipboard is to control the clipboard.
 */
for (const [label, refuse] of [['confirms a copy that happened', false], ['does not claim one that did not', true]]) {
  const shareCtx = await browser.newContext({
    viewport: { width: 402, height: 874 },
    permissions: refuse ? [] : ['clipboard-write'],
  });
  watchOrigins(shareCtx);
  const sharePage = await shareCtx.newPage();
  if (refuse) {
    await sharePage.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('insecure origin')) },
        configurable: true,
      });
    });
  }
  await sharePage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await sharePage.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await sharePage.waitForTimeout(300);
  await sharePage.getByRole('button', { name: /Currys, JBL/ }).click();
  await sharePage.waitForTimeout(300);
  await sharePage.getByRole('button', { name: 'Got my money back' }).click();
  await sharePage.waitForTimeout(700);
  await sharePage.getByRole('button', { name: 'Share the win' }).click();
  await sharePage.waitForTimeout(600);
  const said = await sharePage.locator('main').innerText();
  const claimsCopied = /Copied — paste it anywhere/.test(said);
  const showsTheLine = said.includes('Just got £89.00 back from Currys');
  results[`sharing ${label}`] = refuse ? !claimsCopied && showsTheLine : claimsCopied && !showsTheLine;
  /*
   * And what the card and the line actually claim.
   *
   * Both were unconditional. The card said "Recovered from Currys before the
   * window closed" on a receipt whose window had closed — the button is
   * offered on any active receipt — and the shareable line said "kept.
   * reminded me before the window shut" whether or not kept had said anything
   * at all, which is a claim about the product for the person to send to
   * their friends. Nothing has alerted about this receipt in this context: it
   * is a sample, and samples do not interrupt.
   */
  if (refuse) {
    results['the win does not claim a reminder that was never sent'] =
      !/reminded me before the window shut/.test(said) &&
      /keeps every return deadline in one place/.test(said) &&
      said.includes('Recovered from Currys before the window closed');
  }
  await shareCtx.close();
}

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
// And says WHEN. The date has been stored since this screen was written and
// never shown: "£89.00 recovered ✓" reads the same whether the refund landed
// last week or last year.
results['a returned receipt says when the money came back'] = await page
  .getByText(new RegExp(`recovered on ${new Date().toLocaleDateString('en-GB', { day: 'numeric' })} `))
  .isVisible()
  .catch(() => false);
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
/*
 * The year-long window, read as a screen rather than as source.
 *
 * IKEA's 365 days put the deadline on the same day and month as the purchase,
 * and deciding the year per date rendered "RETURN BY 15 Feb 2027" six lines
 * above "bought 15 Feb" — the same string twice, a year apart, on the screen
 * whose whole job is dates. So: the two dates the detail screen shows together
 * must not read as the same day, and the pair carries the year or neither does.
 */
await page.getByRole('button', { name: /IKEA, MALM/ }).click();
await page.waitForTimeout(300);
const ikea = await page.evaluate(() => {
  const label = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'RETURN BY');
  const deadline = label?.nextElementSibling?.textContent?.trim() ?? null;
  const bought = document.body.innerText.match(/bought ([^\n·]+)/)?.[1]?.trim() ?? null;
  return { deadline, bought };
});
const hasYear = (t) => /\b(19|20)\d{2}\b/.test(t);
results['a year-long window does not print the same date twice'] =
  !!ikea.deadline && !!ikea.bought && ikea.deadline !== ikea.bought &&
  hasYear(ikea.deadline) === hasYear(ikea.bought);
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.waitForTimeout(300);

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

/*
 * And a restore must not undo what happened since the file was written. The
 * backup above was taken while every receipt was active; take one back, then
 * restore that same file. Without the details/state split in mergeBackup the
 * refund silently reverts — the receipt returns to "Go now or lose it", its
 * refund date disappears, and the app starts telling someone to return
 * something they already returned.
 */
await page.getByRole('button', { name: /Currys, JBL/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Got my money back' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Back to receipts' }).click().catch(() => {});
await page.waitForTimeout(400);
const refunded = (item) =>
  page.evaluate((needle) => {
    const r = JSON.parse(localStorage.getItem('kept.v1')).receipts.find((x) => x.item === needle);
    return r ? { status: r.status, returnedOn: r.returnedOn ?? null } : null;
  }, item);
const afterReturning = await refunded('JBL Tune 770NC headphones');

await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(300);
await page.setInputFiles('input[type=file]', backupPath);
await page.waitForTimeout(600);
const afterRestoring = await refunded('JBL Tune 770NC headphones');
results['restoring an older backup does not undo a refund taken since'] =
  afterReturning?.status === 'returned' &&
  afterRestoring?.status === 'returned' &&
  afterRestoring.returnedOn === afterReturning.returnedOn;

await page.getByRole('button', { name: 'Receipts', exact: true }).click();
await page.waitForTimeout(300);

// A file that is not a backup must be refused without touching anything.
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(300);
const junkPath = join(tmpdir(), 'kept-smoke-junk.json');
writeFileSync(junkPath, '{"app":"not-kept"}');
await page.setInputFiles('input[type=file]', junkPath);
await page.waitForTimeout(500);
// Every live region, not `.first()`. The question is whether the person is
// TOLD, and the app grew a second status region — the one that announces a
// screen change — which is earlier in the DOM and made this read the wrong
// element the day it was added.
const spoken = await page.getByRole('status').allTextContents();
const refused = spoken.some((t) => (t ?? '').includes('not a kept backup'));
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
// Both halves, because the reassurance alone is what this check used to
// accept: Zara's fee change left the window at 30 days, so the card said
// "deadline unchanged" and stopped — dropping the one sentence in the update
// worth acting on, which is the £1.95 the change is actually about.
/*
 * And the switch that claims to control that download has to control it.
 *
 * It was a stored boolean nothing read: the row said "Policy watch · Every
 * launch · on", turning it off changed the word to "Off", and the feed
 * downloaded on every launch regardless. Counted at the network, in its own
 * context, because this is the app's only outbound request and the claim is
 * about whether it happens at all.
 */
{
  const watchCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(watchCtx);
  const watchPage = await watchCtx.newPage();
  let feedHits = 0;
  watchPage.on('request', (r) => {
    if (new URL(r.url()).pathname === '/policy-feed.json') feedHits += 1;
  });
  await watchPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await watchPage.waitForTimeout(900);
  const hitsWhileOn = feedHits;
  await watchPage.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kept.v1'));
    s.settings.policyWatch = false;
    s.onboardingSeen = true;
    localStorage.setItem('kept.v1', JSON.stringify(s));
  });
  feedHits = 0;
  await watchPage.reload({ waitUntil: 'networkidle' });
  await watchPage.waitForTimeout(1200);
  results['switching policy watch off actually stops the download'] = hitsWhileOn > 0 && feedHits === 0;
  // And the Watch tab stops claiming it. "Fetched each time you open the app"
  // was printed whether or not the switch was on — a sentence that became
  // false the moment the switch started actually stopping the fetch.
  await watchPage.getByRole('button', { name: /^Watch/ }).click();
  await watchPage.waitForTimeout(600);
  const saidWhileOff = await watchPage.locator('main').innerText();
  await watchPage.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kept.v1'));
    s.settings.policyWatch = true;
    localStorage.setItem('kept.v1', JSON.stringify(s));
  });
  await watchPage.reload({ waitUntil: 'networkidle' });
  await watchPage.waitForTimeout(600);
  await watchPage.getByRole('button', { name: /^Watch/ }).click();
  await watchPage.waitForTimeout(600);
  const saidWhileOn = await watchPage.locator('main').innerText();
  results['the watch tab does not claim a fetch that is switched off'] =
    /Policy watch is off/.test(saidWhileOff) &&
    !/fetched each time you open the app/.test(saidWhileOff) &&
    /fetched each time you open the app/.test(saidWhileOn);
  await watchCtx.close();
}

results['a policy change is checked against the receipts held'] =
  (await page.getByText('AFFECTS YOUR RECEIPTS').first().isVisible()) &&
  (await page.getByText(/deadline unchanged/).first().isVisible()) &&
  (await page.getByText(/drop off in store to keep it free/).first().isVisible());

/*
 * The parser names no shop rather than guessing one — "walking boots" is not a
 * Boots order — so the add screen has to let someone say which shop it was,
 * and naming one Kept knows has to bring that shop's REAL window with it.
 * Asserted against what lands in storage, not against the preview: the preview
 * agreeing with itself is what the agreement suite is for.
 */
await page.getByRole('button', { name: 'Add a receipt' }).click();
await page.waitForTimeout(300);
await page.fill('#paste', 'Your Vinted order · walking boots · Total £40.00 · 20 Aug 2026');
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);
results['an unrecognised shop is asked for rather than guessed'] =
  (await page.locator('#add-store').count()) === 1 &&
  (await page.getByText('Not recognised').isVisible());
await page.fill('#add-store', 'Boots');
await page.waitForTimeout(300);
/*
 * The arrival date decides where both statutory clocks start, and this screen
 * had no rule for it: the browser marked the field invalid for a date before
 * the order and the app saved it anyway — 19 days early in the case that found
 * it, which reports a live right as expired. The edit screen validated it; the
 * add screen did not.
 */
await page.fill('#add-arrived', '2001-01-01');
await page.waitForTimeout(300);
const heldBeforeBadDate = await page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.length);
const badDateSave = page.getByRole('button', { name: /Fix the arrival date/ });
await badDateSave.click({ force: true }).catch(() => {});
await page.waitForTimeout(400);
results['an arrival before the purchase is refused, not saved'] =
  (await badDateSave.isDisabled().catch(() => false)) &&
  (await page.getByText('It cannot have arrived before you ordered it').isVisible().catch(() => false)) &&
  (await page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.length)) === heldBeforeBadDate;
await page.fill('#add-arrived', '');
await page.waitForTimeout(300);

await page.getByRole('button', { name: /^Save/ }).click();
await page.waitForTimeout(600);
const named = await page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.at(-1));
results['naming a shop by hand brings its verified window'] =
  named.store === 'Boots' && named.windowDays === 35 && named.policy.startsWith('Boots ·');

/*
 * The delivery date, read out of the paste rather than out of the person.
 *
 * Both statutory clocks run from delivery, this screen asks for that date in
 * so many words, and the order email being pasted says it three lines above
 * the total — so it was asking someone to copy it across by hand. Checked as
 * far as the saved receipt, not just the field: a pre-fill that never reaches
 * disk is a decoration.
 */
await page.getByRole('button', { name: 'Add a receipt' }).click();
await page.waitForTimeout(300);
await page.fill('#paste', 'John Lewis · Order placed 24 August 2026 · Sony headphones · Order total: £329.00 · Delivered 27 August 2026');
await page.getByRole('button', { name: 'Read it' }).click();
await page.waitForTimeout(400);
const prefilled = await page.inputValue('#add-arrived').catch(() => '');
await page.getByRole('button', { name: /^Save/ }).click();
await page.waitForTimeout(600);
const delivered = await page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.at(-1));
results['a delivery date in the paste is read, not asked for'] =
  prefilled === '2026-08-27' && delivered.arrivedOn === '2026-08-27' && delivered.purchasedOn === '2026-08-24';

/*
 * The last day, which is the day the ring matters most and drew nothing.
 *
 * `daysLeft` is 0 on the last day a thing can go back, and the arc was
 * `daysLeft / windowDays` — so the screen read "0 days left · RETURN BY 29
 * Aug" beside an empty grey track, with no red anywhere on it. Counted
 * inclusive of today now, and the number is coloured like the count on the
 * home hero, which had always done this.
 */
{
  const lastCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(lastCtx);
  const lastPage = await lastCtx.newPage();
  await lastPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await lastPage.waitForTimeout(400);
  await lastPage.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kept.v1'));
    const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    s.receipts = [
      { id: 'lastday', store: 'ASOS', item: 'Running shoes', cat: 'clothing', amount: 6500,
        purchasedOn: ago(28), windowDays: 28, policy: 'ASOS · 28 days', distance: false, status: 'active' },
      { id: 'gonelong', store: 'Argos', item: 'Toaster', cat: 'kitchen', amount: 2999,
        purchasedOn: ago(400), windowDays: 30, policy: 'Argos · 30 days', distance: false, status: 'active' },
    ];
    s.onboardingSeen = true;
    localStorage.setItem('kept.v1', JSON.stringify(s));
  });
  await lastPage.reload({ waitUntil: 'networkidle' });
  await lastPage.waitForTimeout(700);
  const ring = async (name) => {
    await lastPage.getByRole('button', { name }).click();
    await lastPage.waitForTimeout(400);
    const seen = await lastPage.evaluate(() => {
      const arc = document.querySelectorAll('svg circle')[1];
      const num = [...document.querySelectorAll('div')].find((d) => /^(\d+|closed)$/.test(d.textContent?.trim() ?? ''));
      return {
        drawn: Number(arc.getAttribute('stroke-dasharray')) - Number(arc.getAttribute('stroke-dashoffset')),
        stroke: arc.getAttribute('stroke'),
        numberColour: num ? getComputedStyle(num).color : null,
      };
    });
    await lastPage.getByRole('button', { name: 'Back', exact: true }).click();
    await lastPage.waitForTimeout(300);
    return seen;
  };
  const lastDay = await ring(/ASOS, Running shoes/);
  const longGone = await ring(/Argos, Toaster/);
  results['the ring still shows something on the last day'] =
    lastDay.drawn > 1 && lastDay.numberColour === 'rgb(255, 154, 118)' &&
    // And nothing once the window has actually gone, rather than sweeping backwards.
    longGone.drawn <= 0;
  await lastCtx.close();
}

/*
 * Everything returned — and the two claims that state makes.
 *
 * "Every return made it back in time" was printed unconditionally, and a
 * return can be made after the shop's window shuts, by goodwill or the
 * faulty-goods route. Same fault as the celebrate card: a claim about timing
 * that nothing checked. And the money-back rows are hand-built rather than a
 * ReceiptRow, so the "sample ·" marker added to the list never reached them —
 * a demo receipt stopped saying what it was the moment it was ticked off, on
 * the list where "which of these were mine" is the question.
 */
{
  const doneCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(doneCtx);
  const donePage = await doneCtx.newPage();
  await donePage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await donePage.waitForTimeout(400);
  const markAll = (late) => `() => {
    const s = JSON.parse(localStorage.getItem('kept.v1'));
    const d = new Date();
    d.setDate(d.getDate() + (${late} ? 400 : 0));
    s.receipts = s.receipts.map((r) => ({ ...r, status: 'returned', returnedOn: d.toISOString().slice(0, 10) }));
    s.onboardingSeen = true;
    localStorage.setItem('kept.v1', JSON.stringify(s));
  }`;
  await donePage.evaluate(eval(markAll(false)));
  await donePage.reload({ waitUntil: 'networkidle' });
  await donePage.waitForTimeout(700);
  const inTime = await donePage.locator('main').innerText();
  await donePage.evaluate(eval(markAll(true)));
  await donePage.reload({ waitUntil: 'networkidle' });
  await donePage.waitForTimeout(700);
  const late = await donePage.locator('main').innerText();
  results['"every return made it back in time" is only said when it did'] =
    /Every return made it back in time/.test(inTime) &&
    !/Every return made it back in time/.test(late) &&
    // The money is true either way.
    /recovered — not bad/.test(late);
  results['a sample receipt still says so once it is returned'] = /sample · JBL Tune 770NC/.test(inTime);
  await doneCtx.close();
}

/*
 * A library with a backlog: the hero must not contradict itself.
 *
 * `bucket` keeps an expired-but-unreturned receipt at the top, deliberately —
 * the money may still be recoverable and demoting it would hide the row a
 * person most needs to see. So on any list with one, the hero shows it. Its
 * headline said "Gone — the window closed on your Towels" while the label
 * above said NEXT WINDOW TO CLOSE and the line below said "£193.25 back if it
 * goes back by 21 Mar", a date five months past. Three statements, one card,
 * two of them false.
 */
{
  const backlogCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(backlogCtx);
  const backlogPage = await backlogCtx.newPage();
  await backlogPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await backlogPage.waitForTimeout(400);
  await backlogPage.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kept.v1'));
    const old = new Date();
    old.setDate(old.getDate() - 200);
    s.receipts = [
      { id: 'gone', store: 'M&S', item: 'Towels', cat: 'other', amount: 19325,
        purchasedOn: old.toISOString().slice(0, 10), windowDays: 35, policy: 'M&S · 35 days',
        distance: false, status: 'active' },
      ...s.receipts,
    ];
    s.onboardingSeen = true;
    localStorage.setItem('kept.v1', JSON.stringify(s));
  });
  await backlogPage.reload({ waitUntil: 'networkidle' });
  await backlogPage.waitForTimeout(700);
  const shown = await backlogPage.locator('main').innerText();
  results['an expired receipt is not sold as a window still to close'] =
    /the window closed on your Towels/.test(shown) &&
    /WINDOW ALREADY CLOSED/.test(shown) &&
    !/NEXT WINDOW TO CLOSE/.test(shown) &&
    // And no promise of money back by a date five months gone.
    !/£193\.25 back if it goes back/.test(shown) &&
    // Nor filed under the one thing that cannot be done about it.
    /WINDOW CLOSED · CHECK YOUR RIGHTS/.test(shown);

  /*
   * And the third statement on the same card: its footer.
   *
   * "£X still returnable" summed every ACTIVE receipt, and the expired one is
   * active on purpose — so the card that had just said WINDOW ALREADY CLOSED
   * counted that receipt's £193.25 as money still to come back, three lines
   * below. Read off the rendered figure and checked against the two sums the
   * page itself holds, rather than against a number written here that would go
   * stale with the seed.
   */
  const footer = /(£[\d,]+\.\d\d) still returnable/.exec(shown);
  const sums = await backlogPage.evaluate(() => {
    const rs = JSON.parse(localStorage.getItem('kept.v1')).receipts.filter((r) => r.status === 'active');
    return { all: rs.reduce((n, r) => n + r.amount, 0), gone: (rs.find((r) => r.id === 'gone') ?? {}).amount ?? 0 };
  });
  const shownPence = footer ? Math.round(parseFloat(footer[1].replace(/[£,]/g, '')) * 100) : -1;
  results['money past the shop’s window is not counted as still returnable'] =
    // The second clause is the point: if the expired receipt were worth
    // nothing, the two totals would be equal and the first clause would pass
    // over a difference that was never there.
    shownPence === sums.all - sums.gone && sums.gone > 0;

  await backlogCtx.close();
}

/*
 * The retailer's own clock, for the one shop in the table that does not start
 * it at the till.
 *
 * `clockStart` was declared on all twenty entries and read by nothing, so a
 * Zara receipt anyone ADDED counted its 30 days from the order — the safe
 * direction, since dispatch is later, but it can say "window closed" on a day
 * Zara would still take the coat back. Two receipts, because the rule is not
 * "set it when the email mentions dispatch": Argos counts from the purchase
 * and a receipt carrying Zara's clock would be worse than one carrying none.
 */
const addPaste = async (paste, item) => {
  await page.getByRole('button', { name: 'Add a receipt' }).click();
  await page.waitForTimeout(300);
  await page.fill('#paste', paste);
  await page.getByRole('button', { name: 'Read it' }).click();
  await page.waitForTimeout(400);
  await page.fill('#add-item', item);
  await page.getByRole('button', { name: /^Save/ }).click();
  await page.waitForTimeout(600);
  return page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).receipts.at(-1));
};
const zaraAdded = await addPaste('Zara · Order placed 13 August 2026 · Wool coat · Total £34.99 · Dispatched 15 August 2026', 'Wool coat');
const argosAdded = await addPaste('Argos · Order placed 13 August 2026 · Kettle · Total £29.00 · Dispatched 15 August 2026', 'Kettle');
results['a dispatch-clocked shop counts from dispatch, and only that shop'] =
  zaraAdded.store === 'Zara' && zaraAdded.windowStartsOn === '2026-08-15' &&
  argosAdded.store === 'Argos' && argosAdded.windowStartsOn === undefined;

/*
 * A shop that changed its window since this build shipped.
 *
 * The feed exists to carry exactly that, and `newWindowDays` was read for one
 * thing only: telling the holder of an existing receipt how their deadline
 * compares. So the Watch tab would say "new purchases get 16 days less; yours
 * keeps the 30 days it was bought under" — and the Add screen next door would
 * hand a NEW Currys purchase the table's number anyway. A deadline later than
 * the shop will honour, on a receipt added minutes after the app said so.
 *
 * Driven through the real screen rather than the function, because the
 * function had a caller before this and it was not this one.
 */
{
  const feedCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(feedCtx);
  const feedPage = await feedCtx.newPage();
  await feedPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await feedPage.waitForTimeout(400);
  // Dated AFTER the seeded Currys entry, which is itself a change carrying a
  // window: the first version of this dated it in January and the app
  // correctly preferred the July one, which is the rule working rather than
  // failing. The test data was wrong, not the code.
  const feedDays = await feedPage.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kept.v1'));
    s.onboardingSeen = true;
    s.updates = [
      {
        id: 'currys-shortened',
        store: 'Currys',
        changedOn: '2026-08-10',
        text: 'Currys shortened its returns window.',
        affectsStores: ['Currys'],
        affectNote: 'new purchases only',
        newWindowDays: 7,
      },
    ];
    localStorage.setItem('kept.v1', JSON.stringify(s));
    return 7;
  });
  await feedPage.reload({ waitUntil: 'networkidle' });
  await feedPage.waitForTimeout(600);
  await feedPage.getByRole('button', { name: 'Add a receipt' }).click();
  await feedPage.waitForTimeout(300);
  await feedPage.fill('#paste', 'Currys · Order placed 20 August 2026 · Kettle · Total £29.00');
  await feedPage.getByRole('button', { name: 'Read it' }).click();
  await feedPage.waitForTimeout(400);
  await feedPage.fill('#add-item', 'Kettle');
  await feedPage.getByRole('button', { name: /^Save/ }).click();
  await feedPage.waitForTimeout(600);
  const added = await feedPage.evaluate(() =>
    JSON.parse(localStorage.getItem('kept.v1')).receipts.find((r) => r.item === 'Kettle'));
  results['a shop that changed its window gives a new purchase the new one'] =
    !!added && added.windowDays === feedDays &&
    // And the sentence quoting it moves with it, or the row would read
    // "Currys · 14 days" above a deadline seven days out — a drift this
    // codebase has already had once. It also has to say WHERE the number came
    // from: the fallback wording was written for a window someone typed, and
    // "as entered, not verified. Check the receipt" is untrue of one the app
    // took from its own policy watch.
    /7-day return window, from a policy change on 10 August 2026/.test(added.policy ?? '');
  await feedCtx.close();
}

/*
 * And when the paste does NOT say when it was dispatched, the deadline is a
 * floor and has to be shown as one — the same hedge the statutory clocks make
 * about an unknown arrival, pointing the other way. Presented as a fact, it
 * says "window closed" on a day Zara would still take the coat back.
 */
const zaraNoDispatch = await addPaste('Zara · Order placed 13 August 2026 · Linen shirt · Total £25.99', 'Linen shirt');
await page.getByRole('button', { name: /Zara, Linen shirt/ }).click();
await page.waitForTimeout(400);
const zaraDetail = await page.locator('main').innerText();
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Argos, Kettle/ }).click();
await page.waitForTimeout(400);
const argosDetail = await page.locator('main').innerText();
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.waitForTimeout(300);
/*
 * The third clock. Apple, Amazon and ASOS count their own windows from the
 * day the parcel lands, and each carried a `gotcha` saying so in prose while
 * `clockStart` said 'purchase' and the app counted from the order. With the
 * arrival date in hand — which the paste now reads — it counts from there.
 */
const asosAdded = await addPaste(
  'ASOS · Order placed 10 August 2026 · Trainers · Order total: £60.00 · Delivered 14 August 2026',
  'Trainers',
);
results['a shop that counts from delivery starts its window there'] =
  asosAdded.store === 'ASOS' && asosAdded.arrivedOn === '2026-08-14' && asosAdded.windowStartsOn === '2026-08-14' &&
  // And Argos, which counts from the till, records the arrival without
  // starting its window on it — the statutory clocks still run from there.
  argosAdded.arrivedOn === undefined && argosAdded.windowStartsOn === undefined;

results['an unknown dispatch date is shown as a floor, not a deadline'] =
  zaraNoDispatch.windowStartsOn === undefined &&
  /earliest it can be, never the latest/.test(zaraDetail) &&
  // And not said about a shop that counts from the till, where it is false.
  !/earliest it can be/.test(argosDetail);

/*
 * And the person can then supply it, which is the half that makes the hedge
 * something other than an instruction to do the impossible. The field is
 * offered only on a shop that counts from dispatch: Argos does not, and a
 * receipt carrying the wrong clock is worse than one carrying none.
 */
await page.getByRole('button', { name: /Zara, Linen shirt/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.waitForTimeout(400);
const dispatchFieldOnZara = await page.locator('#e-dispatched').count();
// Guarded: the failure this exists to catch removes the field, and an
// unguarded fill would kill the harness before it printed a verdict.
await page.fill('#e-dispatched', '2026-08-16').catch(() => {});
await page.getByRole('button', { name: 'Save changes' }).click().catch(() => {});
await page.waitForTimeout(600);
const zaraFixed = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('kept.v1')).receipts.find((r) => r.item === 'Linen shirt'));
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Argos, Kettle/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.waitForTimeout(400);
const dispatchFieldOnArgos = await page.locator('#e-dispatched').count();
await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => {});
await page.waitForTimeout(300);
results['the dispatch date can be supplied, on the shop it belongs to'] =
  dispatchFieldOnZara === 1 && dispatchFieldOnArgos === 0 && zaraFixed.windowStartsOn === '2026-08-16';


/*
 * What is on screen when the app cannot render.
 *
 * A throw anywhere below the root unmounts the whole tree — measured before
 * the boundary existed: a blank page, no text, not one button, while the
 * receipts sat intact in localStorage with no server holding a copy. A reload
 * recovers only when the fault is on a screen you had to navigate to; a fault
 * on the first screen, or one a particular stored receipt causes, lands back
 * in the blank state on every launch.
 *
 * Driven by making a platform call the render depends on throw, which is a
 * real class of failure (an old engine, a locale bug) and does not need a
 * test-only hook in the app. Its own context, because a page that cannot
 * render is not a page the rest of this script can carry on using.
 */
{
  const brokenCtx = await browser.newContext({ viewport: { width: 402, height: 874 }, acceptDownloads: true });
  watchOrigins(brokenCtx);
  const broken = await brokenCtx.newPage();
  await broken.addInitScript(() => {
    // money() formats every amount on every screen through this.
    // eslint-disable-next-line no-extend-native
    Number.prototype.toLocaleString = function toLocaleString() {
      throw new Error('simulated platform failure');
    };
  });
  // The first load lands on onboarding, which formats no money and so renders
  // fine. Get past it, then reload into the screen that does.
  await broken.goto(`${ORIGIN}/app/`, { waitUntil: 'domcontentloaded' });
  await broken.waitForTimeout(500);
  await broken.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('kept.v1') ?? '{}');
    stored.onboardingSeen = true;
    localStorage.setItem('kept.v1', JSON.stringify(stored));
  });
  await broken.reload({ waitUntil: 'domcontentloaded' });
  await broken.waitForTimeout(900);

  results['a render failure is not a blank page'] =
    (await broken.getByRole('heading', { name: 'Something in kept broke' }).isVisible().catch(() => false)) &&
    (await broken.getByRole('button', { name: 'Save my receipts to a file' }).isVisible().catch(() => false));

  // The rescue must produce the receipts, without going through the loader or
  // the reader that may be what failed.
  const rescue = broken.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await broken.getByRole('button', { name: 'Save my receipts to a file' }).click().catch(() => {});
  const download = await rescue;
  let rescued = null;
  if (download) {
    const path = join(tmpdir(), 'kept-smoke-rescue.json');
    await download.saveAs(path);
    rescued = JSON.parse(readFileSync(path, 'utf8'));
  }
  results['the rescue hands back the receipts that were on the device'] =
    !!rescued && rescued.app === 'kept' && Array.isArray(rescued.receipts) && rescued.receipts.length > 0;

  await brokenCtx.close();
}

// The free tier is claimed on the pricing page, in Settings and on the Add
// screen. Fill it and the Save must actually refuse.
/*
 * First: the five receipts a fresh install arrives with must not spend the
 * allowance. Settings opened at "5 of 10 free receipts" before the person had
 * added anything, and the wall came after five of their own — with a price on
 * it. Read off the meter, because that is where somebody sees it.
 *
 * Its own context, because "a fresh install" is the whole claim and this page
 * has by now added, edited and returned things.
 */
{
  const freshCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(freshCtx);
  const freshPage = await freshCtx.newPage();
  await freshPage.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await freshPage.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await freshPage.waitForTimeout(300);
  await freshPage.getByRole('button', { name: 'Settings', exact: true }).click();
  await freshPage.waitForTimeout(400);
  const meter = await freshPage.getByRole('progressbar').getAttribute('aria-valuenow');
  const seededCount = await freshPage.evaluate(() =>
    JSON.parse(localStorage.getItem('kept.v1')).receipts.filter((r) => r.demo && r.status === 'active').length);
  results['the demo set does not spend the free tier'] = seededCount > 0 && meter === '0';
  await freshCtx.close();
}

await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('kept.v1'));
  // Deliberately NOT demo rows: the point is ten receipts the person added.
  const { demo, ...base } = state.receipts[0];
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
 * Tapping a price must not behave as though money changed hands.
 *
 * It did: the tier tiles dispatched plan:'pro' on the spot, so someone who
 * pressed "£39.99 lifetime" watched the paywall vanish with no card box, no
 * confirmation and no word either way. The only reading available to them was
 * that they had just been charged £39.99. Payments are not built, so nothing
 * was — which is exactly the thing the screen has to say.
 */
const planOf = () => page.evaluate(() => JSON.parse(localStorage.getItem('kept.v1')).settings.plan);
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /£39\.99/ }).click();
await page.waitForTimeout(400);
const notice = page.getByRole('dialog');
const noticeSaid = (await notice.innerText().catch(() => '')) || '';
results['tapping a price does not pretend to charge for it'] =
  (await planOf()) === 'free' &&
  /charge/i.test(noticeSaid) &&
  /£39\.99/.test(noticeSaid);
// And it must be leaveable without buying anything. The clicks below are
// guarded because the failure this section exists to catch removes the sheet
// entirely: an unguarded click would kill the harness before it printed a
// single verdict, and a suite that dies is not a suite that failed.
await page.getByRole('button', { name: 'Not now' }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(400);
results['the notice can be dismissed, and nothing is unlocked'] =
  (await planOf()) === 'free' && (await page.getByRole('dialog').count()) === 0;
// The unlock itself is real, and the screen keeps saying it was free.
await page.getByRole('button', { name: /£16\.99/ }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Unlock everything, free' }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(500);
results['unlocking says, where the price was, that nothing was charged'] =
  (await planOf()) === 'pro' &&
  /Nothing was charged/.test(await page.locator('main').innerText());
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('kept.v1'));
  state.settings.plan = 'free';
  localStorage.setItem('kept.v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

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
/*
 * The marketing page has to be able to reach the product.
 *
 * Its call to action was an App Store badge with `href="#"` — a promise of an
 * iOS app that does not exist, pointing at nothing — and the nav button beside
 * it went to the pricing section. The page's only mention of /app/ was the
 * demo iframe's src, so someone who read the whole thing and wanted to use
 * kept had nowhere to click. A funnel with no exit is not something any other
 * check here would notice: nothing overflows, nothing fails contrast, and a
 * dead link is a perfectly valid one.
 */
// EVERY link that offers to open the app, not the first one that happens to.
// Checking one of them passes while the others are dead — which it did: the
// nav button satisfied this while the hero's still pointed at "#".
const ctas = await landing.evaluate(() =>
  [...document.querySelectorAll('a')]
    .filter((a) => /open kept/i.test(a.textContent ?? ''))
    .map((a) => a.getAttribute('href')),
);
results['the landing page has a way into the app'] =
  ctas.length >= 2 && ctas.every((h) => h === '/app/');

// And one of them is followed, because an href is not a working link.
await landing.getByRole('link', { name: /Open kept/ }).last().click();
await landing.waitForTimeout(900);
results['and its call to action actually opens it'] = new URL(landing.url()).pathname === '/app/';
await landing.goBack({ waitUntil: 'networkidle' }).catch(() => {});
await landing.waitForTimeout(400);

results['the landing demo cannot touch the real app’s data'] =
  (await page.evaluate(() => localStorage.getItem('kept.v1'))) === storedBefore;
await landing.close();

// The manifest has to be installable-shaped, because "add it to your home
// screen" is how the share target and the offline promise are reached at all.
const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
results['the manifest is installable and declares the share target'] =
  !!manifest.name && !!manifest.start_url && manifest.display === 'standalone' &&
  Array.isArray(manifest.icons) && manifest.icons.some((i) => i.sizes === '512x512') &&
  manifest.share_target?.method === 'GET';

/*
 * Offline is deliberately NOT tested here, and this note is the reason.
 *
 * It was, for a while, under a comment claiming "the network is cut
 * completely". It was not: `setOffline` governs the PAGE's network and leaves
 * a service worker's own fetches alone, so every request the worker answered
 * went on reaching the live server. Measured afterwards — both checks passed
 * against a worker that intercepted everything and cached NOTHING, which is an
 * app that dies the moment it is actually on a train. They proved a worker was
 * installed, and read as proof of the app's central claim.
 *
 * The only way to cut a worker's network is to stop the server, and a script
 * cannot stop a server it did not start. So offline belongs to
 * scripts/freshness.mjs, which starts its own.
 */

/*
 * Two tabs. Both hold the whole library in memory and both write all of it, so
 * the one with older state used to destroy whatever the other had added — a
 * setting toggle in the stale tab was enough, and it happened in silence.
 * Its own context so the tabs share an origin without disturbing the run.
 */
{
  const tabsCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(tabsCtx);
  const tabOne = await tabsCtx.newPage();
  await tabOne.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await tabOne.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await tabOne.waitForTimeout(400);
  const tabTwo = await tabsCtx.newPage();
  await tabTwo.goto(`${ORIGIN}/app/`, { waitUntil: 'networkidle' });
  await tabTwo.waitForTimeout(600);

  await tabOne.bringToFront();
  await tabOne.getByRole('button', { name: 'Add a receipt' }).click();
  await tabOne.waitForTimeout(300);
  await tabOne.fill('#paste', 'Your Apple order · Total £129.00 · 25 Aug');
  await tabOne.getByRole('button', { name: 'Read it' }).click();
  await tabOne.waitForTimeout(300);
  await tabOne.fill('#add-item', 'AirPods Pro');
  await tabOne.getByRole('button', { name: 'Save receipt' }).click();
  await tabOne.waitForTimeout(600);

  // The stale tab now writes, for an unrelated reason.
  await tabTwo.bringToFront();
  await tabTwo.getByRole('button', { name: 'Settings', exact: true }).click();
  await tabTwo.waitForTimeout(300);
  await tabTwo.getByRole('switch', { name: /Policy watch/ }).click();
  await tabTwo.waitForTimeout(700);

  results['a second tab does not destroy the first tab’s receipt'] = await tabTwo.evaluate(() =>
    JSON.parse(localStorage.getItem('kept.v1')).receipts.some((r) => r.item === 'AirPods Pro'),
  );
  await tabsCtx.close();
}

/*
 * A write that does not land. There is no server behind this app, so a failed
 * save means the receipts are gone at the next launch while the screen still
 * shows them — it used to happen in complete silence. Its own context, because
 * breaking storage would derail every check after it.
 */
{
  const fullCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  watchOrigins(fullCtx);
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
  watchOrigins(clockCtx);
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

// Last, so that everything every context loaded has been seen.
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
