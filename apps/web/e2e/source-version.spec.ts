import { expect, test } from '@playwright/test';

test('stale source versions withhold downloads and block review acceptance', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const dealId = await page.evaluate(async () => {
    const response = await fetch('/trpc/deals.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      body: JSON.stringify({
        json: {
          name: `Source review ${Date.now()}`,
          address: '1 Test Row',
          postcode: 'BH1 1AA',
          assetType: 'RESIDENTIAL',
          stage: 'APPRAISAL',
        },
      }),
    });
    return (await response.json()).result.data.json.id as string;
  });
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Cover').addRow(['Test cost plan']);
  workbook.addWorksheet('Costs').addRow(['Build rate', 105]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  const uploaded = await page.evaluate(async ({ id, bytes }) => {
    const form = new FormData();
    form.append('dealId', id);
    form.append('category', 'Costs');
    form.append('file', new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))]), 'Review cost plan.xlsx');
    const response = await fetch('/uploads/document', { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` }, body: form });
    return response.ok;
  }, { id: dealId, bytes });
  expect(uploaded).toBe(true);

  const document = await page.evaluate(async dealId => {
    const r = await fetch(`/trpc/documents.list?input=${encodeURIComponent(JSON.stringify({ json: { dealId } }))}`, { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json.documents[0];
  }, dealId);
  // Controlled extraction metadata models a source version that has changed.
  // Real source changes and save refusals are exercised by the guarded API tests.
  await page.route('**/trpc/autoAppraisal.extract**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    for (const entry of Array.isArray(body) ? body : [body]) {
      entry.result.data.json.sourceDocuments = [{ id: document.id, name: document.name, version: '0'.repeat(64) }];
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/deal/${dealId}/auto`);
  await page.getByRole('button', { name: 'Load worked example', exact: true }).click();
  await page.getByRole('button', { name: /Generate appraisal/ }).click();
  await expect(page.getByText('A source changed since extraction. Reload the source documents and extract again before recording this review.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `Download source: ${document.name}`, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('I have checked the inputs, source citations and omitted content. These assumptions are ready to save.')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Open full appraisal', exact: true })).toBeDisabled();
});
