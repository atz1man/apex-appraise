import { expect, test } from '@playwright/test';

/**
 * "Loading any page of this product contacts nothing but this product."
 *
 * That sentence is in the privacy notice, so it had better be true. It became
 * true in three steps — the typefaces stopped coming from Google, the subject
 * geocode stopped being fetched by the browser, and the map tiles moved behind
 * this application's own proxy — and each of those is one careless import away
 * from being false again. An analytics snippet, a CDN icon set, an embedded
 * widget: all of them would break the notice without breaking a single feature,
 * which is exactly the kind of regression nobody notices.
 *
 * So this asserts the RULE rather than the three fixes: whatever a page loads,
 * it loads from us.
 */

/**
 * Paying is the one disclosed exception, and the notice says so: card details
 * load Stripe's own form, because a card number should reach Stripe and never
 * us. No test here opens that modal.
 */
const ALLOWED_OFF_ORIGIN: RegExp[] = [];

async function assertSelfContained(
  page: import('@playwright/test').Page,
  baseURL: string,
  where: string,
  go: () => Promise<void>,
) {
  const origin = new URL(baseURL).origin;
  const offOrigin: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return;
    if (ALLOWED_OFF_ORIGIN.some((re) => re.test(url))) return;
    offOrigin.push(`${r.resourceType()} ${url}`);
  });

  await go();
  await page.evaluate(() => document.fonts.ready);
  // give anything lazy — a map, a deferred script — a chance to betray us
  await page.waitForTimeout(1500);

  /**
   * What the page ASKS for, checked before what this run happened to fetch.
   *
   * Watching requests catches the leak only when the element renders, and a
   * whole panel can be gated on a live geocode: an environment that cannot
   * reach postcodes.io draws no map, so a Google Maps iframe restored behind
   * that same gate passed the request sweep with nothing to report. An
   * off-origin `src` in the document is the defect whether or not this
   * particular run got as far as loading it.
   */
  const embedded = await page.evaluate((allowed) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('iframe[src], img[src], script[src], link[href], embed[src], object[data], source[src], video[src], audio[src]')) {
      const raw = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('data') ?? '';
      if (!raw) continue;
      let url: URL;
      try {
        url = new URL(raw, document.baseURI);
      } catch {
        continue;
      }
      if (url.protocol === 'data:' || url.protocol === 'blob:') continue;
      if (url.origin === location.origin) continue;
      if (allowed.some((re) => new RegExp(re).test(url.href))) continue;
      out.push(`${el.tagName.toLowerCase()} ${url.href}`);
    }
    return out;
  }, ALLOWED_OFF_ORIGIN.map((re) => re.source));

  expect(embedded, `${where} embeds something from another origin`).toEqual([]);
  expect(offOrigin, `${where} loaded something from another origin`).toEqual([]);
}

for (const path of ['/', '/login', '/privacy', '/terms', '/docs/api']) {
  test(`${path} contacts nothing but this product`, async ({ page, baseURL }) => {
    await assertSelfContained(page, baseURL!, path, async () => {
      await page.goto(path);
    });
  });
}

/**
 * The two screens with maps on them. Until the tile proxy these pointed the
 * browser straight at a public tile server, which learned the IP address of
 * every valuer and the coordinates of every site they opened.
 */
test('the map screens fetch their tiles from this application', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const tiles: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/tiles/')) tiles.push(r.url());
  });

  await assertSelfContained(page, baseURL!, 'the comparables map', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Deal tools')).toBeVisible();
    const id = await page.evaluate(async () => {
      const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
      const j = await r.json();
      return (j.result.data.json.deals as Array<{ id: string; name: string }>).find((d) => d.name.startsWith('Northgate'))!.id;
    });
    await page.goto(`/deal/${id}/comparables`);
    await expect(page.getByText('Location of evidence')).toBeVisible();
  });

  /**
   * Whether tiles were requested at all depends on whether anything could be
   * placed on the map, which depends on live geocoding — so this asserts where
   * they came from, not that they happened. A tile fetched from anywhere but
   * here would already have failed the check above.
   */
  for (const t of tiles) expect(t.startsWith(origin), `a tile came from ${t}`).toBe(true);
});

/**
 * The printed documents, which are the pages that most need this rule and were
 * the ones exempt from it.
 *
 * Measured on the demo workspace: opening a Red Book valuation fired
 * `document https://www.google.com/maps?q=West%20Quay%20Road%2C%20Poole&z=16&output=embed`
 * — the situation panel embedded Google Maps in an iframe, so the subject
 * property's address reached Google every time anybody opened a valuation, and
 * every time one was rendered server-side for a PDF. Nothing above covered a
 * deal route, so the last third-party request in the product sat on the most
 * confidential page in it.
 *
 * The sweep above is by route, so it can only ever be as good as its list. These
 * two are the documents that leave the building.
 */
test('the printed documents contact nothing but this product', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return (j.result.data.json.deals as Array<{ id: string; name: string }>).find((d) => d.name.startsWith('Harbour'))!.id;
  });

  for (const [what, path] of [
    ['the Red Book valuation', `/deal/${id}/redbook`],
    ['the appraisal report', `/deal/${id}/report`],
  ] as const) {
    await assertSelfContained(page, baseURL!, what, async () => {
      await page.goto(path);
      await page.waitForSelector('.a4-page', { timeout: 30_000 });
    });
  }
});
