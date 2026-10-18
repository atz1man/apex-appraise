import { expect, test } from '@playwright/test';

const answer = (available: boolean) => ({ result: { data: { json: { available } } } });

test('signup waits for availability, explains closure and can recover without a submission', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let checks = 0;
  let submissions = 0;
  await page.route('**/trpc/org.register*', route => { submissions++; return route.abort(); });
  await page.route('**/trpc/org.registrationAvailability*', async route => {
    checks++;
    if (checks === 1) await pending;
    return route.fulfill({ json: answer(checks > 1) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  try {
    await expect(page.getByRole('status')).toContainText('Checking signup availability');
    await expect(page.getByLabel('Organisation name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('status')).toContainText('temporarily unavailable');
  await expect(page.getByRole('link', { name: 'Sign in to an existing account' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('link', { name: 'Continue email verification' })).toHaveAttribute('href', '/verify-email');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Check signup availability again' }).click();
  await expect(page.getByLabel('Organisation name')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeEnabled();
  expect(submissions).toBe(0);
});

test('a failed availability check is not presented as a known closure and permits retry', async ({ page }) => {
  let checks = 0;
  await page.route('**/trpc/org.registrationAvailability*', route => {
    checks++;
    if (checks === 1) return route.fulfill({ status: 503, json: { error: { json: { message: 'Unavailable', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 503 } } } } });
    return route.fulfill({ json: answer(true) });
  });
  await page.goto('/register');
  await expect(page.getByRole('alert')).toContainText('could not check signup availability');
  await expect(page.getByText('New workspace signup is temporarily unavailable.', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('Email', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check signup availability again' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
