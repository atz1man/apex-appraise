import { expect, test, type Page } from '@playwright/test';

/**
 * Choosing a contractor on the cost monitor, while the ledger moves underneath.
 *
 * The dropdown used to post the whole package row back — name, budget,
 * committed, spent, forecast, progress — so it wrote four money figures the
 * user never touched, from whatever copy the page was holding. `syncXero`
 * writes `committed` and `spent` on `source: 'xero'` packages, and this table
 * renders the dropdown on those rows too.
 *
 * The API test covers the procedure. This covers the half only a browser can:
 * that the SCREEN sends nothing but the contractor. Removing a field from a
 * request body is invisible to an API test that constructs its own input —
 * `a48b7b3` is the standing reminder that the client half of a fix needs its
 * own proof.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

test('sends only the contractor, not the figures the page happened to be holding', async ({ page }) => {
  await signIn(page);
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id;
  });

  await page.goto(`/deal/${id}/costs`);
  const dropdown = page.locator('select[aria-label^="Contractor for"]').first();
  await expect(dropdown).toBeVisible();

  const nextContractor = await dropdown.evaluate((element: HTMLSelectElement) =>
    Array.from(element.options).find((option) => option.value && option.value !== element.value)?.value);
  expect(nextContractor, 'the fixture needs a different contractor to prove a persisted change').toBeTruthy();

  const [req, response] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('cost.upsertPackage')),
    page.waitForResponse((r) => r.url().includes('cost.upsertPackage') && r.request().method() === 'POST'),
    dropdown.selectOption(nextContractor!),
  ]);

  // tRPC batches: the body is {"0":{"json":{...}}}, not {"json":{...}}
  const body = JSON.parse(req.postData() ?? '{}') as Record<string, { json?: Record<string, unknown> }>;
  const sent = body['0']?.json ?? {};
  expect(Object.keys(sent).length, 'the request body was not the shape this test reads').toBeGreaterThan(0);
  const money = ['budget', 'committed', 'spent', 'forecast'];
  const carried = money.filter((k) => k in sent);
  expect(
    carried,
    `the dropdown posted money it was not asked to change: ${carried.join(', ')} — a ledger sync since page load would be reverted`,
  ).toEqual([]);
  expect(Object.keys(sent).sort()).toEqual(['contractorId', 'dealId', 'id']);

  /**
   * And the change the user DID make lands. Asserted through a reload against
   * the value the request carried, because a narrower payload that quietly
   * wrote nothing would satisfy every assertion above.
   */
  const chosen = (JSON.parse(req.postData() ?? '{}') as Record<string, { json: { contractorId: string } }>)['0']!.json.contractorId;
  // A request being sent is not a completed save: reloading at that point can
  // cancel it. Check the tRPC outcome before testing persistence on reload.
  expect(response.ok()).toBe(true);
  const result = await response.json();
  for (const item of Array.isArray(result) ? result : [result]) {
    expect(item.error).toBeUndefined();
    expect(item.result).toBeDefined();
  }
  await page.reload();
  const reloaded = page.locator('select[aria-label^="Contractor for"]').first();
  await expect(reloaded).toHaveValue(chosen);
});
