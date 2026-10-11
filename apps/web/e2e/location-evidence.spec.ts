import { expect, test, type Page } from '@playwright/test';

// Deterministic source responses, not invented customer evidence. No upstream
// tile traffic or writes; test only the real UI's treatment of these outcomes.
async function site(page: Page, opts: { image?: boolean; failImage?: boolean; configError?: boolean; sourceError?: boolean; metric?: boolean; hostile?: boolean; missingArea?: boolean } = {}) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools', { exact: true })).toBeVisible();
  const href = await page.getByRole('link', { name: /^Site evidence/ }).getAttribute('href');
  const policy = await page.evaluate(async () => {
    const response = await fetch('/trpc/org.policy', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await response.json()).result.data.json;
  });
  const label = opts.hostile ? '<img src=x onerror="document.body.dataset.injected=1">' : 'Recorded property';
  await page.route('**/tiles/**', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/staticmap?**', (route) => opts.failImage ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/trpc/**', async (route) => {
    const u = new URL(route.request().url());
    const ops = u.pathname.split('/trpc/')[1]!.split(',');
    const batched = u.searchParams.get('batch') === '1';
    const mocked = new Set(['org.mapConfig', 'org.policy', 'sitePack.get']);
    if (ops.every((op) => !mocked.has(op))) return route.continue();
    const inputs = JSON.parse(u.searchParams.get('input') ?? '{}');
    // Never request an upstream source that this fixture replaces. Forward only
    // unrelated operations, preserving each operation's input and real response.
    const rows = await Promise.all(ops.map(async (op, i) => {
      if (mocked.has(op)) return {};
      const single = new URL(u);
      single.pathname = `${u.pathname.split('/trpc/')[0]}/trpc/${op}`;
      single.searchParams.delete('batch');
      single.searchParams.set('input', JSON.stringify(batched ? inputs[i] ?? {} : inputs));
      return (await route.fetch({ url: single.toString() })).json();
    }));
    ops.forEach((op, i) => {
      let json: unknown;
      if (op === 'org.mapConfig') {
        if (opts.configError) {
          rows[i] = { error: { json: { message: 'Map access unavailable', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } };
          return;
        }
        json = { tileUrl: '/tiles/{z}/{x}/{y}.png?t=test', attribution: 'Test map', maxZoom: 19, staticMapUrl: opts.image ? '/staticmap?t=test' : null, staticMapAttribution: 'Test imagery' };
      } else if (op === 'org.policy') json = { ...policy, ...(opts.metric ? { region: 'AU' } : {}) };
      else if (op === 'sitePack.get') json = {
        status: 'ok', dealName: 'Evidence test', address: 'Subject site',
        geo: { postcode: 'BH8 8EW', latitude: 50.73, longitude: -1.86, district: 'BCP', region: 'South West' },
        soldPrices: { status: opts.sourceError ? 'error' : 'ok', asAt: '2026-10-01T09:00:00Z', items: opts.sourceError ? [] : [{ address: label, date: '2026-09-01', price: 300000, postcode: 'BH8 8EW', propertyType: 'terraced', estateType: 'freehold', newBuild: false, psf: 220, lat: 50.731, lng: -1.862 }] },
        constraints: { status: opts.sourceError ? 'slow' : 'ok', checked: ['green-belt'], hits: [] },
        epc: opts.missingArea ? { status: 'ok', records: [{ address: 'Area unknown property', floorAreaSqm: 0, rating: 'C', inspectionDate: '2026-01-01', source: 'Test certificate' }] } : { status: 'error', records: [], note: 'Register unavailable' },
        floodWarnings: { status: 'ok', items: [] }, amenities: { status: 'ok', items: [] }, incomplete: false,
      };
      if (json !== undefined) rows[i] = { result: { data: { json } } };
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(batched ? rows : rows[0]) });
  });
  await page.goto(href!);
  await expect(page.getByRole('heading', { name: 'Evidence coverage', exact: true })).toBeVisible();
}

test('imagery failure falls back to a usable interactive map', async ({ page }) => {
  await site(page, { image: true, failImage: true });
  await expect(page.getByText('Aerial imagery is unavailable. Showing the street map.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Property location map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Street map', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Fit properties', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
});

test('street and aerial views can be selected without leaving the evidence', async ({ page }) => {
  await site(page, { image: true });
  await expect(page.getByRole('img', { name: /Aerial map of Evidence test/ })).toBeVisible();
  await page.getByRole('button', { name: 'Street map', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
  await page.getByRole('button', { name: 'Aerial image', exact: true }).click();
  await expect(page.getByRole('img', { name: /Aerial map of Evidence test/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aerial image', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('map popup treats supplied property labels as text', async ({ page }) => {
  await site(page, { hostile: true });
  await page.locator('.leaflet-marker-icon').nth(1).click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('<img src=x');
  await expect(page.locator('.leaflet-popup-content img')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-injected', '1');
});

test('source outages show unknown figures and do not claim a clean screen', async ({ page }) => {
  await site(page, { sourceError: true });
  await expect(page.getByText('Sold records', { exact: true }).locator('..')).toContainText('—');
  await expect(page.getByText('Constraints hit', { exact: true }).locator('..')).toContainText('—');
  await expect(page.getByText(/Still fetching from planning.data.gov.uk/)).toBeVisible();
  await expect(page.getByText(/No intersections returned/)).toHaveCount(0);
  await expect(page.getByText(/No sold-price records returned/)).toHaveCount(0);
  await expect(page.getByText('UNAVAILABLE', { exact: true })).toBeVisible();
});

test('site-pack rates use the workspace area unit and source retrieval date', async ({ page }) => {
  await site(page, { metric: true });
  await expect(page.getByRole('cell', { name: /£2,368/ })).toBeVisible();
  await expect(page.getByText(/Data as at 1 Oct/)).toBeVisible();
  await expect(page.getByText(/Pins use postcode centres/)).toBeVisible();
});

test('map configuration failure provides a recovery action', async ({ page }) => {
  await site(page, { configError: true });
  await expect(page.getByRole('button', { name: 'Retry map', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Map access could not be loaded/)).toBeVisible();
});

test('working-deal selection keeps all deal tools on the chosen workfile', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Working deal' }).click();
  const option = page.getByRole('option').filter({ hasText: 'Northgate' });
  const name = await option.innerText();
  await option.click();
  await expect(page.getByRole('heading', { name: `Everything on ${name}` })).toBeVisible();
  const appraisal = await page.getByRole('link', { name: /^Development appraisal/ }).getAttribute('href');
  const evidence = await page.getByRole('link', { name: /^Site evidence/ }).getAttribute('href');
  expect(evidence?.split('/')[2]).toBe(appraisal?.split('/')[2]);
  await page.reload();
  await expect(page.getByRole('heading', { name: `Everything on ${name}` })).toBeVisible();
});

// Mobile layout keeps the wide evidence table scrollable inside its panel.
test('site evidence remains usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await site(page);
  await expect(page.getByRole('button', { name: 'Fit properties', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('unavailable certificate area is not displayed as a measured zero', async ({ page }) => {
  await site(page, { missingArea: true });
  await expect(page.getByText('Area unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('0 ft²', { exact: true })).toHaveCount(0);
});
