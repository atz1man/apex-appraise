import { expect, test } from '@playwright/test';

test('workfile questions explain coverage and allow retry after a timeout', async ({ page }) => {
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

  await page.goto(`/deal/${dealId}/dataroom`);
  const question = page.getByRole('textbox', { name: "Ask a question of this deal's documents", exact: true });
  await question.fill('What do the documents say?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('No answer was generated because no source files could be read.', { exact: false })).toBeVisible();

  // Rendering a provider-backed response is deterministic here; the guarded API
  // tests exercise actual file selection and a stubbed model transport separately.
  let attempts = 0;
  await page.route('**/trpc/documents.ask**', async route => {
    if (attempts++ === 0) {
      const error = { error: { json: { message: 'The AI request timed out. Try again; no successful result was recorded.', code: -32008, data: { code: 'TIMEOUT', httpStatus: 408, path: 'documents.ask' } } } };
      await route.fulfill({ status: 408, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('batch=1') ? [error] : error) });
      return;
    }
    const data = { result: { data: { json: {
      status: 'ok', answer: 'The supplied plan describes the scheme.',
      sources: ['Current.pdf'], documentsRead: ['Current.pdf'],
      documentsSkipped: [{ name: 'Old.pdf', reason: 'Superseded by a later revision.' }],
    } } } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('batch=1') ? [data] : data) });
  });
  await question.fill('Which plan describes the scheme?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('The AI request timed out. Try again; no successful result was recorded.', { exact: true })).toBeVisible();
  await expect(question).toHaveValue('Which plan describes the scheme?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Files read: Current.pdf. This answer covers only these files.', { exact: true })).toBeVisible();
  await expect(page.getByText('Old.pdf: Superseded by a later revision.', { exact: true })).toBeVisible();
});
