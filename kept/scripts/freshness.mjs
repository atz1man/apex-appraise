/*
 * Does what we deploy actually reach an installed app — and does the app still
 * work when nothing is deployed to it at all?
 *
 * Kept makes two promises that pull against each other. "Verified policy
 * updates the day they change" needs the network to win; "check a deadline on
 * the train, with no signal" needs the cache to. The service worker is where
 * they meet, and where either can quietly stop being true — quietly, because a
 * frozen feed looks exactly like a quiet week and a working app looks exactly
 * like a working app.
 *
 * It had already stopped being true. A worker is consulted BEFORE the HTTP
 * cache, so the app's own `cache: 'no-cache'` on the feed fetch was not a
 * defence, and the cache-first rule written for hashed bundles swallowed the
 * one file whose entire purpose is to change: an installed app never saw
 * another policy update until the next deploy renamed the cache.
 *
 * This sweep owns its own server, on its own port, for one reason: the offline
 * half cannot be faked. Playwright's `setOffline` and `route` both govern the
 * PAGE's network and leave a service worker's own fetches untouched — measured,
 * after an earlier version of this file passed a network-only worker with no
 * cache fallback at all and reported success for a question it never asked. So
 * the server is stopped for real, and what happens next is what happens on the
 * train.
 *
 * Needs a build: npm run build && node scripts/freshness.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.KEPT_FRESHNESS_PORT ?? 4199);
const ORIGIN = `http://localhost:${PORT}`;
const EXEC = process.env.CHROMIUM_PATH;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FEED_FILE = `${ROOT}dist/policy-feed.json`;
const FEED_URL = '/policy-feed.json';
const NEW_ID = 'freshness-probe-change';
const VITE_BIN = `${ROOT}node_modules/vite/bin/vite.js`;

/** The three the offline half is for — named, so they can be marked unasked. */
const OFFLINE_CHECKS = [
  'the app launches with the network gone',
  'and is still usable, not just painted',
  'and the feed falls back to the copy already held',
];

if (!existsSync(FEED_FILE)) {
  console.log('✗ no build to serve — run `npm run build` first');
  process.exit(1);
}

const original = readFileSync(FEED_FILE, 'utf8');
const results = {};
const problems = [];

/*
 * The port has to be free FIRST. `--strictPort` makes a second server exit
 * rather than slide to 4200, so a stray one left by an earlier run would be
 * the thing `waitForServer` found, the thing every check ran against, and the
 * thing `stopServer` could not kill because it never started it. The sweep has
 * to own the server it stops, and this is the only moment it can say so.
 */
if (await fetch(`${ORIGIN}/app/`).then(() => true, () => false)) {
  console.log(`✗ something is already serving ${ORIGIN} — this sweep must own the server it stops`);
  process.exit(1);
}

/*
 * Its own preview server, in its own process group, so it can be stopped.
 *
 * Node running vite's own entry, not `npx vite` — and that is the whole of it
 * working. npm exec puts each child in a NEW process group: measured here, the
 * `npm exec` at pgid 22995, the `sh` it ran at 23011, and the node actually
 * holding the port at 23012. So `kill(-pid)` on what spawn handed back reached
 * npm and nothing else, and the server this sweep believed it had stopped went
 * on serving. The offline half then asked its questions of a machine that was
 * still online, and every one of them passed.
 *
 * Spawned directly, the pid IS the process holding the port, and `detached`
 * makes it the leader of its own group.
 */
const server = spawn(process.execPath, [VITE_BIN, 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  detached: true,
  stdio: 'ignore',
});
let serverUp = true;
/**
 * Stops it, and does not take the caller's word for it: returns only once the
 * port has actually stopped answering. A kill that silently missed is exactly
 * the failure above, and it is invisible from the signal alone.
 */
async function stopServer() {
  if (!serverUp) return true;
  serverUp = false;
  // The negative pid kills the group — the server and anything it spawned —
  // and nothing else. `pkill -f vite` would take this script's own shell with it.
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 50; i += 1) {
    const answering = await fetch(`${ORIGIN}/app/`).then(() => true, () => false);
    if (!answering) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${ORIGIN}/app/`);
      if (res.ok) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

/** Ask for the feed from inside the page, so the worker is in the path. */
const askFeed = () =>
  page.evaluate(async (u) => {
    try {
      const res = await fetch(u, { cache: 'no-cache' });
      if (!res.ok) return { ok: false, why: `status ${res.status}` };
      const doc = await res.json();
      return { ok: true, ids: doc.updates.map((x) => x.id) };
    } catch (e) {
      return { ok: false, why: String(e.message) };
    }
  }, FEED_URL).catch((e) => ({ ok: false, why: e.message.split('\n')[0] }));

try {
  if (!(await waitForServer())) throw new Error(`preview never came up on ${PORT}`);

  await page.goto(`${ORIGIN}/app/`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Reload so the worker is controlling this page rather than merely installed.
  await page.reload({ waitUntil: 'load' });
  results['the worker controls the page'] = await page.evaluate(() => !!navigator.serviceWorker.controller);

  const before = await askFeed();
  results['the feed is readable through the worker'] = before.ok && before.ids.length > 0;

  // Past onboarding, so the offline half lands on the screen that has to work
  // on the train rather than on a welcome card that would render regardless.
  await page.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await page.waitForTimeout(300);

  // Publish a change, exactly as a deploy of the feed alone would.
  const doc = JSON.parse(original);
  doc.updates = [
    ...doc.updates,
    {
      id: NEW_ID,
      store: 'Currys',
      changedOn: '2026-08-29',
      text: 'Currys shortened its returns window to 14 days.',
      affectsStores: ['Currys'],
      affectNote: 'new purchases only — yours keeps the window it was bought under',
      newWindowDays: 14,
    },
  ];
  writeFileSync(FEED_FILE, JSON.stringify(doc));

  const after = await askFeed();
  results['a policy change published today reaches an installed app'] = after.ok && after.ids.includes(NEW_ID);

  await page.reload({ waitUntil: 'load' });
  const next = await askFeed();
  results['and is still there on the next launch'] = next.ok && next.ids.includes(NEW_ID);

  // Now the other promise, with the server genuinely gone.
  const reallyGone = await stopServer();
  results['the server really is unreachable'] = reallyGone;

  if (!reallyGone) {
    // Nothing below can mean anything while the port still answers: the app
    // would "work offline" by fetching, and the feed would "fall back" to the
    // live copy. Recorded as not asked, which is the honest word for it — the
    // version of this file that let them read ✓ is why the check above exists.
    for (const name of OFFLINE_CHECKS) results[name] = null;
  } else {

  // A worker that does not answer the navigation makes this reload fail
  // outright, which is a failing check and not a crashed sweep.
  const launched = await page
    .reload({ waitUntil: 'domcontentloaded' })
    .then(() => true)
    .catch((e) => {
      problems.push(`offline launch: ${e.message.split('\n')[0]}`);
      return false;
    });
  await page.waitForTimeout(600);

  // Not "something rendered" — the app's own promise is a deadline you can
  // check with no signal, so: the library is on screen, in the self-hosted
  // typeface, and it still navigates.
  results['the app launches with the network gone'] =
    launched &&
    (await page.getByText('RETURN DEADLINES, WATCHED').isVisible().catch(() => false)) &&
    (await page.evaluate(() => document.fonts.check('700 16px "Space Grotesk"')).catch(() => false));

  await page.locator('li button').first().click().catch(() => {});
  await page.waitForTimeout(400);
  results['and is still usable, not just painted'] = await page
    .getByText('STORE POLICY')
    .isVisible()
    .catch(() => false);

  const offline = await askFeed();
  results['and the feed falls back to the copy already held'] = offline.ok && offline.ids.includes(NEW_ID);
  if (!offline.ok) problems.push(`offline feed: ${offline.why}`);

  }

  results['no page errors'] = problems.length === 0;
} finally {
  writeFileSync(FEED_FILE, original);
  await stopServer();
  await browser.close();
}

let failed = false;
for (const [name, ok] of Object.entries(results)) {
  if (ok === null) {
    console.log(`? ${name} — not asked, the server never stopped`);
    failed = true;
    continue;
  }
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed = true;
}
for (const p of problems) console.log('  ' + p);
if (!failed) console.log('✓ a deploy reaches the app, and the app still works without one');
process.exit(failed ? 1 : 0);
