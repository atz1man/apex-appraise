import { expect, test } from '@playwright/test';

/**
 * The typefaces belong to this app.
 *
 * They used to be fetched from Google Fonts on every page load, which put a
 * third party inside three things that must not depend on one: the typeface of
 * a signed, RICS-registered valuation printed by headless chromium on the
 * server; the field app opened on a site with no signal; and a privacy notice
 * that names three companies and then says "Nobody else."
 *
 * These guard the fix rather than the fonts. A stylesheet re-added by hand, a
 * component that pulls an icon font, an analytics snippet that drags one in —
 * each is caught here by the same rule: nothing this browser loads as a font
 * may come from anywhere but this origin.
 */

const FAMILIES = ['Schibsted Grotesk', 'JetBrains Mono'];

/** Hosts that a font must never be fetched from, named so a failure is legible. */
const THIRD_PARTY_FONT_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'fonts.bunny.net',
  'cdn.jsdelivr.net',
  'unpkg.com',
];

type Seen = { fonts: string[]; thirdParty: string[] };

/** Record every font request, and every request to a known font/CDN host. */
function watch(page: import('@playwright/test').Page): Seen {
  const seen: Seen = { fonts: [], thirdParty: [] };
  page.on('request', (r) => {
    const url = r.url();
    if (r.resourceType() === 'font') seen.fonts.push(url);
    if (THIRD_PARTY_FONT_HOSTS.some((h) => url.includes(h))) seen.thirdParty.push(url);
  });
  return seen;
}

function assertAllSameOrigin(seen: Seen, origin: string, where: string) {
  expect(seen.thirdParty, `${where} reached a third-party font host`).toEqual([]);
  const offOrigin = seen.fonts.filter((u) => !u.startsWith(origin));
  expect(offOrigin, `${where} loaded a font from another origin`).toEqual([]);
}

/**
 * The public pages, which anyone can load without an account — and therefore
 * the ones where a font request would hand a stranger's IP to a third party
 * before they had agreed to anything.
 */
for (const path of ['/', '/login', '/privacy']) {
  test(`no third-party font is loaded on ${path}`, async ({ page, baseURL }) => {
    const seen = watch(page);
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    assertAllSameOrigin(seen, new URL(baseURL!).origin, path);
    // and at least one WAS loaded, so this cannot pass by rendering in a fallback
    expect(seen.fonts.length, `${path} loaded no webfont at all`).toBeGreaterThan(0);
  });
}

test('the report a client signs uses the intended faces, served from this app', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const dealId = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return (j.result.data.json.deals as Array<{ id: string; name: string }>).find((d) => d.name.startsWith('Northgate'))!.id;
  });

  await page.goto(`/deal/${dealId}/report`);
  await page.waitForSelector('.a4-page');

  const type = await page.evaluate(async (families) => {
    await document.fonts.ready;
    return {
      missing: families.filter((f) => !document.fonts.check(`12px "${f}"`)),
      // what the report body actually resolves to, not what we hoped it would
      bodyFamily: getComputedStyle(document.querySelector('.a4-page')!).fontFamily,
    };
  }, FAMILIES);

  // this is the assertion the server-side PDF renderer makes before printing;
  // if it fails here, every valuation leaving this system is in the wrong face
  expect(type.missing, 'the report rendered in a fallback typeface').toEqual([]);
  expect(type.bodyFamily).toContain('Schibsted Grotesk');
  assertAllSameOrigin(seen, new URL(baseURL!).origin, 'the appraisal report');
});

/**
 * Both families ship as ONE variable file per subset covering the whole weight
 * range — which is why four files serve seven weights, and why a naive check
 * that "the font loaded" would pass even if every weight collapsed to regular.
 * Bold headings and semibold figures carry meaning in a valuation, so the axis
 * itself is asserted.
 */
test('the variable weight axis renders distinct weights', async ({ page }) => {
  await page.goto('/login');
  const axis = await page.evaluate(async () => {
    await document.fonts.ready;

    // proportional face: heavier is wider
    const span = document.createElement('span');
    span.style.cssText = 'position:absolute;visibility:hidden;font-size:40px;font-family:"Schibsted Grotesk"';
    span.textContent = 'Handgloves 123';
    document.body.appendChild(span);
    span.style.fontWeight = '400';
    const sans400 = span.getBoundingClientRect().width;
    span.style.fontWeight = '700';
    const sans700 = span.getBoundingClientRect().width;
    span.remove();

    /**
     * The mono face is monospaced, so 400 and 600 are the SAME width by
     * definition — measuring width here would assert nothing. Measure ink.
     */
    const ink = (weight: number) => {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 80;
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 600, 80);
      x.fillStyle = '#000';
      x.font = `${weight} 60px "JetBrains Mono"`;
      x.textBaseline = 'top';
      x.fillText('£4,278,000', 0, 5);
      const d = x.getImageData(0, 0, 600, 80).data;
      let total = 0;
      for (let i = 0; i < d.length; i += 4) total += 255 - d[i];
      return total;
    };
    return { sans400, sans700, mono400: ink(400), mono600: ink(600) };
  });

  expect(axis.sans700, 'Schibsted Grotesk 700 is no wider than 400 — the weight axis is dead').toBeGreaterThan(axis.sans400);
  expect(axis.mono400, 'JetBrains Mono rendered no ink at all').toBeGreaterThan(0);
  expect(axis.mono600, 'JetBrains Mono 600 is no heavier than 400 — the weight axis is dead').toBeGreaterThan(axis.mono400 * 1.05);
});

/**
 * The field app is used on sites with no signal. The service worker only ever
 * cached same-origin requests, so while the fonts came from Google they could
 * not be cached at all — self-hosting is what makes an offline inspection
 * render in the right face. Asserting the cache holds them is deterministic;
 * toggling the browser offline and hoping the worker has settled is not.
 */
test('the typefaces are precached for offline use', async ({ page, baseURL }) => {
  test.skip(!!baseURL?.includes(':5273'), 'the service worker is registered in production builds only');

  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 20_000 });

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const wanted = [
      '/fonts/schibsted-grotesk-latin.woff2',
      '/fonts/schibsted-grotesk-latin-ext.woff2',
      '/fonts/jetbrains-mono-latin.woff2',
      '/fonts/jetbrains-mono-latin-ext.woff2',
    ];
    const missing: string[] = [];
    for (const w of wanted) {
      let hit = false;
      for (const k of keys) hit ||= !!(await (await caches.open(k)).match(w));
      if (!hit) missing.push(w);
    }
    return { keys, missing };
  });

  expect(cached.missing, `not in any cache (${cached.keys.join(', ')})`).toEqual([]);
});
