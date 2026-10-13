import { test, expect } from '@playwright/test';

// Due days must survive a browser west of the firm's timezone.
test.use({ timezoneId: 'America/Los_Angeles' });

test('saved field observations become reviewed project tasks and calendar completion returns to the field', async ({ page, request }) => {
  test.setTimeout(90_000);
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
    await rpc('org.invite', { name: 'Field Observer', email: `field-observer-${Date.now()}@example.test`, role: 'ANALYST' });
    const colleague = (await query('org.members', undefined)).find((member: { name: string }) => member.name === 'Field Observer');
    expect(colleague.initials).toBe('FO');
    const other = await rpc('deals.create', { name: 'Other project', address: 'Synthetic site B', assetType: 'RESIDENTIAL' });
    await rpc('inspections.save', { dealId: deal.id, rooms: [{ name: 'Empty room', condition: 0, photos: [], notes: '' }, { name: 'Exterior', condition: 2, photos: [], notes: 'Crack beside the entrance; investigate before valuation.' }], reconciledValue: null, approachWeights: { salesComparison: 60, cost: 20, income: 20 }, status: 'draft' });
    // API callers must not roll an impossible deadline into another month.
    const invalidDate = await request.post('/trpc/tasks.create', {
      headers: { authorization: `Bearer ${token}` },
      data: { json: { dealId: deal.id, aspect: 'Field inspection', title: 'Invalid deadline', due: '2030-02-31' } },
    });
    expect(invalidDate.status()).toBe(400);
    expect(await query('tasks.list', { dealId: deal.id })).toEqual([]);
    await page.goto(`/field?dealId=${deal.id}`);
    const panel = page.getByRole('region', { name: 'Field follow-ups', exact: true });
    await expect(panel).toContainText('Crack beside the entrance');
    // Unsaved edits must not be represented as saved evidence for a follow-up.
    await page.getByRole('button', { name: 'Continue inspection', exact: true }).click();
    await page.getByLabel('Notes for Empty room').fill('Unreviewed local observation');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(panel).not.toContainText('Unreviewed local observation');
    await panel.getByRole('button', { name: 'Review follow-up for Exterior', exact: true }).click();
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(/Crack beside/);
    const title = 'Arrange structural review of entrance crack';
    await panel.getByLabel('Follow-up title').fill(title);
    await panel.getByLabel('Assign follow-up to').selectOption(colleague.id);
    await panel.getByLabel('Follow-up due date').fill('2030-03-31');
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
    const sourceBefore = await query('inspections.get', deal.id);
    await rpc('inspections.save', { id: sourceBefore.id, dealId: deal.id, expectedUpdatedAt: sourceBefore.updatedAt, rooms: [sourceBefore.rooms[0], { ...sourceBefore.rooms[1], notes: 'Desk-reviewed entrance crack.' }], reconciledValue: null, approachWeights: sourceBefore.approachWeights, status: 'draft' });
    await panel.getByRole('button', { name: 'Create project follow-up', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('saved inspection changed');
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(title);
    expect(await query('tasks.list', { dealId: deal.id })).toEqual([]);
    await panel.getByRole('button', { name: 'Cancel follow-up', exact: true }).click();
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await expect(panel).toContainText('Desk-reviewed entrance crack.');
    await panel.getByRole('button', { name: 'Review follow-up for Exterior', exact: true }).click();
    await panel.getByLabel('Follow-up title').fill(title);
    await panel.getByLabel('Assign follow-up to').selectOption(colleague.id);
    await panel.getByLabel('Follow-up due date').fill('2030-03-31');
    // Commit the real write, then lose its response. The retry must resolve the
    // original task even though list invalidation has already exposed it.
    await page.route('**/trpc/tasks.create*', async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });
    await panel.getByRole('button', { name: 'Create project follow-up', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Retry this unchanged submission safely');
    await expect(panel.getByLabel('Follow-up title')).toBeDisabled();
    await expect(panel.getByLabel('Assign follow-up to')).toBeDisabled();
    await expect(panel.getByLabel('Follow-up due date')).toBeDisabled();
    const committed = await query('tasks.list', { dealId: deal.id, aspect: 'Field inspection' });
    expect(committed).toHaveLength(1);
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await expect(panel.getByRole('listitem').filter({ hasText: title })).toBeVisible();
    await page.unroute('**/trpc/tasks.create*');
    await panel.getByRole('button', { name: 'Create project follow-up', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Follow-up created');
    expect((await query('tasks.list', { dealId: deal.id }))[0].id).toBe(committed[0].id);
    const taskRow = panel.getByRole('listitem').filter({ hasText: title });
    await expect(taskRow).toContainText('Open');
    const saved = await query('tasks.list', { dealId: deal.id, aspect: 'Field inspection' });
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe(title);
    expect(saved[0].inspectionEvidence).toMatchObject({ inspectionId: sourceBefore.id, roomIndex: 1, room: { name: 'Exterior', notes: 'Desk-reviewed entrance crack.', condition: 2 } });
    expect(saved[0].assignee).toBe('FO');
    expect(saved[0].assigneeId).toBe(colleague.id);
    expect(saved[0].due).toBe('2030-03-31T00:00:00.000Z');
    await expect(taskRow).toContainText('Field Observer');
    expect(await query('tasks.list', { dealId: other.id })).toEqual([]);
    expect(await query('appraisal.getCurrent', deal.id)).toBeNull();
    const capturedSource = await query('inspections.get', deal.id);
    await rpc('inspections.save', { id: capturedSource.id, dealId: deal.id, expectedUpdatedAt: capturedSource.updatedAt, rooms: [capturedSource.rooms[0], { ...capturedSource.rooms[1], notes: 'New desk note after follow-up.' }], reconciledValue: null, approachWeights: capturedSource.approachWeights, status: 'draft' });
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await taskRow.getByText('Captured inspection evidence', { exact: true }).click();
    await expect(taskRow).toContainText('Desk-reviewed entrance crack.');
    await expect(taskRow).toContainText('current inspection differs');
    await expect(taskRow).not.toContainText('New desk note after follow-up.');
    await taskRow.screenshot({ path: test.info().outputPath('captured-field-evidence.png') });

    // An exact duplicate open title is flagged before another submit.
    await panel.getByRole('button', { name: 'Review follow-up for Exterior', exact: true }).click();
    await panel.getByLabel('Follow-up title').fill(title);
    await expect(panel.getByRole('button', { name: 'Create project follow-up', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: 'Cancel follow-up', exact: true }).click();
    await panel.getByRole('link', { name: 'Open task calendar', exact: true }).click();
    await page.getByRole('button', { name: 'Filter tasks for Field Owner', exact: true }).click();
    await expect(page.getByText(title, { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Filter tasks for Field Observer', exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    // Commit the write and replace its response with a transport failure.
    await page.route('**/trpc/tasks.toggle*', async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });
    await page.getByRole('button', { name: 'Complete task', exact: true }).click();
    await expect.poll(async () => (await query('tasks.list', { dealId: deal.id }))[0].done).toBe(true);
    await expect(page.getByRole('button', { name: 'Complete task', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('task status change could not be confirmed');
    await page.unroute('**/trpc/tasks.toggle*');
    await page.getByRole('button', { name: 'Refresh task status', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen task', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry status change', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry status change', exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen task', exact: true })).toBeVisible();
    expect((await query('tasks.list', { dealId: deal.id }))[0].done).toBe(true);
    await expect(page.getByRole('button', { name: 'Reopen task', exact: true })).toBeVisible();
    await page.goto(`/field?dealId=${deal.id}`);
    await expect(taskRow).toContainText('Completed');
    // Commit the write and replace its response with a transport failure.
    await page.route('**/trpc/tasks.toggle*', async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });
    await taskRow.getByRole('button', { name: 'Reopen follow-up', exact: true }).click();
    await expect.poll(async () => (await query('tasks.list', { dealId: deal.id }))[0].done).toBe(false);
    await expect(taskRow.getByRole('button', { name: 'Reopen follow-up', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('task status change could not be confirmed');
    await page.unroute('**/trpc/tasks.toggle*');
    await page.getByRole('button', { name: 'Refresh task status', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Complete follow-up', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry status change', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry status change', exact: true })).not.toBeVisible();
    await expect(taskRow.getByRole('button', { name: 'Complete follow-up', exact: true })).toBeVisible();
    expect((await query('tasks.list', { dealId: deal.id }))[0].done).toBe(false);
    await expect(taskRow).toContainText('Open');
    await panel.screenshot({ path: test.info().outputPath('field-followups-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.getByRole('link', { name: 'Review evidence in appraisal', exact: true }).click();
    const evidence = page.getByRole('region', { name: 'Field evidence for appraisal', exact: true });
    await expect(evidence).toContainText('1 open · 1 field follow-ups');
    await evidence.getByText('1 open · 1 field follow-ups — review observations', { exact: true }).click();
    await expect(evidence).toContainText('Desk-reviewed entrance crack.');
    await expect(evidence).not.toContainText('New desk note after follow-up.');
    await expect(evidence).toContainText('current inspection differs');
    await expect(evidence).toContainText('not pinned to this appraisal version');
    await rpc('tasks.toggle', { id: saved[0].id, done: true });
    await evidence.getByRole('button', { name: 'Refresh field evidence', exact: true }).click();
    await expect(evidence).toContainText('0 open · 1 field follow-ups');
    await expect(evidence).toContainText('appraisal impact still requires review');
    expect(await query('appraisal.getCurrent', deal.id)).toBeNull();
    await evidence.screenshot({ path: test.info().outputPath('appraisal-field-evidence-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.route('**/trpc/**', route => route.request().url().includes('tasks.list') ? route.abort() : route.continue());
    await evidence.getByRole('button', { name: 'Refresh field evidence', exact: true }).click();
    await expect(evidence).toContainText('Field evidence could not be loaded');
    await expect(evidence).not.toContainText('No field follow-ups');
    await page.unroute('**/trpc/**');
    await evidence.getByRole('button', { name: 'Refresh field evidence', exact: true }).click();
    await expect(evidence).toContainText('0 open · 1 field follow-ups');
    await evidence.getByRole('link', { name: 'Open project field companion', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/field\\?dealId=${deal.id}`));
    await expect(taskRow).toContainText('Completed');
    // The API corruption regression covers stored malformed bytes. Here inject
    // its normalized unreadable state to exercise both real presentation paths.
    await page.route('**/trpc/**', async route => {
      if (!route.request().url().includes('tasks.list')) return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      for (const item of Array.isArray(body) ? body : [body]) {
        const rows = item.result?.data?.json;
        if (Array.isArray(rows)) for (const row of rows) if (row.id === saved[0].id) {
          row.inspectionEvidence = null;
          row.inspectionEvidenceState = 'unreadable';
        }
      }
      await route.fulfill({ response, json: body });
    });
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await expect(taskRow).toContainText('captured inspection evidence could not be read');
    await expect(taskRow).not.toContainText('No inspection snapshot');
    await expect(taskRow.getByRole('button', { name: 'Reopen follow-up', exact: true })).toBeEnabled();
    await panel.getByRole('link', { name: 'Review evidence in appraisal', exact: true }).click();
    await evidence.getByText('0 open · 1 field follow-ups — review observations', { exact: true }).click();
    await expect(evidence).toContainText('captured inspection evidence could not be read');
    await expect(evidence).not.toContainText('No inspection snapshot');
    await page.unroute('**/trpc/**');
    await evidence.getByRole('button', { name: 'Refresh field evidence', exact: true }).click();
    await expect(evidence).toContainText('Desk-reviewed entrance crack.');
    await page.getByRole('button', { name: /^Versions/ }).click();
    await page.getByPlaceholder('Label this version', { exact: false }).fill('Inspection basis');
    await page.getByLabel('Include field follow-ups in this version', { exact: true }).check();
    await page.getByRole('button', { name: 'Save as version', exact: true }).click();
    await expect(page.getByText('Saved version “Inspection basis”', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Appraisal versions', exact: true }).click();
    const snapshot = page.getByRole('region', { name: 'Version field snapshot', exact: true });
    await expect(snapshot).toContainText('Inspection basis');
    await expect(snapshot).toContainText('Desk-reviewed entrance crack.');
    await expect(snapshot).toContainText('completed at capture');
    await rpc('tasks.toggle', { id: saved[0].id, done: false });
    await evidence.getByRole('button', { name: 'Refresh field evidence', exact: true }).click();
    await expect(evidence).toContainText('1 open · 1 field follow-ups');
    await expect(snapshot).toContainText('completed at capture');
    await page.reload();
    await expect(snapshot).toContainText('completed at capture');
    await expect(snapshot).not.toContainText('New desk note after follow-up.');
    await snapshot.screenshot({ path: test.info().outputPath('version-field-snapshot-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Turn captured evidence into an explicitly reviewed, source-linked allowance.
    const allowance = page.getByRole('region', { name: 'Review field allowance', exact: true });
    await allowance.getByLabel('Captured field task').selectOption(saved[0].id);
    await allowance.getByLabel('Allowance label').fill('Structural survey allowance');
    await allowance.getByLabel('Allowance amount', { exact: true }).fill('1250');
    await allowance.getByLabel('Review rationale').fill('Engineer investigation allowance pending quotation');
    await expect(allowance.getByRole('button', { name: 'Save reviewed allowance version' })).toBeDisabled();
    await page.getByRole('button', { name: /^Versions/ }).click();
    await page.getByPlaceholder('Label this version', { exact: false }).fill('Must not discard allowance');
    await expect(page.getByRole('button', { name: 'Save as version', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close Appraisal versions', exact: true }).click();
    await allowance.getByRole('checkbox').check();
    await expect(allowance).toContainText('Engine preview with allowance');
    await page.route('**/trpc/appraisal.save*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await allowance.getByRole('button', { name: 'Save reviewed allowance version' }).click();
    await expect(allowance.getByRole('alert')).toBeVisible();
    await expect(allowance.getByLabel('Allowance amount', { exact: true })).toHaveValue('1250');
    await page.unroute('**/trpc/appraisal.save*');
    await allowance.getByRole('button', { name: 'Save reviewed allowance version' }).click();
    const history = page.getByRole('region', { name: 'Field allowance review history', exact: true });
    await expect(history).toContainText('Saved cost matches review');
    await page.reload();
    await expect(history).toContainText('Engineer investigation allowance pending quotation');
    await expect(history).toContainText('Desk-reviewed entrance crack.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Other Costs', exact: true }).click();
    await expect(page.getByLabel('Structural survey allowance amount', { exact: true })).toHaveValue('1250');
    await page.getByLabel('Structural survey allowance amount', { exact: true }).fill('1500');
    await expect(history).toContainText('Editor cost match unverified');
    await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
    await expect(history).toContainText('Saved cost differs from review');
    await history.screenshot({ path: test.info().outputPath('field-allowance-review-mobile.png') });
    const mobileExport = page.getByRole('button', { name: 'Export .xlsx', exact: true });
    await expect(mobileExport).toBeVisible();
    expect((await mobileExport.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = function () { URL.createObjectURL = original; throw new Error('Mobile download failure'); };
    });
    await mobileExport.click();
    await expect(page.getByRole('alert')).toContainText('Excel export failed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('mobile-export-recovery.png') });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export .xlsx', exact: true }).click();
    const download = await downloadPromise;
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile((await download.path())!);
    const fieldLines: string[] = [];
    workbook.getWorksheet('Field evidence')!.eachRow(row => fieldLines.push(String(row.getCell(1).value ?? '')));
    const fieldText = fieldLines.join('');
    expect(fieldText).toContain('Reviewed field allowance');
    expect(fieldText).toContain('Engineer investigation allowance pending quotation');
    expect(fieldText).toContain('Saved cost differs from review');
    expect(fieldText).toContain('Desk-reviewed entrance crack.');
    expect(fieldText).toContain('Completed at capture');
    expect(fieldText).not.toContain('New desk note after follow-up.');
    expect(fieldText).toContain('not approval');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/deal/${deal.id}/report`);
    const printedField = page.getByTestId('field-evidence-page');
    await expect(printedField.first()).toContainText('Reviewed field allowance');
    const printedText = (await printedField.allTextContents()).join('');
    expect(printedText).toContain('Desk-reviewed entrance crack.');
    expect(printedText).toContain('Completed at capture');
    expect(printedText).not.toContain('New desk note after follow-up.');
    expect(printedText).toContain('not approval');
    expect(printedText).toContain('Engineer investigation allowance pending quotation');
    expect(printedText).toContain('Saved cost differs from review');
    expect(await page.locator('.a4-page').evaluateAll(pages => pages.some(p => p.scrollHeight > p.clientHeight + 2))).toBe(false);
    await printedField.first().screenshot({ path: test.info().outputPath('field-report-evidence.png') });
    const pdfDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
    const pdfDownload = await pdfDownloadPromise;
    await pdfDownload.saveAs(test.info().outputPath('field-evidence.pdf'));
    const { readFile } = await import('node:fs/promises');
    expect((await readFile((await pdfDownload.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
    // Exercise normalized API edge states without corrupting stored evidence.
    let fieldState = 'long';
    await page.route('**/trpc/**appraisal.getCurrent*', async route => {
      const response = await route.fetch();
      const body = await response.json();
      for (const item of Array.isArray(body) ? body : [body]) {
        const value = item.result?.data?.json;
        if (value?.fieldSnapshot) {
          value.fieldCostReviews = null;
          value.fieldCostReviewsState = fieldState === 'unreadable' ? 'unreadable' : 'absent';
          if (fieldState === 'long') value.fieldSnapshot.tasks[0].inspectionEvidence.room.notes = 'Long field observation. '.repeat(400) + 'END FIELD OBSERVATION';
          else { value.fieldSnapshot = null; value.fieldSnapshotState = fieldState; }
        }
      }
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await expect(printedField.nth(1)).toBeVisible();
    expect((await printedField.allTextContents()).join('')).toContain('END FIELD OBSERVATION');
    expect(await page.locator('.a4-page').evaluateAll(pages => pages.some(p => p.scrollHeight > p.clientHeight + 2))).toBe(false);
    fieldState = 'unreadable';
    await page.reload();
    await expect(printedField.first()).toContainText('FIELD SNAPSHOT UNREADABLE');
    await expect(printedField.first()).toContainText('FIELD ALLOWANCE REVIEWS UNREADABLE');
    await expect(printedField.first()).not.toContainText('Desk-reviewed entrance crack.');
    fieldState = 'absent';
    await page.reload();
    await expect(page.getByTestId('source-evidence-page').first()).toBeVisible();
    await expect(printedField).toHaveCount(0);
    await page.unroute('**/trpc/**appraisal.getCurrent*');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/deal/${other.id}/appraisal`);
    await expect(evidence).toContainText('No field follow-ups are recorded for this project');
    await expect(evidence).not.toContainText(title);
    expect(await query('appraisal.getCurrent', other.id)).toBeNull();
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

test('a field follow-up can be handed to a real colleague with a chosen due date', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const session = await page.evaluate(() => ({ token: localStorage.getItem('apex_token'), principal: JSON.parse(localStorage.getItem('apex_principal')!) }));
  const query = async (route: string, input?: unknown) => {
    const response = await request.get(`/trpc/${route}`, { headers: { authorization: `Bearer ${session.token}` }, params: input === undefined ? {} : { input: JSON.stringify({ json: input }) } });
    expect(response.status()).toBe(200);
    return (await response.json()).result.data.json;
  };
  const members = await query('org.members');
  const colleague = members.find((member: { id: string; initials: string }) => member.id !== session.principal.userId && members.filter((other: { initials: string }) => other.initials === member.initials).length === 1);
  expect(colleague, 'seed must contain a real second internal member').toBeTruthy();
  const deals = (await query('deals.list', {})).deals;
  let dealId = '';
  // Read an existing saved observation; do not overwrite any seeded inspection.
  for (const deal of deals.slice(0, 30)) {
    const inspection = await query('inspections.get', deal.id);
    if (inspection?.rooms.some((room: { notes: string; condition: number }) => room.notes.trim() || room.condition > 0)) { dealId = deal.id; break; }
  }
  expect(dealId, 'seed must contain a saved inspection observation').not.toBe('');
  const title = `Colleague field follow-up ${Date.now()}`;
  try {
    await page.goto(`/field?dealId=${dealId}`);
    const panel = page.getByRole('region', { name: 'Field follow-ups', exact: true });
    await panel.getByRole('button', { name: /^Review follow-up for/ }).first().click();
    await panel.getByLabel('Follow-up title').fill(title);
    await panel.getByLabel('Assign follow-up to').selectOption(colleague.id);
    await panel.getByLabel('Follow-up due date').fill('2030-10-27');
    // Member lookup failure must block assignment without discarding the form.
    await page.route('**/trpc/**', route => route.request().url().includes('org.members') ? route.abort() : route.continue());
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await expect(panel).toContainText('Workspace members could not be loaded');
    await expect(panel.getByRole('button', { name: 'Create project follow-up', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(title);
    await expect(panel.getByLabel('Follow-up due date')).toHaveValue('2030-10-27');
    await page.unroute('**/trpc/**');
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Create project follow-up', exact: true })).toBeEnabled();
    await panel.locator('form').screenshot({ path: test.info().outputPath('field-assignment-review.png') });
    await panel.getByRole('button', { name: 'Create project follow-up', exact: true }).click();
    const row = panel.getByRole('listitem').filter({ hasText: title });
    await expect(row).toContainText(colleague.name);
    const tasks = await query('tasks.list', { dealId, aspect: 'Field inspection' });
    const task = tasks.find((task: { title: string }) => task.title === title);
    expect(task.assignee).toBe(colleague.initials);
    expect(task.due).toBe('2030-10-27T00:00:00.000Z');
    await page.reload();
    await expect(row).toContainText(colleague.name);
    await expect(row).toContainText('27 Oct');
    await row.getByRole('button', { name: 'Edit follow-up', exact: true }).click();
    await panel.getByLabel('Follow-up title').fill(`${title} revised`);
    await panel.getByLabel('Assign follow-up to').selectOption(session.principal.userId);
    await panel.getByLabel('Follow-up due date').fill('2030-03-31');
    await page.route('**/trpc/tasks.update*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await panel.getByRole('button', { name: 'Save follow-up changes', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('update could not be confirmed');
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(`${title} revised`);
    await page.unroute('**/trpc/tasks.update*');
    await panel.getByRole('button', { name: 'Save follow-up changes', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Follow-up updated');
    const edited = (await query('tasks.list', { dealId })).find((item: { id: string }) => item.id === task.id);
    expect(edited).toMatchObject({ title: `${title} revised`, assignee: session.principal.initials, due: '2030-03-31T00:00:00.000Z', done: false });
    await row.getByRole('button', { name: 'Edit follow-up', exact: true }).click();
    await panel.getByLabel('Follow-up title').fill(`${title} unsaved draft`);
    const competing = await request.post('/trpc/tasks.update', {
      headers: { authorization: `Bearer ${session.token}` },
      data: { json: { id: task.id, title: `${title} desk revision`, assignee: colleague.initials, expected: { title: edited.title, assignee: edited.assignee, assigneeId: edited.assigneeId, due: edited.due, done: edited.done } } },
    });
    expect(competing.status()).toBe(200);
    await panel.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await expect(row).toContainText('desk revision');
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(`${title} unsaved draft`);
    await panel.getByRole('button', { name: 'Save follow-up changes', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('changed elsewhere');
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(`${title} unsaved draft`);
    expect((await query('tasks.list', { dealId })).find((item: { id: string }) => item.id === task.id).title).toBe(`${title} desk revision`);
    await panel.locator('form').screenshot({ path: test.info().outputPath('field-edit-conflict.png') });
    await panel.getByRole('button', { name: 'Cancel follow-up', exact: true }).click();
    await row.getByRole('button', { name: 'Edit follow-up', exact: true }).click();
    await expect(panel.getByLabel('Follow-up title')).toHaveValue(`${title} desk revision`);
    await panel.getByLabel('Follow-up due date').fill('');
    await panel.getByRole('button', { name: 'Save follow-up changes', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Follow-up updated');
    expect((await query('tasks.list', { dealId })).find((item: { id: string }) => item.id === task.id).due).toBeNull();
    await panel.getByRole('link', { name: 'Open task calendar', exact: true }).click();
    await expect(page.getByText(`${title} desk revision`, { exact: true })).toBeVisible();
    await page.goto(`/field?dealId=${dealId}`);
    await expect(row).toContainText('desk revision');
    await expect(row).not.toContainText('due');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    const tasks = await query('tasks.list', { dealId });
    for (const task of tasks.filter((task: { title: string }) => task.title.startsWith(title))) {
      const response = await request.post('/trpc/tasks.remove', { headers: { authorization: `Bearer ${session.token}` }, data: { json: task.id } });
      expect(response.status()).toBe(200);
    }
  }
});
