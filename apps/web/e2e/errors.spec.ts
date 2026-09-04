import { expect, test } from '@playwright/test';

/**
 * One failure, one message.
 *
 * The app has a global MutationCache handler whose comment says "every failed
 * mutation surfaces as a toast — no more silent failures". It does its job. What
 * it did not account for is that react-query runs BOTH it and the mutation's own
 * onError, and that a screen may already be showing the failure where it
 * happened.
 *
 * So eleven mutations toasted their message and were toasted again by the cache,
 * and a dozen more rendered the error inline AND toasted the same sentence.
 * Measured in this browser before the fix: one refused invite, two identical
 * toasts.
 *
 * Both directions are held here, because fixing one by breaking the other is the
 * easy mistake: a failure with nowhere to appear must still toast.
 */

const signIn = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

/** Toasts are the only thing in the app using role=status. */
/**
 * Toasts by test id, not by `[role="status"]`.
 *
 * They used to carry that role individually, which is both the reason a screen
 * reader never announced them — a live region has to exist before the message
 * arrives — and the reason this selector was quietly ambiguous: `role="status"`
 * appears twelve times in the source on LOADING indicators. The "exactly one"
 * assertion below would have counted a skeleton as a toast the moment one was
 * on screen, and passed for the wrong reason whenever none was.
 */
const toasts = (page: import('@playwright/test').Page) => page.getByTestId('toast');

test('a failure with nowhere else to appear is toasted, once', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');

  // org.invite has no inline error surface, so the toast IS the message
  await page.getByRole('button', { name: /Invite teammate/i }).click();
  await page.getByLabel('Name', { exact: true }).fill('Duplicate Person');
  await page.getByLabel('Email', { exact: true }).fill('arthur@apexappraise.co.uk');
  await page.getByRole('button', { name: 'Send invite' }).click();

  await expect(toasts(page).first()).toContainText(/already exists/i);
  // and exactly one: the local handler used to say the same thing again
  await expect(toasts(page)).toHaveCount(1);
});

test('a failure the screen already shows is not also toasted', async ({ page }) => {
  await signIn(page);

  await page.goto('/board');
  await page.getByRole('link', { name: /Northgate/ }).first().click();
  await expect(page.getByText('Deal overview')).toBeVisible();

  /**
   * deals.update refuses a name over 120 characters, and the edit form prints
   * the refusal under itself. The button only guards against an EMPTY name, so
   * this reaches the server through the ordinary path a person would take.
   */
  await page.getByRole('button', { name: 'Edit details' }).click();
  const original = await page.getByLabel('Scheme name').inputValue();
  await page.getByLabel('Scheme name').fill('x'.repeat(200));
  await page.getByRole('button', { name: 'Save details' }).click();

  // shown where it happened…
  await expect(page.locator('.text-status-red').filter({ hasText: /./ }).first()).toBeVisible();
  // …and not a second time in the corner
  await expect(toasts(page)).toHaveCount(0);

  // leave the deal as it was found: other specs read this name
  await page.getByLabel('Scheme name').fill(original);
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();
});
