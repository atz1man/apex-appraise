import { expect, test } from '@playwright/test';

/**
 * The login page offers a demo login only where that login exists.
 *
 * It listed three demo accounts under "password 'demo'" and arrived with the
 * demo founder's email and that password already typed, on every deployment —
 * a firm's production sign-in advertising credentials for accounts the seed
 * had refused to create. The API half is in
 * `apps/api/test/login-demo-accounts.test.ts`; this is the page's half, driven
 * in both states because a page that ignored the answer and kept its list
 * passes the first state on its own.
 */
test('on a demo workspace the demo logins are offered and the first is prefilled', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Demo accounts · password “demo”')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('arthur@apexappraise.co.uk');
  await expect(page.getByLabel('Password')).toHaveValue('demo');
});

test('where the demo accounts do not exist, nothing is offered and nothing is typed for you', async ({ page }) => {
  await page.route('**/trpc/auth.demoAccounts*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const envelope = Array.isArray(body) ? body[0] : body;
    envelope.result.data.json = [];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByText(/Demo accounts/)).toHaveCount(0);
  await expect(page.getByText('arthur@apexappraise.co.uk')).toHaveCount(0);
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByLabel('Password')).toHaveValue('');
});
