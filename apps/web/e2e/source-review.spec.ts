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
  await expect(page.getByLabel('Review NIA / GIA efficiency %', { exact: true }).locator('..')).toContainText('Worked example — not project evidence');
  await expect(page.getByRole('button', { name: 'Open full appraisal', exact: true })).toBeDisabled();
  await expect(page.getByText('Source and review history: Drawing A-102', { exact: true })).toBeVisible();
  const originalArea = Number(await page.getByLabel('Review unit 1 area sq ft', { exact: true }).inputValue());
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
  await expect(page.getByLabel('Review Annual interest rate %', { exact: true }).locator('..')).toContainText('Pending user correction');
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
  expect(saved.sourceReview).toMatchObject({ inputsUnchanged: true, sample: true, assumptionOrigins: { efficiency: 'user-entered', 'finance.rate': 'user-entered', profFee: 'worked-example', buildPerSqft: 'user-entered' } });
  expect(saved.sourceReview.originalExtractedUnits[0]).toMatchObject({ area: originalArea, source: 'Drawing A-102' });
  expect(saved.input.units[0].area).toBe(2600);
  expect(saved.input.units[0].extractionUnitId).toMatch(/^[a-f0-9-]{36}$/);
  expect(saved.input.units[0].extractionUnitId).toBe(saved.sourceReview.originalExtractedUnits[0].extractionUnitId);
  expect(saved.sourceReview.reviewerName).toBeTruthy();
  expect(saved.sourceReview.extractionReceipt).toMatchObject({ mode: 'worked-example', id: expect.any(String), outputHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await page.reload();
  await expect(page.getByText('Saved inputs match the recorded review.', { exact: true })).toBeVisible();
  await expect(page.getByText('Worked example: these inputs were not extracted from project documents.', { exact: true })).toBeVisible();
  await page.getByText('Original extracted unit schedule', { exact: true }).click();
  const originalSchedule = page.locator('details').filter({ has: page.getByText('Original extracted unit schedule', { exact: true }) });
  await expect(originalSchedule).toContainText(`Area per unit (sq ft): ${originalArea}`);
  await expect(originalSchedule).toContainText('Original source text (unverified): Drawing A-102');
  await page.getByText('Original versus saved assumptions', { exact: true }).click();
  await expect(page.getByText(/NIA \/ GIA efficiency %: original 90; saved 85 — Changed/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('Original versus saved units', { exact: true }).click();
  await expect(page.getByText('Original row 1 → saved row 1: Changed', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .xlsx', exact: true }).click();
  const file = await download;
  const exported = new ExcelJS.Workbook(); await exported.xlsx.readFile((await file.path())!);
  const evidence: string[] = []; exported.getWorksheet('Source evidence')!.eachRow(row => evidence.push(String(row.getCell(1).value ?? '')));
  expect(evidence.join(' ')).toContain('Annual interest rate %: User-entered or corrected');
  expect(evidence.join(' ')).toContain('Professional fees %: Worked example');
  expect(evidence.join(' ')).toContain(saved.sourceReview.extractionReceipt.id);
  expect(evidence.join(' ')).toContain('original 90; saved 85 — Changed');
  expect(evidence.join(' ')).toContain('Original row 1 → saved row 1: Changed');
  expect(evidence.join(' ')).toContain(`Area per unit (sq ft): ${originalArea}`);
  expect(evidence.join(' ')).toContain('Original source text (unverified): Drawing A-102');
  await page.goto(`/deal/${dealId}/report`);
  await expect(page.getByText('ORIGINAL VERSUS SAVED UNITS', { exact: true })).toBeVisible();
  await expect(page.getByText('ORIGINAL EXTRACTED UNIT SCHEDULE', { exact: true })).toBeVisible();
  await expect(page.getByText('ASSUMPTION ORIGINS AT REVIEW', { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(saved.sourceReview.extractionReceipt.id))).toBeVisible();
  await expect(page.getByText(/Annual interest rate %: User-entered or corrected/)).toBeVisible();
  // Synthetic oversized history exercises the real workbook and bounded report rendering.
  // Only the response is changed; no fabricated receipt is saved.
  await page.route('**/trpc/**', async route => {
    if (!route.request().url().includes('appraisal.getCurrent')) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    for (const row of Array.isArray(body) ? body : [body]) {
      const review = row.result?.data?.json?.sourceReview;
      if (!review) continue;
      review.omissions = [{ name: 'Excluded cost sheet', reason: 'Sheet exceeded extraction limit' }];
      review.originalExtractedUnits = Array.from({ length: 300 }, (_, i) => ({ label: `History unit ${i + 1}`, count: 1, area: 500, value: 300, conf: 'low', source: 'Synthetic history' }));
    }
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.getByText(/SOURCE COVERAGE WARNING/)).toBeVisible();
  await expect(page.getByText('Excluded cost sheet: Sheet exceeded extraction limit', { exact: true })).toBeVisible();
  await expect(page.getByText(/EVIDENCE PRINT LIMIT/)).toBeVisible();
  await expect(page.getByText(/Original row 300:/)).toHaveCount(0);
  await page.goto(`/deal/${dealId}/appraisal`);
  const fullDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .xlsx', exact: true }).click();
  const fullWorkbook = new ExcelJS.Workbook(); await fullWorkbook.xlsx.readFile((await (await fullDownload).path())!);
  const fullEvidence: string[] = []; fullWorkbook.getWorksheet('Source evidence')!.eachRow(row => fullEvidence.push(String(row.getCell(1).value ?? '')));
  expect(fullEvidence.join(' ')).toContain('SOURCE COVERAGE WARNING');
  expect(fullEvidence.join(' ')).toContain('Excluded cost sheet: Sheet exceeded extraction limit');
  expect(fullEvidence.join(' ')).toContain('Original row 300: History unit 300');
  await page.unroute('**/trpc/**');
  await page.goto(`/deal/${dealId}/appraisal`);
  await page.getByText('Original versus saved assumptions', { exact: true }).click();
  await page.getByText('Original versus saved units', { exact: true }).click();
  await page.getByLabel('NIA / GIA efficiency (%)', { exact: true }).fill('82');
  await expect(page.getByText('Save and refresh before comparing units: this editor contains unsaved changes.', { exact: true })).toBeVisible();
  await expect(page.getByText('Original row 1 → saved row 1: Changed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Save and refresh before comparing: this editor contains unsaved changes.', { exact: true })).toBeVisible();
  await expect(page.getByText(/original 90; saved 85/)).toHaveCount(0);
  await expect(page.getByText('Inputs have changed. The recorded review does not cover these inputs.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Inputs have changed. The recorded review does not cover these inputs.', { exact: true })).toBeVisible();
  const persistedLink = await page.evaluate(async id => {
    const response = await fetch('/trpc/appraisal.getCurrent?input=' + encodeURIComponent(JSON.stringify({ json: id })), { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await response.json()).result.data.json.input.units[0].extractionUnitId;
  }, dealId);
  expect(persistedLink).toBe(saved.input.units[0].extractionUnitId);
});
