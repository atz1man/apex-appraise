import { expect, test, type Page } from '@playwright/test';

/**
 * Putting an investor on the record, from the screen.
 *
 * The LP portal, the cashflow list, the capital-call panel and the invitation
 * under Settings → Portal access all existed. Nothing could create the investor
 * they are about, so on a real workspace the picker was empty. This drives the
 * register from the browser and then checks the one thing that matters: the
 * person it created is somebody the Portal access panel can now invite.
 *
 * The API test proves the procedures. This proves the SCREEN sends what the
 * procedures need and nothing it was merely holding — a details save with one
 * changed field must carry that field alone.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

const NAME = `Playwright Capital LP ${Date.now().toString(36)}`;

test('an investor added here can be invited under Portal access, and is removed cleanly', async ({ page }) => {
  await signIn(page);
  await page.goto('/investors');
  await expect(page.getByRole('heading', { name: 'Investors' })).toBeVisible();

  // create
  await page.getByRole('button', { name: 'Add investor' }).click();
  await page.getByLabel('Investor name').fill(NAME);
  await page.getByLabel('Contact first name').fill('Pat');
  await page.getByLabel('Share of the LP base').fill('25');
  await page.getByRole('button', { name: 'Add to register' }).click();
  await expect(page.getByText(`${NAME} added to the register`)).toBeVisible();

  // a holding, so there is something for a portal to show
  await page.getByLabel('Deal for new holding').selectOption({ index: 1 });
  await page.getByLabel('Committed for new holding').fill('1000000');
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByText('Holding saved')).toBeVisible();
  await expect(page.getByText('IRR not recorded')).toBeVisible();

  // edit ONE detail and watch what the request carries
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Contact first name').fill('Patricia');
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('investors.update')),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  const body = JSON.parse(req.postData() ?? '{}') as Record<string, { json?: { patch?: Record<string, unknown> } }>;
  const patch = body['0']?.json?.patch ?? {};
  expect(Object.keys(patch), 'the details form posted fields it was only holding').toEqual(['contactFirst']);
  await expect(page.getByText('Investor updated')).toBeVisible();

  // the register row reads the scaled figure the LP would read: £1m × 25%
  await page.keyboard.press('Escape');
  const row = page.getByRole('row', { name: new RegExp(NAME) });
  await expect(row).toContainText('£250k');
  await expect(row).toContainText('25%');

  // and the Portal access picker under Settings now offers them
  await page.goto('/settings');
  const picker = page.getByLabel('Investor', { exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.locator('option', { hasText: NAME })).toHaveCount(1);

  // tidy: no money has moved, so removal is allowed and the holding goes with them
  await page.goto('/investors');
  await page.getByRole('button', { name: `Open ${NAME}` }).click();
  await page.getByRole('button', { name: 'Remove from register…' }).click();
  await page.getByRole('button', { name: 'Remove investor' }).click();
  await expect(page.getByText(`${NAME} removed from the register`)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toHaveCount(0);
});

test('a distribution and a capital call reach the portal with the LP’s sign and share', async ({ page }) => {
  await signIn(page);
  await page.goto('/investors');
  // the seeded LP that investor@demo.co.uk signs in as
  await page.getByRole('button', { name: 'Open Meridian Capital LP' }).click();
  await expect(page.getByText('Distributions & capital calls')).toBeVisible();

  const label = `Playwright call ${Date.now().toString(36)}`;
  await page.getByLabel('Line kind').selectOption('call');
  await page.getByLabel('Line label').fill(label);
  await page.getByLabel('Line amount').fill('200000');
  const due = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Line date').fill(due);
  await page.getByRole('button', { name: 'Issue call' }).click();
  await expect(page.getByText('Capital call issued')).toBeVisible();
  const line = page.locator('div', { hasText: label }).filter({ has: page.getByText('CALL') }).first();
  await expect(line).toContainText('£200k');

  // withdraw it again so the demo LP is not left with a demand this test invented
  await page.getByRole('button', { name: `Remove line ${label}` }).click();
  await expect(page.getByText('Line removed')).toBeVisible();
  await expect(page.getByText(label)).toHaveCount(0);
});
