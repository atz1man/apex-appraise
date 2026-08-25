import { expect, test, type Page } from '@playwright/test';

/**
 * The terms of engagement form, saved twice by one person.
 *
 * The API side of this lock has its own tests. This exists for the OTHER half,
 * which is where `a48b7b3` found the real bug: the sales drawer re-read its
 * stamp from the list rather than from the save's own response, so the same
 * person's second edit was refused as a conflict with themselves. Removing the
 * line that keeps the stamp did NOT fail the API tests — the browser is the only
 * place that failure shows.
 *
 * So this saves twice with no reload in between. If the stamp is threaded
 * wrongly the second save fails, and the form the whole Red Book narrative is
 * checked against becomes one that cannot be edited twice in a sitting.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

/**
 * Its own deal, found or created — never one of the demo schemes.
 *
 * Saving terms on a shared deal is not a value change, it is the creation of an
 * EngagementTerms ROW where there was none, and `engagement.get` serves the
 * saved row in preference to the draft it builds from the firm's house style.
 * Pointed at Harbour Reach, this spec silently broke
 * "the terms document paginates to fit whatever house style a firm writes",
 * which changes the house style and expects to see it — measured: that spec
 * passes on a fresh seed, fails once this one has run, and passes again after
 * a reseed.
 *
 * The name is fixed rather than stamped, so repeated runs reuse one deal
 * instead of growing the pipeline a deal at a time.
 */
const NAME = 'E2E — terms lock';

const ownDeal = (page: Page) =>
  page.evaluate(async (name) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}` };
    const list = await (await fetch('/trpc/deals.list', { headers: auth })).json();
    const found = list.result.data.json.deals.find((d: { name: string }) => d.name === name);
    if (found) return found.id as string;
    const made = await (
      await fetch('/trpc/deals.create', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ json: { name, address: '1 Lock Street, Bristol', assetType: 'RESIDENTIAL' } }),
      })
    ).json();
    return made.result.data.json.id as string;
  }, NAME);

test('saves twice in a row without reloading', async ({ page }) => {
  await signIn(page);
  const id = await ownDeal(page);
  await page.goto(`/deal/${id}/engagement`);

  const purpose = page.getByLabel('Purpose of the valuation', { exact: true });
  await expect(purpose).toBeVisible();

  // a value unique to this run: the seed is shared with every other spec, and a
  // fixed one matches leftovers from a previous failure
  const stamp = `${Date.now()}`.slice(-6);
  const save = page.getByRole('button', { name: 'Save terms', exact: true });

  await purpose.fill(`Secured lending ${stamp}a`);
  await save.click();
  await expect(page.getByText('Terms saved')).toBeVisible();

  // no reload, no refetch waited on — exactly what a person editing does
  await purpose.fill(`Secured lending ${stamp}b`);
  await save.click();

  /**
   * Wait for a signal that can only follow a SUCCESSFUL save before asserting
   * the absence of a conflict — the button label flips to "Saved" when the
   * mutation resolves and the form goes clean.
   *
   * Asserting the absence straight after the click passed whatever happened: the
   * request had not come back yet, so the conflict message could not have been
   * on the page either way. An absence assertion that runs before the thing
   * could appear is not an assertion.
   */
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await expect(page.getByText(/after you opened it|Reload to see/i)).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel('Purpose of the valuation', { exact: true })).toHaveValue(`Secured lending ${stamp}b`);
});
