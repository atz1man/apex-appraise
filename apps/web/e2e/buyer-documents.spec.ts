import { expect, test, type Page } from '@playwright/test';

/**
 * A paid feature with no way to switch on, and the hole that fixing it opened.
 *
 * `Document.buyerVisible` existed from the first migration and NOTHING in the
 * product could set it — the upload route, `documents.expect`, the EPC link and
 * the workspace importer all leave it at the schema default, and no procedure
 * toggled it. Only the demo seed ever wrote true. "Buyer + investor portals"
 * sits on the Growth column of the pricing page; a firm that paid for it had a
 * buyer whose "Documents to sign" panel could only ever read "Nothing waiting
 * for your signature".
 *
 * The API half is held in `apps/api/test/portal.test.ts`, including the reason
 * the fix takes a PLOT rather than a checkbox. This is the half that suite
 * cannot reach: that a person sitting in the data room has a control to do it
 * at all. `reachable` proves the procedure has A caller; only the browser proves
 * the caller is a control somebody can press.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

test('the data room can share a document with one plot’s buyer', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);

  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id as string;
  });

  await page.goto(`/deal/${id}/dataroom`);
  await expect(page.getByText('Buyer', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // one picker per document that actually exists — the control this test is about
  const pickers = page.locator('select[aria-label^="Share "]');
  await expect(pickers.first(), 'no buyer control in the data room at all').toBeVisible();

  const picker = pickers.first();
  const before = await picker.inputValue();
  const plots = await picker.locator('option').allTextContents();
  expect(plots, 'the picker offers no plot to share with').toContain('Plot 1');
  expect(plots[0], 'there is no way to stop sharing').toBe('Not shared');

  try {
    /**
     * Share it, then RELOAD before believing it. A select that only moves in the
     * browser is exactly the defect this whole commit is about — a control that
     * looks like it does something and reaches no server.
     */
    const plot2 = (await picker.locator('option', { hasText: 'Plot 2' }).getAttribute('value')) ?? '';
    expect(plot2, 'Plot 2 has no id to select').not.toBe('');
    await picker.selectOption(plot2);
    await expect(page.getByText('Shared with the buyer')).toBeVisible();
    await page.reload();
    await expect(
      page.locator('select[aria-label^="Share "]').first(),
      'the sharing choice did not survive a reload — it never reached the server',
    ).toHaveValue(plot2);

    // and withdrawing it is equally reachable, and equally persistent
    await page.locator('select[aria-label^="Share "]').first().selectOption('');
    await expect(page.getByText('No longer shared with a buyer')).toBeVisible();
    await page.reload();
    await expect(page.locator('select[aria-label^="Share "]').first()).toHaveValue('');
  } finally {
    // the demo workspace is shared — put the row back however this ends
    await page.locator('select[aria-label^="Share "]').first().selectOption(before).catch(() => {});
  }
});
