import { expect, test } from '@playwright/test';

test('an administrator reviews two analyst versions without mixing their notes', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const analystContext = await browser.newContext();
  const analyst = await analystContext.newPage();
  try {
    await analyst.goto('/login');
    await analyst.getByLabel('Email', { exact: true }).fill('dana@apexappraise.co.uk');
    await analyst.getByLabel('Password', { exact: true }).fill('demo');
    await analyst.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(analyst.getByText('Deal tools')).toBeVisible();
    const dealId = await analyst.evaluate(async () => {
      const headers = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
      const call = async (path: string, json: unknown) => {
        const response = await fetch(`/trpc/${path}`, { method: 'POST', headers, body: JSON.stringify({ json }) });
        const body = await response.json();
        if (!body.result?.data) throw new Error(`${path}: ${body.error?.json?.message}`);
        return body.result.data.json;
      };
      const deal = await call('deals.create', { name: `Review notes ${Date.now()}`, address: 'Synthetic review site', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' });
      const input = {
        units: [{ label: 'flats', count: 4, area: 750, cap: 420 }], efficiency: 85,
        trades: [{ label: 'Build', rate: 110 }], profFeePct: 11, contingencyPct: 5, otherCosts: [],
        finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
        site: { mode: 'residual', landFixed: 0, acqPct: 6.8 }, disposal: { agentPct: 1.5, legalPct: 0.5 }, targetProfitOnGdvPct: 20,
      };
      await call('appraisal.save', { dealId: deal.id, input, label: 'Foundation review' });
      await call('appraisal.save', { dealId: deal.id, input: { ...input, contingencyPct: 7 }, label: 'Market review', asNewVersion: true });
      return deal.id;
    });
    await analyst.goto(`/deal/${dealId}/appraisal`);
    await analyst.getByRole('button', { name: /^Versions/ }).click();
    for (const label of ['Foundation review', 'Market review']) {
      const row = analyst.locator(`[data-version="${label}"]`);
      await row.getByRole('button', { name: 'Submit for review', exact: true }).click();
      await expect(row.getByText('IN REVIEW', { exact: true })).toBeVisible();
      await expect(row.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    }
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Deal tools')).toBeVisible();
    await page.goto(`/deal/${dealId}/appraisal`);
    await page.getByRole('button', { name: /^Versions/ }).click();
    const foundation = page.locator('[data-version="Foundation review"]');
    const market = page.locator('[data-version="Market review"]');
    const foundationNote = foundation.getByPlaceholder('Note — required when sending it back');
    const marketNote = market.getByPlaceholder('Note — required when sending it back');
    await expect(foundationNote).toHaveAccessibleName('Review note for Foundation review');
    await expect(marketNote).toHaveAccessibleName('Review note for Market review');
    await foundationNote.fill('Recheck foundation allowance');
    // This failed before the fix: both fields used one parent state value.
    await expect(marketNote).toHaveValue('');
    await marketNote.fill('Market evidence checked');
    await expect(foundationNote).toHaveValue('Recheck foundation allowance');
    await market.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(market.getByText('APPROVED', { exact: true })).toBeVisible();
    await expect(foundationNote).toHaveValue('Recheck foundation allowance');
    await foundation.getByRole('button', { name: 'Request changes', exact: true }).click();
    await expect(foundation.getByText('CHANGES REQUESTED', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^Versions/ }).click();
    await expect(foundation.getByText('Reviewer: “Recheck foundation allowance”', { exact: true })).toBeVisible();
    await expect(market.getByText('Reviewer: “Market evidence checked”', { exact: true })).toBeVisible();
    await expect(market.getByText(/their own work/)).toHaveCount(0);
    await analyst.reload();
    await analyst.getByRole('button', { name: /^Versions/ }).click();
    await expect(analyst.locator('[data-version="Foundation review"]').getByText('Reviewer: “Recheck foundation allowance”', { exact: true })).toBeVisible();
    await page.goto(`/deal/${dealId}/report`);
    await expect(page.locator('[data-approval-check]')).toHaveAttribute('data-approval-check', 'verified');
  } finally { await analystContext.close(); }
});
