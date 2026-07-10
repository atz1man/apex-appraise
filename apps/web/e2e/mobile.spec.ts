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
