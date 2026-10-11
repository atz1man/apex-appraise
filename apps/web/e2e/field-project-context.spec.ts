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

for (const surface of ['field', 'workbench'] as const) test(`${surface} refresh cannot give an edited inspection a newer save stamp`, async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const orgName = `Field conflict ${Date.now()}`;
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Your name').fill('Field Owner');
  await page.getByLabel('Email', { exact: true }).fill(`field-conflict-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));
  const rpc = async (route: string, input: unknown) => {
    const r = await request.post(`/trpc/${route}`, { headers: { authorization: `Bearer ${token}` }, data: { json: input } });
    expect(r.status()).toBe(200);
    return (await r.json()).result.data.json;
  };
  try {
    const deal = await rpc('deals.create', { name: 'Shared inspection', address: 'Synthetic site', assetType: 'RESIDENTIAL' });
    const original = { dealId: deal.id, rooms: [{ name: 'Exterior', condition: 3, photos: [], notes: 'Initial observation' }], reconciledValue: null, approachWeights: { salesComparison: 60, cost: 20, income: 20 }, status: 'draft' };
    const first = await rpc('inspections.save', original);
    await page.goto(surface === 'field' ? `/field?dealId=${deal.id}` : `/deal/${deal.id}/workbench`);
    if (surface === 'field') await page.getByRole('button', { name: 'Continue inspection', exact: true }).click();
    const notes = surface === 'field' ? page.getByLabel('Notes for Exterior') : page.getByRole('spinbutton', { name: /^Weight/ }).first();
    await expect(notes).toHaveValue(surface === 'field' ? 'Initial observation' : '60');
    const draft = surface === 'field' ? 'Unreviewed field draft' : '65';
    await notes.fill(draft);
    // A separate desk request changes the saved record while the phone edits its copy.
    const desk = await rpc('inspections.save', { ...original, id: first.id, expectedUpdatedAt: first.updatedAt, status: 'submitted', approachWeights: { salesComparison: 10, cost: 70, income: 20 }, rooms: [{ ...original.rooms[0], notes: 'Desk evidence checked' }] });
    if (surface === 'field') {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Refresh project context' }).click();
      await expect(page.getByRole('region', { name: 'Project connection' })).toContainText('Submitted to the workbench');
      await page.getByRole('button', { name: 'Review inspection', exact: true }).click();
    } else {
      // Queries are fresh for 5 seconds; advance browser time before refocusing.
      await page.clock.install();
      await page.clock.fastForward(6000);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        window.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        window.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.getByText('Desk evidence checked', { exact: false })).toBeVisible();
    }
    await expect(notes).toHaveValue(draft);
    const saveResponse = page.waitForResponse(r => r.url().includes('inspections.save') && r.request().method() === 'POST');
    await page.getByRole('button', { name: surface === 'field' ? 'Save' : 'Save valuation', exact: true }).click();
    const payload = await (await saveResponse).json();
    await expect(notes).toHaveValue(draft);
    const current = await request.get('/trpc/inspections.get', { headers: { authorization: `Bearer ${token}` }, params: { input: JSON.stringify({ json: deal.id }) } });
    const stored = (await current.json()).result.data.json;
    expect(stored.rooms[0].notes).toBe('Desk evidence checked');
    expect(stored.approachWeights).toEqual(desk.approachWeights);
    expect(stored.updatedAt).toBe(desk.updatedAt);
    expect((Array.isArray(payload) ? payload[0] : payload).error?.json?.data?.code).toBe('CONFLICT');
    await expect(page.getByText('A newer inspection has been saved', { exact: true })).toBeVisible();
    const recoveryPanel = page.getByRole('alert').filter({ hasText: 'A newer inspection has been saved' });
    await recoveryPanel.scrollIntoViewIfNeeded();
    await recoveryPanel.screenshot({ path: test.info().outputPath(`${surface}-conflict-recovery.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my draft', exact: true }).click();
    const download = await downloading;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString());
    expect(exported.dealId).toBe(deal.id);
    expect(exported.draft.baseUpdatedAt).toBe(first.updatedAt);
    expect(exported.draft.source).toBe(surface);
    if (surface === 'field') expect(exported.draft.rooms[0].notes).toBe(draft);
    else expect(exported.draft.approachWeights.salesComparison).toBe(65);
    expect(JSON.stringify(exported)).not.toContain(token);
    const opening = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Open latest in new tab', exact: true }).click();
    const latest = await opening;
    try {
      if (surface === 'field') await latest.getByRole('button', { name: 'Review inspection', exact: true }).click();
      const latestInput = surface === 'field' ? latest.getByLabel('Notes for Exterior') : latest.getByRole('spinbutton', { name: /^Weight/ }).first();
      await expect(latestInput).toHaveValue(surface === 'field' ? 'Desk evidence checked' : '10');
      await expect(notes).toHaveValue(draft);
      await latestInput.fill(surface === 'field' ? 'Desk evidence checked; field observation reviewed' : '15');
      const recovered = latest.waitForResponse(r => r.url().includes('inspections.save') && r.request().method() === 'POST');
      await latest.getByRole('button', { name: surface === 'field' ? 'Save' : 'Save valuation', exact: true }).click();
      expect((await recovered).status()).toBe(200);
      const verified = await request.get('/trpc/inspections.get', { headers: { authorization: `Bearer ${token}` }, params: { input: JSON.stringify({ json: deal.id }) } });
      const saved = (await verified.json()).result.data.json;
      expect(saved.rooms[0].notes).toBe(surface === 'field' ? 'Desk evidence checked; field observation reviewed' : 'Desk evidence checked');
      expect(saved.approachWeights.salesComparison).toBe(surface === 'field' ? 10 : 15);
      await expect(latest.getByText('A newer inspection has been saved', { exact: true })).toHaveCount(0);
      await expect(notes).toHaveValue(draft);
    } finally { await latest.close(); }

  } finally { await rpc('org.deleteWorkspace', { confirmName: orgName }); }
});
