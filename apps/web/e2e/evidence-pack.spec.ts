import superjson from 'superjson';
import { expect, test } from '@playwright/test';

test('page references survive save, revision changes warn, and evidence leaves in PDF and Excel', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const dealId = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.create', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` }, body: JSON.stringify({ json: { name: `Evidence pack ${Date.now()}`, address: '1 Test Row', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' } }) });
    return (await r.json()).result.data.json.id;
  });
  // A real, one-page PDF fixture. We reference it manually, without claiming model extraction.
  const fixturePage = await context.newPage();
  await fixturePage.setContent('<h1>Test drawing</h1><p>Drawing A102, revision A. Test fixture only.</p>');
  const pdf = (await fixturePage.pdf()).toString('base64'); await fixturePage.close();
  const upload = (name: string) => page.evaluate(async ({ dealId, pdf, name }) => {
    const form = new FormData(); form.append('dealId', dealId); form.append('category', 'Architectural');
    form.append('file', new Blob([Uint8Array.from(atob(pdf), c => c.charCodeAt(0))], { type: 'application/pdf' }), name);
    const response = await fetch('/uploads/document', { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` }, body: form });
    if (!response.ok) throw new Error('Fixture upload failed');
  }, { dealId, pdf, name });
  await upload('Drawing revision A.pdf');
  await page.goto(`/deal/${dealId}/auto`);
  await page.getByRole('button', { name: 'Load worked example', exact: true }).click();
  await page.getByRole('button', { name: /Generate appraisal/ }).click();
  await expect(page.getByText('Review extracted inputs', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Source document for unit 1', exact: true }).selectOption({ label: 'Drawing revision A.pdf' });
  const accept = page.getByLabel('I have checked the inputs, source citations and omitted content. These assumptions are ready to save.');
  await expect(accept).toBeDisabled();
  await page.getByLabel('PDF page for unit 1', { exact: true }).fill('1');
  await page.getByLabel('Drawing, sheet or cell reference for unit 1', { exact: true }).fill('A102 revision A');
  await accept.check(); await page.getByRole('button', { name: 'Open full appraisal', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/deal/${dealId}/appraisal$`));
  await upload('Drawing revision B.pdf');
  await page.goto(`/deal/${dealId}/dataroom`);
  await page.getByText('Document revisions', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Earlier document', exact: true }).selectOption({ label: 'Drawing revision A.pdf' });
  await page.getByRole('combobox', { name: 'Replacement document', exact: true }).selectOption({ label: 'Drawing revision B.pdf' });
  await page.getByRole('button', { name: 'Save revision link', exact: true }).click();
  await expect(page.getByText('Document revision link saved', { exact: true })).toBeVisible();
  // Another editor changes the link after this form captures its expected value.
  const earlierChoice = page.getByRole('combobox', { name: 'Earlier document', exact: true });
  const replacementChoice = page.getByRole('combobox', { name: 'Replacement document', exact: true });
  const oldOption = earlierChoice.getByRole('option', { name: /Drawing revision A.pdf.*superseded/ });
  await expect(oldOption).toHaveCount(1);
  const oldId = (await oldOption.getAttribute('value'))!;
  const newId = (await replacementChoice.getByRole('option', { name: 'Drawing revision B.pdf', exact: true }).getAttribute('value'))!;
  await earlierChoice.selectOption(oldId);
  const externalEdit = await page.evaluate(async ({ oldId, newId }) => (await fetch('/trpc/documents.setRevision', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
    body: JSON.stringify({ json: { documentId: oldId, toId: null, expected: newId } }),
  })).ok, { oldId, newId });
  expect(externalEdit).toBe(true);
  await replacementChoice.selectOption('');
  await page.getByRole('button', { name: 'Save revision link', exact: true }).click();
  await expect(earlierChoice).toHaveValue('');
  await expect(page.getByText('This revision link changed. Reload the data room and try again.', { exact: true })).toBeVisible();
  await earlierChoice.selectOption(oldId); await replacementChoice.selectOption(newId);
  await page.getByRole('button', { name: 'Save revision link', exact: true }).click();
  await expect(earlierChoice).toHaveValue('');
  await page.goto(`/deal/${dealId}/auto`);
  await expect(page.getByRole('button', { name: /Drawing revision A.pdf/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Drawing revision B.pdf/ })).toBeVisible();
  await page.goto(`/deal/${dealId}/appraisal`);
  await expect(page.getByText('A reviewed source is superseded, changed or missing. Check the source record before relying on this appraisal.', { exact: true })).toBeVisible();
  await page.getByText('Reviewed sources and reported omissions', { exact: true }).click();
  await expect(page.getByText(/PDF page 1, A102 revision A/)).toBeVisible();
  const workbookEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export.*xlsx/i }).click();
  const workbookDownload = await workbookEvent;
  const workbookPath = testInfo.outputPath('source-evidence.xlsx'); await workbookDownload.saveAs(workbookPath);
  const ExcelJS = (await import('exceljs')).default; const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(workbookPath);
  const evidence = workbook.getWorksheet('Source evidence'); expect(evidence).toBeTruthy();
  const text: string[] = []; evidence!.eachRow(row => text.push(String(row.getCell(1).value ?? '')));
  expect(text.join('')).toContain('PDF page 1'); expect(text.join('')).toContain('superseded'); expect(text.join('')).toContain('WORKED EXAMPLE'); expect(text.join('')).not.toContain('?t=');
  await page.goto(`/deal/${dealId}/report`);
  await expect(page.getByTestId('source-evidence-page').first()).toBeVisible();
  const printed = (await page.getByTestId('source-evidence-page').allTextContents()).join('');
  expect(printed).toContain('PDF page 1'); expect(printed).toContain('SOURCE WARNING');
  const overflow = await page.locator('.a4-page').evaluateAll(pages => pages.some(p => p.scrollHeight > p.clientHeight + 2));
  expect(overflow).toBe(false);
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await downloadEvent; await download.saveAs(testInfo.outputPath('source-evidence.pdf'));
  await page.getByTestId('source-evidence-page').first().screenshot({ path: testInfo.outputPath('source-evidence.png') });
  // Exercise real report pagination with a bounded but long review record.
  const wire = await page.evaluate(async id => {
    const r = await fetch(`/trpc/appraisal.getCurrent?input=${encodeURIComponent(JSON.stringify({ json: id }))}`, { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data;
  }, dealId);
  const current = superjson.deserialize<{ input: Record<string, unknown>; updatedAt: Date }>(wire);
  const body = JSON.stringify(superjson.serialize({ dealId, input: current.input, expectedUpdatedAt: current.updatedAt,
    sourceReview: { accepted: true, sample: true, documentIds: [], references: [], omissions: [{ name: 'Long evidence test', reason: 'This is a long user-reported omission for pagination. '.repeat(120) + 'END LONG EVIDENCE' }] } }));
  const updated = await page.evaluate(async body => (await fetch('/trpc/appraisal.save', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` }, body })).ok, body);
  expect(updated).toBe(true); await page.reload();
  await expect(page.getByTestId('source-evidence-page').nth(1)).toBeVisible();
  expect((await page.getByTestId('source-evidence-page').allTextContents()).join('')).toContain('END LONG EVIDENCE');
  expect(await page.locator('.a4-page').evaluateAll(pages => pages.some(p => p.scrollHeight > p.clientHeight + 2))).toBe(false);

});
