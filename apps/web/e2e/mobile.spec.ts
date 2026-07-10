import { expect, test } from '@playwright/test';
test.use({ viewport: { width: 390, height: 844 } });
test('field app runs full-bleed on a phone viewport', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  await page.goto('/field');
  // real product surface: appraisals dashboard visible, desktop demo chrome absent
  await expect(page.getByRole('heading', { name: 'Appraisals' })).toBeVisible();
  await expect(page.getByText('Field companion app — ships as the native mobile build')).toHaveCount(0);
  await expect(page.getByText('9:41')).toHaveCount(0); // no fake status bar on real phones
  // no horizontal page scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});


test('core screens have no horizontal scroll at phone width', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const noScroll = () =>
    // poll: loading skeletons may transiently overflow while chunks stream in
    expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 10_000 })
      .toBeLessThanOrEqual(0);
  await noScroll(); // hub
  await page.goto('/board');
  await expect(page.getByText('Northgate Trade & Industrial Park').first()).toBeVisible();
  await noScroll();
  await page.getByText('Northgate Trade & Industrial Park').first().click();
  await expect(page.getByText('Workfile', { exact: true })).toBeVisible();
  await noScroll(); // deal overview — rail stacked below content
  await page.getByRole('navigation').getByRole('link', { name: 'Appraisal', exact: true }).click();
  await expect(page.getByText('Unit schedule')).toBeVisible();
  await noScroll(); // appraisal — form grids collapsed
});
