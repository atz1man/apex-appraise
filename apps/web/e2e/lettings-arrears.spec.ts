import { expect, test, type Page } from '@playwright/test';

/**
 * Rent a tenant owes, from the screen that has to record it.
 *
 * `Tenancy.arrears` was readable in three places on this page — the KPI row, a
 * stat card and the drawer, each coloured GREEN at zero, which is not an
 * absence but an assertion that nothing is owed — and nothing in the product
 * could write it. `sales.deleteTenancy` then refuses a tenancy carrying arrears
 * with "Clear or write off the arrears first", an instruction that could not be
 * followed. Measured on the demo workspace: Apt 4 carries £1,425 and was
 * undeletable for ever.
 *
 * The API half is held in `apps/api/test/tenancy.test.ts`, including the reason
 * the field is optional rather than defaulted. This is the half that suite
 * cannot reach: whether the FORM actually sends it. A field that edits local
 * state and reaches no server looks identical in a typecheck, and is the same
 * defect one layer up — which is why this reloads before believing it.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

test('a letting agent can record that a tenant is behind', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);

  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    // the lettings scheme, not the sales one — Old Brewery Quarter is where the
    // seeded tenancies live, and Apt 4 is the one carrying arrears
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Old Brewery')).id as string;
  });

  /** the Lettings half of the screen — a tablist, not buttons */
  const openTenancy = async () => {
    await page.goto(`/deal/${id}/sales`);
    await page.getByRole('tab', { name: 'Lettings', exact: true }).click();
    await expect(page.getByText('Unit lettings tracker')).toBeVisible();
    // a row in the tracker, not a link — same as screens.spec.ts
    await page.getByText('Apt 4').first().click();
    await expect(page.getByText('Letting progression')).toBeVisible();
  };

  await openTenancy();
  const edit = page.getByRole('button', { name: 'Edit', exact: true }).first();
  const save = page.getByRole('button', { name: 'Save', exact: true });

  await edit.click();
  const arrears = page.getByLabel('Arrears (£)');
  await expect(arrears, 'the lettings form has no way to record arrears at all').toBeVisible();
  const before = await arrears.inputValue();

  /**
   * Save, then WAIT for the drawer to leave edit mode before navigating.
   *
   * The save is a mutation and `page.goto` immediately after the click can
   * abort it in flight — measured, and it fails looking exactly like the defect
   * this test is for, which is the worst way for a test to be wrong. The form
   * closing is the client's own signal that the mutation resolved.
   */
  const saveAndSettle = async () => {
    await save.click();
    await expect(page.getByLabel('Arrears (£)')).toBeHidden();
  };

  try {
    await arrears.fill('1234');
    await saveAndSettle();

    /**
     * Reload before believing it. A number typed into local state that never
     * reaches the server is exactly the defect being fixed, one layer up, and
     * it looks identical on screen until the page is asked again.
     */
    await openTenancy();
    await expect(
      page.getByText('£1,234').first(),
      'the arrears never reached the server — the field edits local state only',
    ).toBeVisible();

    /**
     * An edit that never touched the money must not write it off.
     *
     * This form sends `arrears` on EVERY save, so the server-side "a missing key
     * leaves the column alone" does not protect it here — what protects it is
     * the drawer loading the current figure when Edit is pressed. A mutation
     * making `openEdit` load 0 instead passed every other assertion in this
     * file: the number saves, reloads and clears correctly, and a letting agent
     * changing a tenant's NAME silently wipes the debt. So the ordinary edit is
     * the case that has to be driven.
     */
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const lead = page.getByLabel('Lead source');
    const leadBefore = await lead.inputValue();
    await lead.fill('Zoopla');
    await saveAndSettle();
    await openTenancy();
    await expect(
      page.getByText('£1,234').first(),
      'an edit that never mentioned the money wrote the debt off',
    ).toBeVisible();

    // and it can be cleared deliberately, which is what deleteTenancy tells the user to do
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await page.getByLabel('Lead source').fill(leadBefore);
    await page.getByLabel('Arrears (£)').fill('0');
    await saveAndSettle();
    await openTenancy();
    await expect(page.getByText('£1,234')).toHaveCount(0);
  } finally {
    // the demo workspace is shared — put the tenancy back however this ends
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click().catch(() => {});
    await page.getByLabel('Arrears (£)').fill(before || '0').catch(() => {});
    await saveAndSettle().catch(() => {});
  }
});
