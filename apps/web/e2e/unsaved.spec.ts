import { expect, test, type Page } from '@playwright/test';

/**
 * Leaving a screen that holds unsaved work.
 *
 * `src/lib/unsaved.test.ts` proves the decision — which clicks are worth
 * interrupting — at its boundaries. This is the half a unit test cannot reach:
 * that the interception actually happens, in the capture phase, before React
 * Router routes the click; that saying no leaves the work where it was; and
 * that saying yes still lets a person leave.
 *
 * `beforeunload` is deliberately not tested here. It is the browser's own
 * prompt on tab close and reload, it cannot be worded or styled, and Playwright
 * dismisses it — which for `beforeunload` means "leave", so a spec would assert
 * nothing about it.
 *
 * The appraisal is never saved by this file, so nothing it types reaches the
 * database. It shares the Kingsway fixture with `mezzanine.spec.ts`, which is
 * safe in both directions precisely because only that one writes.
 */

async function openDirtyAppraisal(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id as string;
  });

  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const rate = page.getByLabel('Mezzanine rate');
  await expect(rate).toBeVisible();

  const save = page.getByRole('button', { name: /^Save appraisal$|^Saved$/ }).last();
  // alternated, not fixed: re-typing the same value is no change and the
  // screen never becomes dirty, so a second run would test nothing
  const before = await rate.inputValue();
  const typed = before === '14.25' ? '13.75' : '14.25';
  await rate.fill(typed);
  await expect(save, 'the appraisal did not become dirty, so nothing here is being tested').toHaveText('Save appraisal');
  return { id, rate, save, typed };
}

test('saying no to the prompt leaves the work exactly where it was', async ({ page }) => {
  // 1440 so the global nav is in the sticky header — below 1400 it is hidden
  await page.setViewportSize({ width: 1440, height: 900 });
  const { id, rate, save, typed } = await openDirtyAppraisal(page);

  // Playwright dismisses a dialog by default, so this click IS a person
  // clicking a link and then deciding not to lose their afternoon
  await page.getByRole('navigation', { name: 'Global' }).getByRole('link', { name: 'Pipeline' }).click();

  await expect(page, 'the click navigated away from unsaved work').toHaveURL(new RegExp(`/deal/${id}/appraisal$`));
  await expect(rate, 'the typed value did not survive the refusal').toHaveValue(typed);
  await expect(save, 'the appraisal stopped being dirty without being saved').toHaveText('Save appraisal');
});

test('saying yes still lets you leave', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDirtyAppraisal(page);

  // a guard nobody can get past is not a guard, it is a trap
  page.once('dialog', (d) => d.accept());
  await page.getByRole('navigation', { name: 'Global' }).getByRole('link', { name: 'Pipeline' }).click();

  await expect(page).toHaveURL(/\/board$/);
  await expect(page).toHaveTitle('Pipeline board · Apex Appraise');
});

test('a clean appraisal is never interrupted', async ({ page }) => {
  /**
   * The half that decides whether the prompt gets read. A product that asks
   * when nothing is at stake teaches people to dismiss without looking, which
   * disarms it on the one occasion it matters.
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id as string;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await expect(page.getByRole('navigation', { name: 'Global' })).toBeVisible();

  // nothing typed, so nothing to lose — and the dialog stays dismissed, which
  // would keep us here if the guard fired
  await page.getByRole('navigation', { name: 'Global' }).getByRole('link', { name: 'Pipeline' }).click();
  await expect(page).toHaveURL(/\/board$/);
});
