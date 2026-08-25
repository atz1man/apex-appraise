import { expect, test, type Page } from '@playwright/test';

/**
 * The offline shell, and what gets written into it.
 *
 * `offline.spec.ts` covers what happens when somebody presses Save with no
 * signal — react-query pausing the mutation and replaying it. That is the app's
 * behaviour, not the service worker's. Nothing has ever asserted anything about
 * `sw.js` itself, which is the thing the whole field-app promise rests on: "the
 * field app has to render offline" is a stated non-negotiable, and the shell
 * cache is the only mechanism that delivers it.
 *
 * The worker only registers on a production build (`import.meta.env.PROD`), so
 * these skip against a dev server rather than passing vacuously — a test that
 * silently does nothing on the machine where it is written is worse than no
 * test, because it reports coverage that is not there. CI runs the whole browser
 * suite against the built docker stack on :8080, so this runs for real there.
 */

/** wait for the worker to be installed AND controlling this page */
async function controlled(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
    ]);
    if (!reg) return false;
    if (navigator.serviceWorker.controller) return true;
    return new Promise<boolean>((r) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => r(true), { once: true });
      setTimeout(() => r(Boolean(navigator.serviceWorker.controller)), 5_000);
    });
  });
}

/** what the worker currently holds as the shell */
const shell = (page: Page) =>
  page.evaluate(async () => {
    for (const key of await caches.keys()) {
      const hit = await (await caches.open(key)).match('/');
      if (hit) return { key, status: hit.status, body: (await hit.text()).slice(0, 4000) };
    }
    return null;
  });

test.describe('the service worker', () => {
  test('opens the app with no signal, and never caches a failure as the shell', async ({ page, context }) => {
    await page.goto('/');
    test.skip(!(await controlled(page)), 'no service worker — dev server; this runs against the built stack');

    // what a good install looks like, so the comparison below means something
    const good = await shell(page);
    expect(good, 'the worker is controlling the page but has cached no shell').not.toBeNull();
    expect(good!.status).toBe(200);
    expect(good!.body).toContain('<div id="root">');

    /**
     * Now the failure that poisons it. `fetch()` resolves for a 502 — it only
     * rejects when the network is unreachable — so the worker used to write
     * whatever came back into the cache under `/`. A restarting API, a
     * half-finished deploy or a maintenance page therefore BECAME the offline
     * shell, and the surveyor with no reception opened "502 Bad Gateway" instead
     * of the app. Permanently: the only thing that overwrites it is a successful
     * navigation, which needs the signal they have not got.
     *
     * `context.route`, not `page.route` — requests made BY a service worker are
     * only interceptable at the context.
     */
    await context.route('**/field', (route) =>
      route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' }),
    );
    await page.goto('/field').catch(() => undefined);
    await page.waitForTimeout(600); // the cache write is not awaited by the response

    const after = await shell(page);
    expect(after, 'the shell was evicted by a failed navigation').not.toBeNull();
    expect(after!.status, 'a 502 was cached as the offline shell').toBe(200);
    expect(after!.body, 'a 502 was cached as the offline shell').not.toContain('502 Bad Gateway');
    expect(after!.body).toContain('<div id="root">');

    await context.unroute('**/field');

    // and the shell actually works: a cold navigation with the network down
    await context.setOffline(true);
    await page.goto('/deals').catch(() => undefined);
    await expect(page.locator('#root')).toBeAttached();
    await context.setOffline(false);
  });

  test('never caches a failed asset, which cache-first would make permanent', async ({ page, context }) => {
    await page.goto('/');
    test.skip(!(await controlled(page)), 'no service worker — dev server; this runs against the built stack');

    /**
     * `/assets/` is cache-first because the filenames are content-hashed and the
     * bytes never change. That makes a cached 404 immutable too: the client that
     * asked during a bad deploy never loads that asset again, even once the
     * deploy is rolled back, because the worker stops asking.
     */
    const url = '/assets/does-not-exist-' + Date.now() + '.js';
    await context.route('**' + url, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.evaluate((u) => fetch(u).catch(() => undefined), url);
    await page.waitForTimeout(600);

    const cached = await page.evaluate(async (u) => {
      for (const key of await caches.keys()) {
        const hit = await (await caches.open(key)).match(u);
        if (hit) return hit.status;
      }
      return null;
    }, url);
    expect(cached, 'a 404 was cached under an immutable asset URL').toBeNull();
    await context.unroute('**' + url);
  });

  test('never lets a report or an upload become the shell', async ({ page, context }) => {
    await page.goto('/');
    test.skip(!(await controlled(page)), 'no service worker — dev server; this runs against the built stack');

    const good = await shell(page);
    expect(good!.body).toContain('<div id="root">');

    /**
     * `NEVER_CACHE` exists because "money data must always be live", and the way
     * it would go wrong is not obvious. A signed valuation at `/reports/…` opened
     * in a new tab is a NAVIGATION, so without that guard the navigate branch
     * below would cache the PDF under `/` — and the field app with no signal
     * would then open one firm's valuation instead of the app. `/uploads/` is a
     * customer's own document and the same applies.
     *
     * So this asserts the shell survives a successful navigation to both, which
     * is the property, rather than counting cache entries — a count passes
     * whether the guard works or no branch happens to match.
     */
    for (const path of ['/reports/valuation-1.pdf', '/uploads/site-plan.pdf']) {
      await context.route('**' + path, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: `<h1>PRIVATE ${path}</h1>` }),
      );
      await page.goto(path).catch(() => undefined);
      await page.waitForTimeout(400);
      const after = await shell(page);
      expect(after!.body, `${path} was cached as the offline shell`).not.toContain('PRIVATE');
      expect(after!.body, `${path} evicted the offline shell`).toContain('<div id="root">');
      await context.unroute('**' + path);
    }

    // and nothing of a firm's figures is sitting in a cache regardless
    const cachedApi = await page.evaluate(async () => {
      const found: string[] = [];
      for (const key of await caches.keys()) {
        for (const req of await (await caches.open(key)).keys()) {
          const p = new URL(req.url).pathname;
          if (/^\/(trpc|uploads|reports|webhooks|health)/.test(p)) found.push(p);
        }
      }
      return found;
    });
    expect(cachedApi, 'the worker cached something it must never cache').toEqual([]);
  });
});
