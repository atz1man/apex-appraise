import { expect, test } from '@playwright/test';

test('manually referenced source versions reject stale saves and recover after reselection', async ({ page }) => {
  test.setTimeout(120_000);
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
  let staleList = true;
  let hideSource = false;
  await page.route('**/trpc/*documents.list*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    for (const entry of Array.isArray(body) ? body : [body]) {
      const data = entry.result?.data?.json;
      if (!data?.documents) continue;
      if (hideSource) data.documents = [];
      else if (staleList) for (const doc of data.documents) if (doc.id === document.id) doc.version = '0'.repeat(64);
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/deal/${dealId}/auto`);
  await expect(page.getByRole('button', { name: /Review cost plan.xlsx/ })).toBeVisible();
  await page.getByRole('button', { name: 'Load worked example', exact: true }).click();
  await page.getByRole('button', { name: /Generate appraisal/ }).click();
  await expect(page.getByText('Review extracted inputs', { exact: true })).toBeVisible();
  const source = page.getByRole('combobox', { name: 'Source document for unit 1', exact: true });
  const locator = page.getByLabel('Drawing, sheet or cell reference for unit 1', { exact: true });
  await source.selectOption(document.id);
  await locator.fill('Costs!B1');
  const accept = page.getByLabel('I have checked the inputs, source citations and omitted content. These assumptions are ready to save.');
  await accept.check();
  // The server sees the real current version; this cached list is deliberately stale.
  await page.getByRole('button', { name: 'Open full appraisal', exact: true }).click();
  await expect(page.locator('#page').getByText('A source changed since this review was prepared. Refresh source documents and check the affected references or extract again.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/deal/${dealId}/auto$`));
  staleList = false;
  await page.getByRole('button', { name: 'Refresh source documents', exact: true }).click();
  await expect(accept).toBeDisabled();
  await expect(page.getByText('This reference uses a changed or unavailable source. Clear it and select the current document before checking its page or location.', { exact: true })).toBeVisible();
  // Even an empty refreshed list must leave the reference removable.
  hideSource = true;
  await page.getByRole('button', { name: 'Refresh source documents', exact: true }).click();
  await expect(source.getByRole('option')).toHaveCount(1);
  await source.selectOption('');
  hideSource = false;
  await page.getByRole('button', { name: 'Refresh source documents', exact: true }).click();
  await source.selectOption(document.id);
  await expect(locator).toHaveValue('');
  await expect(accept).toBeDisabled();
  await locator.fill('Costs!B1 checked again');
  await accept.check();
  await page.getByRole('button', { name: 'Open full appraisal', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/deal/${dealId}/appraisal$`));
  await page.reload();
  await page.getByText('Reviewed sources and reported omissions', { exact: true }).click();
  await expect(page.getByText('Costs!B1 checked again', { exact: false })).toBeVisible();
});
