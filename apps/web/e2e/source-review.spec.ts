import { expect, test } from '@playwright/test';

test('source review corrects extracted inputs and preserves their origin in a saved appraisal', async ({ page }, testInfo) => {
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
  await page.goto(`/deal/${dealId}/auto`);
  await expect(page.getByLabel('Scheme notes and document text')).toHaveValue('');
  await expect(page.getByRole('button', { name: /Generate appraisal/ })).toBeDisabled();
  const workbookChoice = page.getByRole('button', { name: /Review cost plan.xlsx/ });
  await workbookChoice.click();
  await expect(workbookChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Generate appraisal/ })).toBeEnabled();
  await workbookChoice.click();
  await page.getByRole('button', { name: 'Load worked example', exact: true }).click();
  await page.getByRole('button', { name: /Generate appraisal/ }).click();
  await expect(page.getByText('Review extracted inputs', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open full appraisal', exact: true })).toBeDisabled();
  await expect(page.getByText('Source and review history: Drawing A-102', { exact: true })).toBeVisible();
  await page.getByLabel('Review unit 1 area sq ft', { exact: true }).fill('2600');
  const accept = page.getByLabel(
    'I have checked the inputs, source citations and omitted content. These assumptions are ready to save.',
  );
  await expect(accept).toBeDisabled();
  await expect(page.getByRole('button', { name: /Generate appraisal/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New deal', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true }).click();
  await expect(page.getByText(/Source and review history: User-corrected input/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true })).toBeDisabled();
  await accept.check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Review Build cost £ per sq ft', { exact: true }).fill('125');
  await page.getByLabel('Review NIA / GIA efficiency %', { exact: true }).fill('85');
  await page.getByLabel('Review S106 £', { exact: true }).fill('32000');
  await page.getByLabel('Review CIL £ per sq m', { exact: true }).fill('55');
  await page.getByLabel('Review Annual interest rate %', { exact: true }).fill('9');
  await page.getByLabel('Review Build period months', { exact: true }).fill('0');
  await expect(accept).not.toBeChecked();
  await expect(accept).toBeDisabled();
  await page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true }).click();
  await expect(page.getByText(/Build period months:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open full appraisal', exact: true })).toBeDisabled();
  await page.getByLabel('Review Build period months', { exact: true }).fill('24');
  // A failed engine request cannot accept or silently lose the corrections.
  await page.route('**/trpc/autoAppraisal.compute*', route => route.abort());
  await page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true })).toBeEnabled();
  await expect(accept).toBeDisabled();
  await expect(page.getByLabel('Review Build cost £ per sq ft', { exact: true })).toHaveValue('125');
  await page.unroute('**/trpc/autoAppraisal.compute*');
  const recalculated = page.waitForResponse(r => r.url().includes('/trpc/autoAppraisal.compute') && r.ok());
  await page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true })).toBeDisabled();
  const computedBody = await (await recalculated).json();
  const correctedResult = (Array.isArray(computedBody) ? computedBody[0] : computedBody).result.data.json;
  await expect(accept).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('group', { name: 'Review scheme assumptions', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('scheme-review-mobile.png') });
  await accept.check();
  await page.getByRole('button', { name: 'Open full appraisal', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/deal/${dealId}/appraisal$`));
  const saved = await page.evaluate(async (id) => {
    const response = await fetch(
      `/trpc/appraisal.getCurrent?input=${encodeURIComponent(JSON.stringify({ json: id }))}`,
      {
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      },
    );
    return (await response.json()).result.data.json;
  }, dealId);
  expect(JSON.stringify(saved)).toContain('User-corrected input. Previous source: Drawing A-102');
  expect(JSON.stringify(saved)).toContain('2600');
  expect(saved.input).toMatchObject({ efficiency: 85, trades: [{ label: 'Build', rate: 125 }], finance: { ratePct: 9, periodMonths: 24 } });
  expect(saved.input.otherCosts).toContainEqual(expect.objectContaining({ label: 'S106', amount: 32000 }));
  expect(saved.input.otherCosts.find((cost: { label: string }) => cost.label === 'CIL').amount).toBeCloseTo(correctedResult.cil, 2);
  expect(saved.sourceReview).toMatchObject({ inputsUnchanged: true, sample: true });
  expect(saved.sourceReview.reviewerName).toBeTruthy();
  await page.reload();
  await expect(page.getByText('Saved inputs match the recorded review.', { exact: true })).toBeVisible();
  await expect(page.getByText('Worked example: these inputs were not extracted from project documents.', { exact: true })).toBeVisible();
  await page.getByLabel('NIA / GIA efficiency (%)', { exact: true }).fill('82');
  await expect(page.getByText('Inputs have changed. The recorded review does not cover these inputs.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Inputs have changed. The recorded review does not cover these inputs.', { exact: true })).toBeVisible();
});
