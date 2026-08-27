import { expect, test, type Page } from '@playwright/test';

/**
 * The two evidence screens, and what they actually put on the wire.
 *
 * Both persist on blur and used to send the whole row, so moving one column
 * wrote every other from the copy the page was holding. The API tests cover the
 * procedures; this covers the half only a browser can — that the SCREEN sends
 * nothing it was not asked to change. Removing a field from a request body is
 * invisible to an API test that constructs its own input, which is the standing
 * lesson from `a48b7b3`.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

const dealNamed = (page: Page, prefix: string) =>
  page.evaluate(async (name) => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith(name)).id as string;
  }, prefix);

/** tRPC batches: the body is {"0":{"json":{...}}} */
const sentKeys = (postData: string | null) => {
  const body = JSON.parse(postData ?? '{}') as Record<string, { json?: Record<string, unknown> }>;
  return Object.keys(body['0']?.json ?? {}).sort();
};

/**
 * Northgate is the only seeded deal carrying comparables and scheme options —
 * and it is also the deal the Red Book and narrative specs read. So both tests
 * put the value back, or a single run would leave the evidence behind a signed
 * valuation altered for every spec that follows.
 */
const NORTHGATE = 'Northgate';

const oneField = async (page: Page, procedure: string, change: (v: number) => number) => {
  const field = page.locator('input[type="number"]').first();
  await expect(field).toBeVisible();
  const before = await field.inputValue();

  await field.fill(String(change(Number(before || 0))));
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes(procedure)),
    field.blur(),
  ]);

  // put it back, through the same one-field path
  await field.fill(before);
  await Promise.all([page.waitForRequest((r) => r.url().includes(procedure)), field.blur()]);

  return sentKeys(req.postData());
};

test('a comparable adjustment sends only that adjustment', async ({ page }) => {
  await signIn(page);
  const id = await dealNamed(page, NORTHGATE);
  await page.goto(`/deal/${id}/comparables`);

  const keys = await oneField(page, 'comparables.upsert', (v) => v - 2.5);
  expect(keys.length, 'the request body was not the shape this test reads').toBeGreaterThan(0);
  const untouched = keys.filter((k) => !['id', 'dealId'].includes(k));
  expect(
    untouched,
    `blurring one column posted ${untouched.length} fields — another valuer's adjustments on this comparable would be reverted`,
  ).toHaveLength(1);
});

test('a scheme lever sends only that lever', async ({ page }) => {
  await signIn(page);
  const id = await dealNamed(page, NORTHGATE);
  await page.goto(`/deal/${id}/scenarios`);

  const keys = await oneField(page, 'scenarios.upsert', (v) => v + 5);
  expect(keys.length, 'the request body was not the shape this test reads').toBeGreaterThan(0);
  const untouched = keys.filter((k) => !['id', 'dealId'].includes(k));
  expect(untouched, `blurring one lever posted ${untouched.join(', ')}`).toHaveLength(1);
});
