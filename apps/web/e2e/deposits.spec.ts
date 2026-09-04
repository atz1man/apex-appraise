import { expect, test } from '@playwright/test';

/**
 * The buyer's own screen has to add up.
 *
 * "Deposit held" is the developer's statement of how much of this buyer's money
 * they are holding. Directly beneath it the portal prints the receipts. Those
 * two came from different rules in different files, and measured on the demo
 * workspace they disagreed: "Deposit held £39,200", above a £2,000 reservation
 * fee and a £39,200 exchange deposit, both marked PAID. The buyer had paid
 * £41,200 and the reservation fee they paid in January had vanished from the
 * statement of their own money.
 *
 * This is the invariant, asserted where a person would notice it.
 */

const money = (text: string | null) => {
  const m = text?.match(/£([\d,]+)/);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
};

test('the deposit held equals the receipts the buyer can see', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Email').fill('buyer@demo.co.uk');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Harbour Reach').first()).toBeVisible();

  // the developer's statement of this buyer's money
  const heldRow = page.locator('div', { has: page.getByText('Deposit held', { exact: true }) }).last();
  await expect(heldRow).toBeVisible();
  const held = money(await heldRow.innerText());
  expect(held, 'no "Deposit held" figure on the page at all').toBeGreaterThan(0);

  // and the receipts underneath it — only the ones marked PAID: a pending row
  // is money that has not arrived, and counting it would make this pass on a
  // schedule that says nothing has been received
  const payments = page.locator('section', { has: page.getByRole('heading', { name: 'Payments' }) });
  await expect(payments).toBeVisible();
  /**
   * By name, not by shape. This used to be `h3 + div > div` — the rows are
   * whatever sits after the heading — and it returned nothing the moment that
   * heading became an `h2`, which it had to: the buyer portal had a single `h1`
   * and then every section marked `h3`, so its outline could not be navigated.
   *
   * A selector coupled to a heading LEVEL is coupled to a presentational
   * decision, and swapping it for one coupled to div nesting would only move
   * the coupling. The container says what it is now.
   */
  const rows = payments.getByTestId('payment-rows').locator('> div');
  const count = await rows.count();
  expect(count, 'the fixture should have payment rows to compare against').toBeGreaterThan(0);

  let paidTotal = 0;
  let paidRows = 0;
  for (let i = 0; i < count; i++) {
    const text = await rows.nth(i).innerText();
    if (!text.includes('PAID')) continue;
    paidRows += 1;
    paidTotal += money(text) ?? 0;
  }
  expect(paidRows, 'the fixture should have settled receipts').toBeGreaterThan(1);

  expect(
    held,
    `the developer says they hold £${held} while this buyer's ${paidRows} receipts total £${paidTotal}`,
  ).toBe(paidTotal);
});
