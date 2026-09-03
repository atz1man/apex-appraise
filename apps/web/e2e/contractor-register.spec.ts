import { expect, test, type Page } from '@playwright/test';

/**
 * Putting a contractor on the record, from the cost monitor.
 *
 * The cards and the per-package dropdown have rendered contractors for as long
 * as the screen has existed; nothing could create one. This adds one from the
 * screen, checks it is offered on a package, and removes it again.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

const NAME = `Playwright Groundworks ${Date.now().toString(36)}`;

test('a contractor added here is offered on every package, and can be removed while nothing is committed to it', async ({ page }) => {
  await signIn(page);
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id;
  });
  await page.goto(`/deal/${id}/costs`);

  await page.getByRole('button', { name: 'Add contractor' }).click();
  await page.getByLabel('Contractor name').fill(NAME);
  await page.getByLabel('Contractor trade').fill('Groundworks');
  await page.getByLabel('Day rate').fill('320');
  await page.getByLabel('Operatives').fill('4');
  await page.getByRole('button', { name: 'Add contractor', exact: true }).last().click();
  await expect(page.getByText(`${NAME} added`)).toBeVisible();

  // the card, with the day rate in pounds — not the pence the row holds
  const card = page.locator('div', { hasText: NAME }).filter({ has: page.getByText('Timesheets') }).first();
  await expect(card).toContainText('4 operatives × £320/day');

  // and the dropdown on a package now offers them
  const dropdown = page.locator('select[aria-label^="Contractor for"]').first();
  await expect(dropdown.locator('option', { hasText: NAME })).toHaveCount(1);

  // a patch: change the rate alone and the request carries the rate alone
  await page.getByRole('button', { name: `Edit ${NAME}` }).click();
  await page.getByLabel('Day rate').fill('340');
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('cost.updateContractor')),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  const body = JSON.parse(req.postData() ?? '{}') as Record<string, { json?: { patch?: Record<string, unknown> } }>;
  expect(Object.keys(body['0']?.json?.patch ?? {})).toEqual(['timesheetRate']);
  await expect(page.getByText(`${NAME} updated`)).toBeVisible();

  // tidy
  await page.getByRole('button', { name: `Edit ${NAME}` }).click();
  await page.getByRole('button', { name: 'Remove contractor…' }).click();
  await page.getByRole('button', { name: 'Remove contractor', exact: true }).click();
  await expect(page.getByText(`${NAME} removed`)).toBeVisible();
  await expect(dropdown.locator('option', { hasText: NAME })).toHaveCount(0);
});
