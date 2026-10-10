import { expect, test } from '@playwright/test';

test('signup guides a phone user to invalid fields and explains the trial', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await expect(page.getByText(/Start a 14-day trial/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Terms of service (new tab)' })).toHaveAttribute('href', '/terms');
  await expect(page.getByRole('link', { name: 'Privacy notice (new tab)' })).toHaveAttribute('href', '/privacy');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByLabel('Organisation name')).toBeFocused();
  await expect(page.getByLabel('Organisation name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Organisation name').fill('Customer workspace');
  await page.getByLabel('Your name').fill('Customer Owner');
  await page.getByLabel('Email', { exact: true }).fill('customer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('different-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByLabel('Confirm password')).toBeFocused();
  await expect(page.getByText('Passwords don’t match.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a rejected signup keeps the inputs and offers account recovery', async ({ page }) => {
  let attempts = 0;
  await page.route('**/trpc/org.register*', async (route) => {
    attempts++;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          json: {
            message: 'An account with this email already exists',
            code: -32009,
            data: { code: 'CONFLICT', httpStatus: 409, path: 'org.register' },
          },
        },
      }),
    });
  });
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill('Customer workspace');
  await page.getByLabel('Your name').fill('Customer Owner');
  await page.getByLabel('Email', { exact: true }).fill('customer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('An account with this email already exists')).toBeVisible();
  await expect(page.getByRole('link', { name: 'reset your password', exact: true })).toHaveAttribute('href', '/forgot');
  await expect(page.getByLabel('Organisation name')).toHaveValue('Customer workspace');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('customer@example.test');
  await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeEnabled();
  expect(attempts).toBe(1);
});

test('signup prevents repeat submissions while pending and recovers from a service failure', async ({ page }) => {
  let attempts = 0;
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/org.register*', async (route) => {
    attempts++;
    if (attempts === 1) await responseGate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          json: {
            message: 'Service temporarily unavailable. Please try again.',
            code: -32603,
            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 503, path: 'org.register' },
          },
        },
      }),
    });
  });
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill('Retry workspace');
  await page.getByLabel('Your name').fill('Customer Owner');
  await page.getByLabel('Email', { exact: true }).fill('retry@example.test');
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByLabel('Confirm password').press('Enter');
  try {
    await expect(page.getByRole('button', { name: 'Creating your workspace…', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByLabel('Confirm password')).toBeFocused();
    await expect.poll(() => attempts).toBe(1);
    await page.keyboard.press('Enter');
    expect(attempts).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByText('Service temporarily unavailable. Please try again.')).toBeVisible();
  await expect(page.getByLabel('Confirm password')).toBeFocused();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('retry@example.test');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.getByText('Service temporarily unavailable. Please try again.')).toBeVisible();
});


test('pasted email whitespace still discovers enforced single sign-on', async ({ page }) => {
  await page.route('**/trpc/auth.ssoAvailable*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ result: { data: { json: { sso: true, enforced: true } } } }),
  }));
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('  customer@example.test  ');
  await expect(page.getByRole('button', { name: 'Continue with single sign-on', exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
});
