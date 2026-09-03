import { expect, test, type Page } from '@playwright/test';

/**
 * The doors, clicked.
 *
 * `src/lib/route-reachable.test.ts` proves that a link to every route EXISTS in
 * the source. That is a weaker claim than it reads as, and this file is what
 * showed how much weaker: the commit that added the Hub's funding-pack tile
 * passed that sweep, and the tile named an icon the Hub's glyph table did not
 * have. `Icon` called `.split('|')` on `undefined`, React unmounted the tree,
 * and the home screen rendered as nothing — the door was in the source and
 * there was no house behind it. Twenty-one specs failed, every one of them at
 * `expect(getByText('Deal tools'))` on the way IN, so not one of them named the
 * screen that was broken or the line that broke it.
 *
 * A link literal is not a route a user can reach. These two tests are the
 * difference: sign in, click the thing, land on the page.
 */

async function loginInternal(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('the portfolio funding pack is reachable by clicking, from the Hub', async ({ page }) => {
  await loginInternal(page);

  // the tool grid renders at all — the icon table it indexes has every key it names
  const tile = page.getByRole('link', { name: /Portfolio funding pack/ });
  await expect(tile).toBeVisible();
  await tile.click();

  await expect(page).toHaveURL(/\/portfolio\/pack$/);
  // the pack itself, not its empty state: the demo workspace has schemes
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('Portfolio funding pack').first()).toBeVisible();
});

test('the API reference is reachable by clicking, from where a key is minted', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/settings');

  const link = page.getByRole('link', { name: 'Read the API reference' });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(/\/docs\/api$/);
  await expect(page.getByText('/api/v1').first()).toBeVisible();
});
