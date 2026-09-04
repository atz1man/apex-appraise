import { expect, test, type Page } from '@playwright/test';

/**
 * A dialog holds on to the keyboard, and gives it back.
 *
 * `src/lib/dialogs.test.ts` proves every overlay DECLARES `role="dialog"` and
 * `aria-modal`. Declaring it is a claim; this is where it has to be true.
 * Before `useDialog` the app's one drawer primitive — opened from six screens —
 * did none of this: opening it left focus on the button behind the backdrop,
 * the first Tab walked out into a page greyed out and unusable, and Escape left
 * focus on `<body>`, so the next Tab restarted at the top of the document.
 */

async function loginInternal(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('a drawer takes focus, keeps it, and hands it back', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');

  const opener = page.getByRole('button', { name: 'New deal from documents' }).first();
  await opener.click();

  const drawer = page.getByRole('dialog', { name: 'New deal' });
  await expect(drawer).toBeVisible();

  // focus went IN — not left on the button now behind the backdrop
  const inside = await page.evaluate(() =>
    document.querySelector('[role="dialog"]')?.contains(document.activeElement),
  );
  expect(inside, 'the drawer opened and focus stayed on the page behind it').toBe(true);

  // and stays in: Tab all the way round the ring and past its end
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  const stillInside = await page.evaluate(() =>
    document.querySelector('[role="dialog"]')?.contains(document.activeElement),
  );
  expect(stillInside, 'Tab walked out of the drawer into the page behind the backdrop').toBe(true);

  // Escape closes it and focus comes back to what opened it
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});

test('the close control on a drawer is named, not a symbol', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByRole('button', { name: 'New deal from documents' }).first().click();

  // it reads "×" on screen, which a name check sees as a name and a screen
  // reader reads as "multiplication sign"
  const close = page.getByRole('button', { name: 'Close New deal' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.getByRole('dialog', { name: 'New deal' })).toBeHidden();
});

test('typing in a drawer does not throw the caret out of the field', async ({ page }) => {
  /**
   * The regression the trap itself invites. `onClose` is an inline arrow at
   * every call site, so its identity changes on every render of the screen
   * holding the drawer; with it in the effect's dependency list, the effect
   * tears down and sets up on every keystroke — and its teardown hands focus
   * back to the opener. One character typed, caret gone.
   *
   * A field that ends up holding what was typed into it is the only assertion
   * that proves focus stayed where the person put it, keystroke after
   * keystroke, so it is worth more here than any focus check.
   */
  await loginInternal(page);
  await page.goto('/board');
  await page.getByRole('button', { name: 'New deal from documents' }).first().click();

  const name = page.getByLabel('Deal name');
  await name.click();
  await page.keyboard.type('Foundry Lane');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Foundry Lane');
});
