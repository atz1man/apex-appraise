import { expect, test } from '@playwright/test';

/**
 * Golden-path e2e: login → hub → pipeline board → development appraisal
 * (engine figures render) → save. Assumes the dev stack is running
 * (API :4100 seeded, web :5273).
 */
test('internal team golden path', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'One connected workfile' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Hub with live portfolio rollup
  await expect(page.getByText('Deal tools')).toBeVisible();
  await expect(page.getByText('Pipeline GDV')).toBeVisible();

  // Pipeline board
  await page.getByRole('link', { name: /Pipeline board/ }).click();
  await expect(page.getByText('Sourcing')).toBeVisible();
  await expect(page.getByText('Northgate Trade & Industrial Park').first()).toBeVisible();

  /**
   * Deal overview. Clicked as the LINK it is, not as loose text: the board
   * re-sorts when any deal's headline figures change, and another test saving an
   * appraisal can move a card between the hit-test and the click. A role locator
   * is re-resolved on the retry; a text node in a re-ordering list is not.
   */
  await page.getByRole('link', { name: /Northgate Trade & Industrial Park/ }).first().click();
  await expect(page).toHaveURL(/\/deal\//);
  await expect(page.getByText('Workfile')).toBeVisible();
  await expect(page.getByRole('button', { name: /Advance stage/ })).toBeVisible();

  // Development appraisal via the deal nav — engine figures
  await page.getByRole('navigation').getByRole('link', { name: 'Appraisal', exact: true }).click();
  await expect(page.getByText('Unit schedule')).toBeVisible();
  await expect(page.getByText('Return on cost')).toBeVisible();
  await expect(page.getByText(/Viable · RoC/)).toBeVisible();

  // JV waterfall renders on the Returns tab
  await page.getByRole('button', { name: 'Returns' }).click();
  await expect(page.getByText('Equity waterfall — four tiers')).toBeVisible();
  await expect(page.getByText('LP (investors)')).toBeVisible();
});

test('portal isolation: investor sees only their scaled position', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Investor portal/ }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Good (morning|afternoon|evening), Lena/)).toBeVisible();
  await expect(page.getByText('Viewing as')).toHaveCount(0); // no internal switcher
  await expect(page.getByText('55% share of the LP base')).toBeVisible();
});
