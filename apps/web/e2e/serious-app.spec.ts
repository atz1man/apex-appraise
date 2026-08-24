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
  // activation checklist starts from zero on a fresh workspace
  await expect(page.getByTestId('getting-started-progress')).toHaveText('0 of 5 done');
  /**
   * This now opens the deal form immediately rather than merely navigating to the
   * board — the CTA used to land on a page offering the same button again. A user
   * who changes their mind closes it, which is what happens here before checking
   * the empty pipeline behind it.
   */
  await page.getByRole('link', { name: /New deal from documents/ }).click();
  await expect(page.getByText('New deal', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Your pipeline is empty')).toBeVisible();
  // no seeded deals leak across orgs
  await expect(page.getByText('Northgate Trade & Industrial Park')).toHaveCount(0);
  // one-click sample deal fills the workfile and lands on the deal overview
  await page.getByRole('button', { name: 'Explore with a sample deal' }).click();
  await expect(page.getByText('Sample — Kingfisher Wharf').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Workfile', { exact: true })).toBeVisible();
  // the sample deal auto-completes four checklist steps (deal, appraisal, docs, comps)
  await page.goto('/');
  await expect(page.getByTestId('getting-started-progress')).toHaveText('4 of 5 done');
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
  await page.getByRole('link', { name: /Harbour Reach/ }).first().click();
  await expect(page.getByText('Workfile')).toBeVisible();
  await expect(page.getByText('Construction cost health')).toBeVisible();
  await expect(page.getByText('Sales health')).toBeVisible();
  // health panels carry the mini-charts: per-package variance strip + GDV velocity
  await expect(page.getByTestId('cost-variance-strip')).toBeVisible();
  await expect(page.getByTestId('sales-velocity')).toBeVisible();
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
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  /**
   * And out again. A members table you can only add to is how a firm ends up
   * paying for people who left — and it is also why this test used to leave a
   * new analyst in the seed database on every run.
   */
  const row = page.getByRole('row', { name: /Temp Analyst/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Remove…' }).click();
  await row.getByRole('button', { name: 'Remove Temp' }).click();
  await expect(page.getByRole('row', { name: /Temp Analyst/ })).toHaveCount(0);
});

test('site pack renders with live-data controls and provenance', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByRole('link', { name: /Northgate Trade \& Industrial Park/ }).first().click();
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
  await page.getByRole('link', { name: /Northgate Trade \& Industrial Park/ }).first().click();
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
  await page.getByRole('link', { name: /Northgate Trade \& Industrial Park/ }).first().click();
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
  // The tiers are account information and render with or without a payment
  // processor, so this half holds everywhere — including CI, which has no keys.
  await expect(page.getByText('Starter', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Growth', { exact: true })).toBeVisible();
  await expect(page.getByText('Enterprise', { exact: true })).toBeVisible();
  // and the allowance is shown whether or not billing is wired up
  await expect(page.getByText('Team members', { exact: true })).toBeVisible();

  /**
   * The checkout half needs a real Stripe key, which CI does not have. Asked of
   * the APP rather than of an env var: the test cannot see the server's
   * configuration, and skipping on a variable it cannot read would make this pass
   * for the wrong reason on a machine that does have a key.
   */
  const stripeConfigured = await page.getByText('STRIPE TEST MODE').count();
  if (!stripeConfigured) {
    await expect(page.getByText(/Stripe isn't configured on this server/)).toBeVisible();
    // the plans are still shown, and the limits still bite
    await expect(page.getByText(/Plan limits still apply/)).toBeVisible();
    return;
  }
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

test('data & privacy: export, audit trail, and full workspace deletion', async ({ page }) => {
  // Throwaway org so the deletion path is exercised for real without touching the seed
  const stamp = Date.now();
  const orgName = `E2E Erasure Co ${stamp}`;
  await page.goto('/register');
  await page.getByLabel(/Organisation name/i).fill(orgName);
  await page.getByLabel(/Your name/i).fill('Erin Eraser');
  await page.getByLabel(/^Email/i).fill(`erase-${stamp}@test.co.uk`);
  await page.getByLabel(/^Password/i).fill('super-secret-9');
  await page.getByLabel(/Confirm password/i).fill('super-secret-9');
  await page.getByRole('button', { name: /Create|Start/ }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByText('Data & privacy')).toBeVisible();

  // GDPR export downloads a JSON file
  const downloadP = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download export' }).click();
  const download = await downloadP;
  expect(download.suggestedFilename()).toMatch(/apex-appraise-export-.*\.json/);

  // Audit trail records the export
  await page.getByRole('button', { name: 'View audit trail' }).click();
  await expect(page.getByText('exported workspace data')).toBeVisible();

  // Danger zone: wrong name keeps the button disabled; exact name deletes and signs out
  await page.getByRole('button', { name: 'Delete workspace…' }).click();
  await page.getByLabel(/to confirm/i).fill('wrong name');
  await expect(page.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();
  await page.getByLabel(/to confirm/i).fill(orgName);
  await page.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(page).toHaveURL(/welcome/, { timeout: 15_000 });
});

test('appraisal charts: cashflow J-curve and profit bridge render from the engine', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByRole('link', { name: /Northgate Trade \& Industrial Park/ }).first().click();
  await page.getByRole('navigation').getByRole('link', { name: 'Appraisal', exact: true }).click();
  await expect(page.getByText('Unit schedule')).toBeVisible();
  await page.getByText('Cashflow', { exact: true }).first().click();
  await expect(page.getByTestId('cashflow-chart')).toBeVisible();
  await expect(page.getByTestId('cashflow-chart').getByText(/Peak debt £/)).toBeVisible();
  await page.getByText('Returns', { exact: true }).first().click();
  await expect(page.getByTestId('profit-bridge')).toBeVisible();
  await expect(page.getByTestId('bridge-profit')).toHaveText(/£/);
});

test('sales velocity chart shows cumulative GDV secured vs appraised', async ({ page }) => {
  await loginInternal(page);
  await page.goto('/board');
  await page.getByRole('link', { name: /Harbour Reach/ }).first().click();
  await page.getByRole('navigation').getByRole('link', { name: 'Sales', exact: true }).click();
  await expect(page.getByText('Unit sales tracker')).toBeVisible();
  await expect(page.getByTestId('sales-velocity')).toBeVisible();
  await expect(page.getByTestId('velocity-secured')).toHaveText(/£/);
});
