import { expect, test } from '@playwright/test';

/** Customer-owned data throughout; no demo login or seeded valuation. */
test('a customer creates an appraisal, reads its report, exports and closes the workspace', async ({ page, request }) => {
  test.setTimeout(90_000);
  const stamp = `${Date.now()}-${test.info().workerIndex}`;
  const orgName = `Lifecycle ${stamp}`;
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Your name').fill('Customer Owner');
  await page.getByLabel('Email', { exact: true }).fill(`lifecycle-${stamp}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();
  await expect(page.getByText('Northgate Trade & Industrial Park')).toHaveCount(0);
  let deleted = false;
  try {
    await page.getByRole('link', { name: /New deal from documents/ }).click();
    const drawer = page.getByRole('dialog', { name: 'New deal' });
    await drawer.getByLabel('Deal name').fill('Customer appraisal');
    await drawer.getByLabel('Address', { exact: true }).fill('3 Quay Road, Poole');
    await drawer.getByLabel('Postcode').fill('BH15 1JF');
    await drawer.getByRole('button', { name: 'Create & appraise from documents' }).click();
    await page.waitForURL(/\/deal\/[^/]+\/auto$/);
    const dealId = page.url().match(/\/deal\/([^/]+)\//)![1];
    await page.getByText('Manual entry', { exact: true }).click();
    await expect(page.getByLabel('Scheme')).toHaveValue('Customer appraisal');
    await page.getByRole('button', { name: /Add unit/ }).click();
    await page.getByLabel('Unit 1 area sq ft').fill('750');
    await page.getByLabel('Unit 1 price per sq ft').fill('420');
    await page.getByRole('button', { name: 'Run appraisal', exact: true }).click();
    await page.getByRole('button', { name: 'Open full appraisal', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/deal/${dealId}/appraisal$`));
    await expect(page.getByText('Unit schedule', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: 'Report', exact: true }).click();
    await expect(page.locator('.a4-page').first()).toBeVisible();
    await expect(page.getByText('Customer appraisal', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('No appraisal saved yet')).toHaveCount(0);
    const pdfUrl = await page.evaluate(async id => {
      const response = await fetch('/trpc/appraisal.downloadToken', {
        method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ json: { kind: 'appraisal', dealId: id } }),
      });
      const token = (await response.json()).result.data.json.token;
      return `/reports/${id}/appraisal.pdf?t=${encodeURIComponent(token)}`;
    }, dealId);
    const pdf = await request.get(pdfUrl);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    await page.goto('/settings');
    await expect(page.getByText('14 DAYS LEFT', { exact: true })).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download export', exact: true }).click();
    const download = await downloadEvent;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString());
    expect(JSON.stringify(exported)).toContain('Customer appraisal');
    expect(exported.data.User.every((user: { password: string }) => user.password === '[redacted]')).toBe(true);
    expect(exported.data.Appraisal[0].source).toBe('manual');
    await page.getByRole('button', { name: 'Delete workspace…', exact: true }).click();
    await page.getByLabel(/Type .* to confirm/).fill(orgName);
    await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
    await expect(page).toHaveURL(/\/welcome$/);
    deleted = true;
    expect(await page.evaluate(() => localStorage.getItem('apex_token'))).toBeNull();
  } finally {
    if (!deleted) await page.evaluate(async name => {
      const token = localStorage.getItem('apex_token');
      if (!token) return;
      await fetch('/trpc/org.deleteWorkspace', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ json: { confirmName: name } }),
      });
    }, orgName);
  }
});
