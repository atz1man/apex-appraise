import { expect, test } from '@playwright/test';

/**
 * A valuer's first deal, made through the drawer, reaches a site pack that
 * knows where the site is.
 *
 * Measured on a fresh workspace: the New deal drawer had no postcode field and
 * `deals.create` dropped one if sent, so every new deal's site pack opened on
 * "No postcode on this deal yet — enter the site postcode above". The map, the
 * site pack and the benchmark region all read that column; a deal without it
 * is a deal the product cannot place.
 */
test('a deal created through the drawer with a postcode has a site pack that does not ask for one', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  await page.goto('/board');
  await page.getByRole('button', { name: 'New deal from documents' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'New deal' });
  await expect(drawer).toBeVisible();
  const name = `Drawer Site ${Date.now()}`;
  await drawer.getByLabel('Deal name').fill(name);
  await drawer.getByLabel('Address').fill('3 Quay Road, Poole');
  await drawer.getByLabel('Postcode').fill('bh15 1jf');
  await drawer.getByRole('button', { name: 'Create & appraise from documents' }).click();
  await page.waitForURL(/\/deal\/[^/]+\/auto$/);
  const dealId = page.url().match(/\/deal\/([^/]+)\//)![1];

  await page.goto(`/deal/${dealId}/sitepack`);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await expect(page.getByText('No postcode on this deal yet')).toHaveCount(0);
  // the postcode entered is the postcode shown, whatever case it was typed in
  await expect(page.getByText(/BH15 1JF/i).first()).toBeVisible();
});
