import { expect, test, type Page } from '@playwright/test';

/**
 * No screen claims the firm has nothing when the truth is it could not look.
 *
 * "No comparable evidence yet" and "Nobody is on the register yet" are claims
 * about the firm's record. A screen whose query just failed does not know
 * either, and measured — signed in, with every query answered 500 — sixteen
 * empty states across eleven screens asserted it anyway. A valuer reading
 * "No cost plan on this deal yet" goes looking for work that is sitting there
 * unreachable. The toast beside them is transient and gone by the time anyone
 * reads the panel, and `lib/load-failure.ts` had been written for exactly this
 * conflation — it was wired into three screens and nothing else.
 *
 * This walks every route with the queries refused and asserts no such claim is
 * rendered. It is the whole guard: no static rule can see that an empty state
 * belongs to a particular query, because the branch is `list.length === 0` and
 * the query is two hundred lines up.
 *
 * Mutations are left alone — nothing here presses anything. Only GETs are
 * refused, which is what tRPC's batch link uses for queries.
 */

/** A sentence asserting there is nothing — the shape that must never survive a failure. */
const CLAIM = /^(No\b[^.]{0,60}|Nobody[^.]{0,60}|Nothing[^.]{0,60}|This folder is empty|[A-Z][^.\n]{0,50}\byet)\.?$/;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

/** Every visible "there is nothing here" sentence on the page, toasts excluded. */
async function claims(page: Page): Promise<string[]> {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const hits = new Set<string>();
    for (const el of document.querySelectorAll('div,p,span,td,h1,h2,h3,h4,li')) {
      if (!vis(el) || el.children.length > 2) continue;
      const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      // a toast is transient; it is not the screen saying this
      if (t && t.length < 80 && re.test(t) && !/could/i.test(t)) hits.add(t);
    }
    return [...hits];
  }, CLAIM.source);
}

/**
 * Wait for the screen to have SETTLED into failure, rather than sleeping.
 *
 * The query client retries once (`App.tsx`: `retry: 1`), so for about a second
 * after navigation a refused screen is still showing skeletons — and a fixed
 * `waitForTimeout` that lands inside that window reads an empty page and calls
 * it clean. Measured: with a 1200ms sleep, two planted mutants BOTH survived
 * the walk. So this waits for the failure to be visible somewhere on the page
 * and returns whether it ever arrived; a route where it never does is reported
 * rather than passed over, because a walk that cannot see the failure cannot
 * have checked what it claims to check.
 */
async function settledIntoFailure(page: Page): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const busy = [...document.querySelectorAll('[class*=animate-pulse], [class*=animate-spin]')].filter(vis).length;
      const failed =
        [...document.querySelectorAll('[data-testid="load-error"], [data-testid$="-error"], [role=alert]')].filter(vis).length > 0 ||
        /Couldn.t load/i.test(document.body.innerText);
      return { busy, failed };
    });
    if (state.failed && state.busy === 0) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/** Answer every query with a 500 — one error per operation, so a batch is not short an entry. */
async function refuseQueries(page: Page) {
  await page.route('**/trpc/**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const ops = (new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',').length;
    const one = { error: { json: { message: 'boom', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } };
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify(Array.from({ length: Math.max(1, ops) }, () => one)) });
  });
}

async function routesOf(page: Page): Promise<string[]> {
  await page.goto('/board');
  await page.waitForLoadState('networkidle');
  const deals = await page.locator('a[href^="/deal/"]').evaluateAll((as) => as.map((a) => [a.getAttribute('href') ?? '', (a.textContent ?? '').trim()] as const));
  const deal = (deals.find(([, n]) => /Northgate/i.test(n)) ?? deals[0])![0].split('/').slice(0, 3).join('/');
  await page.goto(deal);
  await page.waitForLoadState('networkidle');
  const tabs = [...new Set(await page.locator(`a[href^="${deal}/"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')))];
  return ['/', '/board', deal, ...tabs, '/portfolio/pack', '/calendar', '/benchmarking', '/integrations', '/settings', '/investors', '/field'];
}

test('no screen says the firm has nothing when its query failed', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const routes = await routesOf(page);
  await refuseQueries(page);

  const lies: string[] = [];
  const unchecked: string[] = [];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    if (!(await settledIntoFailure(page))) unchecked.push(route);
    for (const c of await claims(page)) lies.push(`${route}: “${c}”`);
  }
  // the claims first: a screen that renders one INSTEAD of the failure has neither,
  // so it is also `unchecked`, and the list of claims is the message worth reading
  expect(lies, 'these assert the firm has no such record, while the query that would know failed').toEqual([]);
  expect(unchecked, 'no failure ever became visible here, so this walk proved nothing about it').toEqual([]);
});

test('the same walk finds the claim when the screen really is empty, and offers a retry when it is not', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  // a deal of this spec's own making, so it does not depend on a seeded deal being bare
  const id = await page.evaluate(async () => {
    const res = await fetch('/trpc/deals.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      body: JSON.stringify({ json: { name: `Load failure ${Date.now()}`, address: '1 Test Row, Bournemouth', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' } }),
    });
    return (await res.json())?.result?.data?.json?.id as string;
  });
  expect(id, 'the spec could create its own deal').toBeTruthy();

  // succeeding: the screen is genuinely empty and says so — this is what the walk above must be able to see
  await page.goto(`/deal/${id}/comparables`);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  expect(await claims(page)).toContain('No comparable evidence yet');

  // failing: the same screen, the same place, a different answer
  await refuseQueries(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const error = page.getByTestId('load-error').first();
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('data-kind', 'server');
  expect(await claims(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);

  // and the retry recovers it once the server answers again
  await page.unroute('**/trpc/**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('empty-state')).toBeVisible();
});
