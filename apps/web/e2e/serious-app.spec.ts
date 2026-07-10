import { expect, test } from '@playwright/test';

/** New serious-app surfaces: registration, calendar, settings, deal overview, toasts. */

async function loginInternal(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('self-serve registration creates a fresh empty workspace', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Start your organisation' })).toBeVisible();
  await page.getByLabel(/Organisation name/i).fill(`E2E Dev Co ${stamp}`);
  await page.getByLabel(/Your name/i).fill('Erin Endtoend');
  await page.getByLabel(/^Email/i).fill(`e2e-${stamp}@test.co.uk`);
  await page.getByLabel(/^Password/i).fill('super-secret-9');
  await page.getByLabel(/Confirm password/i).fill('super-secret-9');
  await page.getByRole('button', { name: /Create|Start/ }).click();
  // lands on the Hub of a brand-new org: onboarding CTA, empty pipeline, zero rollup
  await expect(page.getByText('Add your first deal')).toBeVisible();
  await page.getByRole('link', { name: /New deal from documents/ }).click();
  await expect(page.getByText('Your pipeline is empty')).toBeVisible();
  // no seeded deals leak across orgs
  await expect(page.getByText('Northgate Trade & Industrial Park')).toHaveCount(0);
});

test('calendar shows org tasks and creates a new one', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar & tasks' })).toBeVisible();
  await expect(page.getByText('Resolve steel package +£150k overspend')).toBeVisible();
  const title = `E2E follow-up ${Date.now()}`;
  await page.getByPlaceholder(/Add a task/i).fill(title);
  await page.getByRole('button', { name: /^Add/ }).click();
  await expect(page.getByText(title).first()).toBeVisible();
});

test('deal overview shows KPIs, workfile and lifecycle', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByText('Harbour Reach').first().click();
  await expect(page.getByText('Workfile')).toBeVisible();
  await expect(page.getByText('Construction cost health')).toBeVisible();
  await expect(page.getByText('Sales health')).toBeVisible();
  // deal nav jumps tools without going back to the board
  await page.getByRole('navigation').getByRole('link', { name: 'Costs' }).click();
  await expect(page.getByText('Cost report — packages & contractors')).toBeVisible();
});

test('settings: org panel, members, invite (admin)', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/settings');
  await expect(page.getByText('Workspace settings')).toBeVisible();
  await expect(page.getByText('arthur@apexappraise.co.uk')).toBeVisible();
  // invite flow returns a one-time temp password
  await page.getByRole('button', { name: /Invite teammate/i }).click();
  const stamp = Date.now();
  await page.getByLabel('Name', { exact: true }).fill('Temp Analyst');
  await page.getByLabel('Email', { exact: true }).fill(`temp-${stamp}@apexappraise.co.uk`);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(/won.t be shown again/i)).toBeVisible();
});

test('site pack renders with live-data controls and provenance', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByText('Northgate Trade & Industrial Park').first().click();
  await page.getByRole('navigation').getByRole('link', { name: 'Site pack' }).click();
  await expect(page.getByRole('heading', { name: 'Site pack' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pull live data/ })).toBeVisible();
  // provenance + sources are always declared, whatever the upstream returned
  await expect(page.getByText(/HM Land Registry/).first()).toBeVisible();
  await expect(page.getByText(/planning\.data\.gov\.uk/).first()).toBeVisible();
  // real Leaflet/OSM map renders once the live data lands (subject pin at minimum)
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
});

test('appraisal versions: save, list with figures, restore', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByText('Northgate Trade & Industrial Park').first().click();
  await page.getByRole('navigation').getByRole('link', { name: 'Appraisal', exact: true }).click();
  await expect(page.getByText('Unit schedule')).toBeVisible();
  // engine-depth rail: Monte Carlo risk panel renders with percentiles
  await expect(page.getByText('Risk — Monte Carlo')).toBeVisible();
  await expect(page.getByText(/P50 /)).toBeVisible();
  await expect(page.getByText('Prob ≥ target profit')).toBeVisible();
  // ensure a current version exists, then snapshot a labelled version
  await page.getByRole('button', { name: /Versions/ }).click();
  const label = `e2e-${Date.now()}`;
  await page.getByPlaceholder(/Label this version/).fill(label);
  await page.getByRole('button', { name: 'Save as version' }).click();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText('CURRENT').first()).toBeVisible();
  // an older version exposes restore
  await expect(page.getByRole('button', { name: 'Restore as current' }).first()).toBeVisible();
});

test('appraisal exports a real .xlsx workbook', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByText('Northgate Trade & Industrial Park').first().click();
  await page.getByRole('navigation').getByRole('link', { name: 'Appraisal', exact: true }).click();
  await expect(page.getByText('Unit schedule')).toBeVisible();
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export .xlsx' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/Appraisal\.xlsx$/);
});

test('billing panel shows plan tiers with Stripe checkout', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/settings');
  await expect(page.getByText('Billing & plan')).toBeVisible();
  await expect(page.getByText('Starter', { exact: true })).toBeVisible();
  await expect(page.getByText('Growth', { exact: true })).toBeVisible();
  await expect(page.getByText('Enterprise', { exact: true })).toBeVisible();
  // configured sandbox shows test-mode chip and subscribe CTAs for admins
  await expect(page.getByText('STRIPE TEST MODE')).toBeVisible();
  await expect(page.getByRole('button', { name: /Subscribe|Switch plan/ }).first()).toBeVisible();
});

test('global nav present for internal, absent for portals', async ({ page }) => {
  await loginInternal(page);
  await expect(page.getByRole('navigation', { name: 'Global' })).toBeVisible();
  // investor portal must not expose internal navigation
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: /Investor portal/ }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Good (morning|afternoon|evening), Lena/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Global' })).toHaveCount(0);
});
