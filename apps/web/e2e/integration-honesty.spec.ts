import { expect, test, type Page } from '@playwright/test';

/**
 * A green dot is a claim about a capability.
 *
 * `integrations.connect` was an upsert that set `status: 'CONNECTED'` and
 * `lastSync: new Date()` for any of the ten provider names, with no credential,
 * no handshake and no request leaving the building. So this screen — whose whole
 * purpose is to tell a paying customer what works — read "Connected · Synced just
 * now" for four providers nothing in the codebase can contact, and the demo seed
 * marked Ordnance Survey CONNECTED, which is the one workspace anyone can try.
 *
 * The server refuses them now. This is the half that counts what is RENDERED: a
 * card with no connector offers no button, because a control that exists to be
 * rejected is worse than no control, and it says what does the job instead,
 * because a dead end with no alternative is worse than the claim it replaces.
 */

const NO_CONNECTOR = ['Ordnance Survey', 'BCIS cost data', 'DocuSign', 'PriceHubble AVM'];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('a provider with no connector offers nothing and says what to use instead', async ({ page }) => {
  await signIn(page);
  await page.goto('/integrations');
  await expect(page.getByText('Connect your data sources')).toBeVisible();

  for (const name of NO_CONNECTOR) {
    const card = page.locator('.rounded-card', { hasText: name }).first();
    await expect(card, `${name} has no card`).toBeVisible();
    await expect(card.getByText('No connector'), `${name} does not say it has no connector`).toBeVisible();
    await expect(
      card.getByRole('button', { name: /Connect|Reconnect|Manage|Sync to deal/ }),
      `${name} offers a control the server refuses`,
    ).toHaveCount(0);
    // and it is never green, whatever a row left over from before says
    await expect(card.getByText('Connected', { exact: true })).toHaveCount(0);
  }
});

test('a provider with a connector still offers one, and names what it feeds', async ({ page }) => {
  await signIn(page);
  await page.goto('/integrations');
  const lr = page.locator('.rounded-card', { hasText: 'HM Land Registry' }).first();
  await expect(lr.getByText(/Feeds /)).toBeVisible();
  /**
   * Both directions on the same screen. A walk that only checked the refusals
   * would pass on a screen where every card had lost its button.
   */
  await expect(lr.getByRole('button', { name: /Connect|Manage|Sync to deal/ }).first()).toBeVisible();
});
