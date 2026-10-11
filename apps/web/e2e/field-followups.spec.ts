import { test, expect } from '@playwright/test';

test('saved field observations become reviewed project tasks and calendar completion returns to the field', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const orgName = `Field follow-ups ${Date.now()}`;
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Your name').fill('Field Owner');
  await page.getByLabel('Email', { exact: true }).fill(`followups-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));
  const rpc = async (route: string, input: unknown) => {
    const result = await request.post(`/trpc/${route}`, { headers: { authorization: `Bearer ${token}` }, data: { json: input } });
    expect(result.status()).toBe(200);
    return (await result.json()).result.data.json;
  };
  const query = async (route: string, input: unknown) => {
    const result = await request.get(`/trpc/${route}`, { headers: { authorization: `Bearer ${token}` }, params: { input: JSON.stringify({ json: input }) } });
    expect(result.status()).toBe(200);
    return (await result.json()).result.data.json;
  };
  try {
    const deal = await rpc('deals.create', { name: 'Follow-up project', address: 'Synthetic site', assetType: 'RESIDENTIAL' });
    const other = await rpc('deals.create', { name: 'Other project', address: 'Synthetic site B', assetType: 'RESIDENTIAL' });
    await rpc('inspections.save', { dealId: deal.id, rooms: [{ name: 'Exterior', condition: 2, photos: [], notes: 'Crack beside the entrance; investigate before valuation.' }], reconciledValue: null, approachWeights: { salesComparison: 60, cost: 20, income: 20 }, status: 'draft' });
    await page.goto(`/field?dealId=${deal.id}`);
    const panel = page.getByRole('region', { name: 'Field follow-ups', exact: true });
    await expect(panel).toContainText('Crack beside the entrance');
    // Unsaved edits must not be represented as saved evidence for a follow-up.
    await page.getByRole('button', { name: 'Continue inspection', exact: true }).click();
    await page.getByLabel('Notes for Exterior').fill('Unreviewed local observation');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(panel).not.toContainText('Unreviewed local observation');
    await panel.getByRole('button', { name: 'Review follow-up for Exterior', exact: true }).click();
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(/Crack beside/);
    const title = 'Arrange structural review of entrance crack';
    await panel.getByLabel('Follow-up title').fill(title);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Continue inspection', exact: true }).click();
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(title);
    // A refused create must keep the reviewed text and allow a deliberate retry.
    await page.route('**/trpc/tasks.create*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await panel.getByRole('button', { name: 'Create project follow-up', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('could not be confirmed');
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(title);
    expect(await query('tasks.list', { dealId: deal.id })).toEqual([]);
    await page.unroute('**/trpc/tasks.create*');
    await panel.getByRole('button', { name: 'Create project follow-up', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Follow-up created');
    const taskRow = panel.getByRole('listitem').filter({ hasText: title });
    await expect(taskRow).toContainText('Open');
    const saved = await query('tasks.list', { dealId: deal.id, aspect: 'Field inspection' });
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe(title);
    expect(saved[0].assignee).toBe('FO');
    expect(await query('tasks.list', { dealId: other.id })).toEqual([]);
    expect(await query('appraisal.getCurrent', deal.id)).toBeNull();
    // An exact duplicate open title is flagged before another submit.
    await panel.getByRole('button', { name: 'Review follow-up for Exterior', exact: true }).click();
    await panel.getByLabel('Follow-up title').fill(title);
    await expect(panel.getByRole('button', { name: 'Create project follow-up', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: 'Cancel follow-up', exact: true }).click();
    await panel.getByRole('link', { name: 'Open task calendar', exact: true }).click();
    await page.getByRole('button', { name: 'Complete task', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen task', exact: true })).toBeVisible();
    await page.goto(`/field?dealId=${deal.id}`);
    await expect(taskRow).toContainText('Completed');
    await taskRow.getByRole('button', { name: 'Reopen follow-up', exact: true }).click();
    await expect(taskRow).toContainText('Open');
    await panel.screenshot({ path: test.info().outputPath('field-followups-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto(`/field?dealId=${other.id}`);
    await expect(panel).toContainText('No field follow-ups for this project yet');
    await expect(panel).not.toContainText(title);
    // Failed reads must not be presented as an empty project.
    await page.route('**/trpc/**', route => route.request().url().includes('tasks.list') ? route.abort() : route.continue());
    await page.reload();
    await expect(panel).toContainText('Follow-ups could not be loaded');
    await expect(panel).not.toContainText('No field follow-ups for this project yet');
    await page.unroute('**/trpc/**');
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await expect(panel).toContainText('No field follow-ups for this project yet');
  } finally { await rpc('org.deleteWorkspace', { confirmName: orgName }); }
});
