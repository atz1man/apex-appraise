import { expect, test, type Page } from '@playwright/test';

/**
 * Per-screen happy-path coverage (BUILD_PLAN cross-cutting acceptance).
 * Assumes the dev stack is running with the seeded demo dataset.
 */

async function loginInternal(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

async function northgateId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', {
      headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
    });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });
}

test.describe('internal screens', () => {
  test.beforeEach(async ({ page }) => loginInternal(page));

  test('auto-appraisal generates an indicative result', async ({ page }) => {
    test.setTimeout(120_000); // live LLM extraction can take ~15-40s
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/auto`);
    await page.getByRole('button', { name: /Generate appraisal/ }).click();
    // live LLM extraction when ANTHROPIC_API_KEY is set takes ~15-40s; demo mode is instant
    await expect(page.getByText('Extracted accommodation')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Proceed|Caution|Decline/).first()).toBeVisible();
  });

  test('comparables derives a supported rate', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/comparables`);
    await expect(page.getByText('Sales comparison — adjustment grid')).toBeVisible();
    await expect(page.getByText('Weighted supported value')).toBeVisible();
  });

  test('scenarios compares three options with best-per-row', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/scenarios`);
    await expect(page.getByText('Compare scheme options').first()).toBeVisible();
    await expect(page.getByText('Option A — consented scheme').first()).toBeVisible();
    await expect(page.getByText('BEST').first()).toBeVisible();
  });

  test('cost monitoring shows variance rollup', async ({ page }) => {
    await page.goto('/board');
    await page.getByText('Harbour Reach').first().click();
    const url = page.url();
    const dealId = url.match(/deal\/([^/]+)/)![1];
    await page.goto(`/deal/${dealId}/costs`);
    await expect(page.getByText('Cost report — packages & contractors')).toBeVisible();
    await expect(page.getByText('Variance alerts')).toBeVisible();
  });

  test('sales CRM tracks units and opens the drawer', async ({ page }) => {
    await page.goto('/board');
    await page.getByText('Harbour Reach').first().click();
    const dealId = page.url().match(/deal\/([^/]+)/)![1];
    await page.goto(`/deal/${dealId}/sales`);
    await expect(page.getByText('Unit sales tracker')).toBeVisible();
    await page.getByText('Plot 3').first().click();
    await expect(page.getByText('Sales progression')).toBeVisible();
  });

  test('data room lists documents with extraction status', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/dataroom`);
    await expect(page.getByText('All documents').first()).toBeVisible();
    await expect(page.getByText('Recent activity')).toBeVisible();
  });

  test('benchmarking renders percentile strips', async ({ page }) => {
    await page.goto('/benchmarking');
    await expect(page.getByText('How your deals compare to the market')).toBeVisible();
    await expect(page.getByText('Build cost trend — £/ft²')).toBeVisible();
  });

  test('integrations catalogue with statuses', async ({ page }) => {
    await page.goto('/integrations');
    await expect(page.getByText('Connect your data sources')).toBeVisible();
    await expect(page.getByText('HM Land Registry')).toBeVisible();
    // self-serve key flow: Companies House opens a credentials drawer, not a demo connect
    await expect(page.getByText('Companies House')).toBeVisible();
    const chCard = page.locator('.rounded-card', { hasText: 'Companies House' }).first();
    await chCard.getByRole('button', { name: /Connect|Manage/ }).click();
    await expect(page.getByRole('heading', { name: 'Connect Companies House' })).toBeVisible();
    await expect(page.getByLabel('API key')).toBeVisible();
    // save is gated until a key is entered; escape closes without saving
    await expect(page.getByRole('button', { name: /Validate & connect|Replace key/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('API key')).toHaveCount(0);
  });

  test('workbench reconciles market value', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/workbench`);
    await expect(page.getByText('Valuation reconciliation')).toBeVisible();
  });

  test('appraisal report paginates A4 pages', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/report`);
    await expect(page.locator('.a4-page').first()).toBeVisible();
    expect(await page.locator('.a4-page').count()).toBeGreaterThanOrEqual(6);
  });

  test('red book report renders market value statement', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/redbook`);
    await expect(page.locator('.a4-page').first()).toBeVisible();
    await expect(page.getByText('Market Value').first()).toBeVisible();
    // comparable evidence page carries the adjustment ladder with the supported rate
    await expect(page.getByTestId('comps-ladder')).toBeVisible();
    await expect(page.getByTestId('comps-ladder').getByText(/Supported £\d+\/ft²/)).toBeVisible();
  });

  test('field app frames the mobile companion', async ({ page }) => {
    await page.goto('/field');
    await expect(page.getByText('Appraisals').first()).toBeVisible();
    await expect(page.getByText(/Field companion app/)).toBeVisible();
  });
});

test('landing page renders the marketing site', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.getByText('From the front door to the signed report — one workfile.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

test('buyer portal signs a document (persisted)', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Buyer portal/ }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Your new home at/)).toBeVisible();
  const signButtons = page.getByRole('button', { name: /Review & sign/ });
  if (await signButtons.count()) {
    await signButtons.first().click();
    await expect(page.getByText('SIGNED').first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('SIGNED').first()).toBeVisible(); // persisted, not local state
  }
});

test('public surface: SEO meta, share image, robots and branded 404', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /development appraisals/i);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', '/og.png');
  const og = await page.request.get('/og.png');
  expect(og.status()).toBe(200);
  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Disallow: /deal/');
  // branded 404 for signed-out visitors — no silent redirect
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByText('404')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apex Appraise home' })).toBeVisible();
});

test('landing product tour opens, steps through slides and closes', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('button', { name: /Watch the 60-second tour/ }).click();
  const tour = page.getByRole('dialog', { name: 'Product tour' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('One home for the whole workfile')).toBeVisible();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('Pipeline board')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tour.getByText('Development appraisal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
});

test('landing live engine card computes real figures as sliders move', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.getByText('Try the engine — live')).toBeVisible();
  const gdvBefore = await page.getByTestId('live-gdv').innerText();
  await page.getByLabel('Homes').fill('30');
  const gdvAfter = await page.getByTestId('live-gdv').innerText();
  expect(gdvAfter).not.toBe(gdvBefore);
  // engine sanity: 30 homes × 850ft² × £450 = £11.475m GDV (fM shows 1dp above £10m)
  expect(gdvAfter).toBe('£11.5m');
  await expect(page.getByText('Profit on cost', { exact: true })).toBeVisible();
  // feature mock peek opens the tour at the matching slide
  await page.getByRole('button', { name: /See Documents in\. Investment-grade appraisal out\. in the product/ }).click();
  const tour = page.getByRole('dialog', { name: 'Product tour' });
  await expect(tour.getByText('Development appraisal')).toBeVisible();
});
