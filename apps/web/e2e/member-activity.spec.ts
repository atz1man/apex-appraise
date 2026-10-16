import { expect, test } from '@playwright/test';

test('administrators can refresh recorded account sign-ins without claiming visitor identity', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('columnheader', { name: 'Recorded sign-ins', exact: true })).toBeVisible();
  await expect(page.getByText(/Recorded sign-ins identify accounts/)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'arthur@apexappraise.co.uk' });
  await expect(row.locator('time')).toBeVisible();
  await expect(row).toContainText(/\d+ recorded/);
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(row.locator('time')).toBeVisible();
  await page.route('**/trpc/org.members*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByText('Member activity could not be loaded. Refresh to try again.')).toBeVisible({ timeout: 15000 });
});
