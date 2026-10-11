import { expect, test } from '@playwright/test';

test('field companion keeps the chosen project and refreshes shared appraisal context', async ({ page, request }) => {
  test.setTimeout(90_000);
  const orgName = `Field context ${Date.now()}`;
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Your name').fill('Field Owner');
  await page.getByLabel('Email', { exact: true }).fill(`field-context-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));
  const rpc = async (route: string, input: unknown) => {
    const response = await request.post(`/trpc/${route}`, { headers: { authorization: `Bearer ${token}` }, data: { json: input } });
    expect(response.status()).toBe(200);
    return (await response.json()).result.data.json;
  };
  try {
    const first = await rpc('deals.create', { name: 'First project', address: 'Synthetic site A', assetType: 'RESIDENTIAL' });
    const second = await rpc('deals.create', { name: 'Chosen project', address: 'Synthetic site B', assetType: 'RESIDENTIAL' });
    const input = {
      units: [{ label: 'Flats', count: 4, area: 750, cap: 400 }], efficiency: 85,
      trades: [{ label: 'Build', rate: 110 }], profFeePct: 11, contingencyPct: 5, otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 }, disposal: { agentPct: 1.5, legalPct: 0.5 }, targetProfitOnGdvPct: 20,
    };
    await rpc('appraisal.save', { dealId: second.id, input, label: 'Desk initial' });
    await page.goto(`/deal/${second.id}/workbench`);
    await page.getByRole('link', { name: 'Field companion', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/field\\?dealId=${second.id}$`));
    const context = page.getByRole('region', { name: 'Project connection' });
    await expect(context).toContainText('belong to Chosen project');
    await expect(context.getByTestId('field-appraisal-context')).toContainText('Desk initial');
    await expect(context.getByRole('link', { name: 'Inspection workbench', exact: true })).toHaveAttribute('href', `/deal/${second.id}/workbench`);
    await expect(context.getByRole('link', { name: 'Project documents', exact: true })).toHaveAttribute('href', `/deal/${second.id}/dataroom`);
    await rpc('appraisal.save', { dealId: second.id, input: { ...input, contingencyPct: 7 }, label: 'Desk revision', asNewVersion: true });
    await context.getByRole('button', { name: 'Refresh project context' }).click();
    await expect(context.getByTestId('field-appraisal-context')).toContainText('Desk revision');
    await page.reload();
    await expect(context).toContainText('belong to Chosen project');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Field companion — mobile web workspace')).toHaveCount(0);
    await expect(context.getByRole('link', { name: 'Project overview', exact: true })).toBeVisible();
    const screenshot = test.info().outputPath('field-project-context.png');
    await context.screenshot({ path: screenshot });
    await test.info().attach('field-project-context', { path: screenshot, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Comparable sales', exact: true }).click();
    await expect(page.getByText('No valid coordinates to plot.', { exact: false })).toBeVisible();
    await expect(page.getByText(/local evidence/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review project comparables' })).toHaveAttribute('href', `/deal/${second.id}/comparables`);
    await page.goto(`/field?dealId=${first.id}`);
    await expect(context).toContainText('belong to First project');
    await expect(context.getByTestId('field-appraisal-context')).toHaveText('No appraisal saved yet');
    await expect(page.getByText('Desk revision')).toHaveCount(0);
    await page.goto('/field?dealId=unavailable-project');
    await expect(page.getByText('This project is unavailable in your workspace.')).toBeVisible();
    await expect(context).toHaveCount(0);
    await page.getByRole('button', { name: 'Choose a project' }).click();
    await expect(page.getByText('Chosen project', { exact: true })).toBeVisible();
  } finally { await rpc('org.deleteWorkspace', { confirmName: orgName }); }
});
