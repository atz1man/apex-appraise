import { expect, test } from '@playwright/test';

test('customer signup waits for email verification and reports unavailable delivery', async ({ page }) => {
  await page.route('**/trpc/org.register*', route => route.fulfill({ json: { result: { data: { json: {
    token: '', verificationRequired: true, emailSent: false,
    principal: { userId: 'pending', name: 'Customer', role: 'ADMIN', initials: 'CU', principalType: 'internal' },
  } } } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill('Customer firm');
  await page.getByLabel('Your name').fill('Customer Owner');
  await page.getByLabel('Email', { exact: true }).fill('customer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('could not send');
  await expect(page.getByText('your 14 days begin when you verify your email', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveValue('customer@example.test');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('verification requires an explicit click, reports expiry and permits a bounded resend request', async ({ page }) => {
  let attempts = 0;
  let sentToken = '';
  await page.route('**/trpc/auth.verifyEmail*', async route => {
    attempts++;
    const body = route.request().postDataJSON();
    sentToken = body['0'].json.token;
    await route.fulfill({ status: 400, json: { error: { json: { message: 'This verification link is invalid or has expired. Request a new link.', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400, path: 'auth.verifyEmail' } } } } });
  });
  await page.route('**/trpc/auth.resendVerification*', route => route.fulfill({ json: { result: { data: { json: { accepted: true } } } } }));
  await page.goto('/verify-email#token=synthetic-expired-link-for-ui');
  expect(attempts).toBe(0);
  await page.getByRole('button', { name: 'Verify email address', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
  expect(sentToken).toBe('synthetic-expired-link-for-ui');
  await page.getByLabel('Email address').fill('customer@example.test');
  await page.getByRole('button', { name: 'Request a new verification link' }).click();
  await expect(page.getByRole('status')).toContainText('If this address has a pending account');
  await expect(page.getByRole('status')).toContainText('three per 15 minutes');
});

test('verified email returns to sign-in without silently creating a session', async ({ page }) => {
  await page.route('**/trpc/auth.verifyEmail*', route => route.fulfill({ json: { result: { data: { json: { verified: true } } } } }));
  await page.goto('/verify-email#token=synthetic-valid-link-for-ui');
  await page.getByRole('button', { name: 'Verify email address', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your email is verified');
  await expect(page.getByRole('button', { name: 'Request a new verification link' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
