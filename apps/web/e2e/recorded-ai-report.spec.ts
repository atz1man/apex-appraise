import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { zExtraction } from '@apex/types';
import { computeAppraisal, formatMoneyFull } from '@apex/appraisal-engine';

// Only extraction is replayed. Upload, calculation, review, save and PDF are real.
// No funded model request is allowed from this browser/CI journey.
test('recorded PDF extraction survives correction, source review, save and PDF export', async ({ page }) => {
  test.setTimeout(120_000);
  const record = JSON.parse(readFileSync(new URL('../../api/test/fixtures/auto-appraisal/pdf-run-2026-10-11.json', import.meta.url), 'utf8'));
  const bytes = readFileSync(new URL('../../api/test/fixtures/auto-appraisal/revision-pack.pdf', import.meta.url)).toString('base64');
  const stamp = `${Date.now()}-${test.info().workerIndex}`;
  const orgName = `AI journey ${stamp}`;
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Your name').fill('Synthetic Review Owner');
  await page.getByLabel('Email', { exact: true }).fill(`ai-journey-${stamp}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();
  try {
    await page.getByRole('link', { name: /New deal from documents/ }).click();
    const drawer = page.getByRole('dialog', { name: 'New deal' });
    await drawer.getByLabel('Deal name').fill('Recorded synthetic PDF appraisal');
    await drawer.getByLabel('Address', { exact: true }).fill('3 Quay Road, Poole');
    await drawer.getByLabel('Postcode').fill('BH15 1JF');
    await drawer.getByRole('button', { name: 'Create & appraise from documents' }).click();
    await page.waitForURL(/\/deal\/[^/]+\/auto$/);
    const dealId = page.url().match(/\/deal\/([^/]+)\//)![1];
    const document = await page.evaluate(async ({ dealId, bytes }) => {
      const headers = { authorization: `Bearer ${localStorage.getItem('apex_token')}` };
      const form = new FormData(); form.append('dealId', dealId); form.append('category', 'Planning');
      form.append('file', new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'application/pdf' }), 'Synthetic revision pack.pdf');
      const uploaded = await fetch('/uploads/document', { method: 'POST', headers, body: form });
      if (!uploaded.ok) throw new Error(`Upload failed: ${uploaded.status}`);
      const listed = await fetch(`/trpc/documents.list?input=${encodeURIComponent(JSON.stringify({ json: { dealId } }))}`, { headers });
      return (await listed.json()).result.data.json.documents[0];
    }, { dealId, bytes });
    const extraction = zExtraction.parse({ ...record.response.cases.find((c: { id: string }) => c.id === 'pdf-revision'), scheme: 'Recorded synthetic PDF appraisal', assetType: 'residential' });
    const indicative = await page.evaluate(async extraction => {
      const r = await fetch(`/trpc/autoAppraisal.compute?input=${encodeURIComponent(JSON.stringify({ json: { extraction, buildPerSqft: 105 } }))}`, { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
      return (await r.json()).result.data.json;
    }, extraction);
    let replayed = 0;
    await page.route('**/trpc/autoAppraisal.extract**', async route => {
      replayed++;
      const reply = { result: { data: { json: { extraction, indicative, documentsRead: [document.name], sourceDocuments: [{ id: document.id, name: document.name, version: document.version }], documentsSkipped: [] } } } };
      await route.fulfill({ json: route.request().url().includes('batch=1') ? [reply] : reply });
    });
    await page.reload();
    await page.getByRole('button', { name: /Synthetic revision pack.pdf/ }).click();
    await page.getByRole('button', { name: /Generate appraisal/ }).click();
    await expect(page.getByText('Review extracted inputs', { exact: true })).toBeVisible();
    expect(replayed).toBe(1);
    await expect(page.getByLabel('Review unit 1 area sq ft', { exact: true })).toHaveValue('775');
    await page.getByLabel('Review unit 1 area sq ft', { exact: true }).fill('800');
    const accept = page.getByLabel('I have checked the inputs, source citations and omitted content. These assumptions are ready to save.');
    await expect(accept).toBeDisabled();
    await page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply corrections and recalculate', exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Source document for unit 1', exact: true }).selectOption(document.id);
    await page.getByLabel('PDF page for unit 1', { exact: true }).fill('2');
    await page.getByLabel('Drawing, sheet or cell reference for unit 1', { exact: true }).fill('P02 Rev B; area corrected by reviewer');
    await accept.check();
    await page.getByRole('button', { name: 'Open full appraisal', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/deal/${dealId}/appraisal$`));
    await page.reload();
    await expect(page.getByText('Saved inputs match the recorded review.', { exact: true })).toBeVisible();
    const saved = await page.evaluate(async dealId => {
      const r = await fetch(`/trpc/appraisal.getCurrent?input=${encodeURIComponent(JSON.stringify({ json: dealId }))}`, { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
      return (await r.json()).result.data.json;
    }, dealId);
    expect(saved.source).toBe('ai');
    expect(saved.input.units[0]).toMatchObject({ count: 4, area: 800, cap: 425 });
    expect(saved.input.units[0].source).toContain('User-corrected input. Previous source: pdf-revision: page 2:');
    expect(saved.sourceReview).toMatchObject({ inputsUnchanged: true, sample: false, reviewerName: 'Synthetic Review Owner' });
    expect(saved.sourceReview.references).toEqual([expect.objectContaining({ unitIndex: 0, documentId: document.id, page: 2, locator: 'P02 Rev B; area corrected by reviewer' })]);
    expect(saved.sourceReview.documents).toEqual([expect.objectContaining({ id: document.id, status: 'unchanged' })]);
    const expected = computeAppraisal(saved.input, { withCash: true });
    expect(saved.result).toEqual(expected);
    await page.goto(`/deal/${dealId}/report`);
    await expect(page.locator('.a4-page').first()).toBeVisible();
    await expect(page.locator('.a4-page').getByText(formatMoneyFull(expected.gdv), { exact: true }).first()).toBeVisible();
    await expect(page.locator('.a4-page').getByText(/P02 Rev B; area corrected by reviewer/).first()).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
    const stream = await (await pending).createReadStream();
    const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).subarray(0, 4).toString()).toBe('%PDF');
  } finally {
    const deleted = await page.evaluate(async confirmName => {
      const response = await fetch('/trpc/org.deleteWorkspace', { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' }, body: JSON.stringify({ json: { confirmName } }) });
      return response.ok;
    }, orgName);
    expect(deleted).toBe(true);
  }
});
