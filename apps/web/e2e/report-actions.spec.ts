import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools', { exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: /^Appraisal report/ });
  return (await link.getAttribute('href'))!;
}

test('PDF actions show progress, keep a failed download in the workfile and support retry', async ({ page }) => {
  const report = await login(page);
  await page.goto(report);
  await expect(page.locator('.a4-page').first()).toBeVisible();
  let respond!: () => void;
  await page.route('**/reports/**/appraisal.pdf?*', async (route) => {
    await new Promise<void>((resolve) => {
      respond = resolve;
    });
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Report rendering is busy — please try again shortly.' }),
    });
  });
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing PDF…', exact: true })).toBeDisabled();
  await expect.poll(() => typeof respond).toBe('function');
  respond();
  await expect(page.getByText('Report rendering is busy — please try again shortly.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(report + '$'));
  await page.unroute('**/reports/**/appraisal.pdf?*');
  await page.route('**/reports/**/appraisal.pdf?*', (route) =>
    route.fulfill({
      contentType: 'application/pdf',
      headers: { 'content-disposition': 'attachment; filename="appraisal-test.pdf"' },
      body: '%PDF-1.4\nFixture for download transport only',
    }),
  );
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('appraisal-test.pdf');
  await expect(page.getByText('PDF download started', { exact: true })).toBeVisible();
});

test('funding pack offers the same download and print actions', async ({ page }) => {
  await login(page);
  await page.goto('/portfolio/pack');
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to pipeline', exact: false })).toBeVisible();
});

test('report actions remain on screen on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const report = await login(page);
  await page.goto(report);
  const button = page.getByRole('button', { name: 'Download PDF', exact: true });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
