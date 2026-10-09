import { expect, test, type Page } from '@playwright/test';
import { ratePerAreaIn, weightedComparables } from '@apex/appraisal-engine';

// Intercept mutations so the shared demo appraisal is never changed.
async function evidence(page: Page, opts: { metric?: boolean; empty?: boolean; delaySave?: Promise<void>; failSave?: boolean } = {}) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools', { exact: true })).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id as string;
  });
  const comp = { id: 'integrity-comp', dealId: id, address: 'Test evidence', meta: 'Recorded sale', basePsf: 220,
    adjSize: 0, adjCondition: 0, adjDate: 0, adjLocation: 0, lat: null, lng: null };
  const calls = { saves: 0, applies: 0, writes: [] as Array<Record<string, unknown>> };
  let hasEvidence = !opts.empty;
  await page.route('**/trpc/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ops = url.pathname.split('/trpc/')[1]!.split(',');
    const batched = url.searchParams.get('batch') === '1';
    let results: any[];
    if (request.method() === 'GET') {
      const json = await (await route.fetch()).json();
      results = batched ? json : [json];
    } else results = ops.map(() => ({ result: { data: { json: {} } } }));
    await Promise.all(ops.map(async (op, i) => {
      let data: unknown;
      if (op === 'comparables.list') data = { comps: hasEvidence ? [comp] : [], subject: { status: 'no-postcode' } };
      else if (op === 'org.policy' && opts.metric) data = { ...results[i]?.result?.data?.json, region: 'AU' };
      else if (op === 'comparables.upsert') {
        calls.saves++;
        await opts.delaySave;
        if (opts.failSave) {
          results[i] = { error: { json: { message: 'Save refused', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } };
          return;
        }
        const body = JSON.parse(request.postData()!);
        const patch = (batched ? body[i] : body).json;
        calls.writes.push(patch);
        Object.assign(comp, patch);
        hasEvidence = true;
        data = comp;
      } else if (op === 'comparables.applyToAppraisal') {
        calls.applies++;
        data = { supportedPsf: Math.round(weightedComparables([{ address: comp.address, basePsf: comp.basePsf, adjustments: { size: comp.adjSize, condition: comp.adjCondition, date: comp.adjDate, location: comp.adjLocation } }]).supportedPsf) };
      }
      if (data !== undefined) results[i] = { result: { data: { json: data } } };
    }));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(batched ? results : results[0]) });
  });
  await page.goto(`/deal/${id}/comparables`);
  await expect(page.getByRole('heading', { name: 'Sales comparison — adjustment grid' })).toBeVisible();
  return calls;
}

test('metric evidence uses the workspace unit in the weighted total and range', async ({ page }) => {
  await evidence(page, { metric: true });
  await expect(page.getByText('Sale £/m²', { exact: true })).toBeVisible();
  await expect(page.getByText('Weighted supported value', { exact: true }).locator('..')).toContainText('£2,368');
  await expect(page.getByText('Range', { exact: true }).locator('..')).toContainText('£2,368–£2,368');
});

test('no evidence cannot claim high confidence or a supported zero valuation', async ({ page }) => {
  await evidence(page, { empty: true });
  await expect(page.getByText('Not assessed — no evidence', { exact: true })).toBeVisible();
  await expect(page.getByText('High confidence', { exact: true })).toHaveCount(0);
  const supported = page.getByText('Supported blended value', { exact: true }).locator('..');
  await expect(supported).toContainText('—');
  await expect(supported).not.toContainText('£0');
});

test('Apply waits for blur saves and editing invalidates the applied confirmation', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls = await evidence(page, { delaySave: gate });
  const adjustment = page.getByRole('spinbutton', { name: 'Test evidence Size adjustment %', exact: true });
  await adjustment.fill('15');
  await page.getByRole('button', { name: 'Apply & open appraisal', exact: true }).click();
  await expect.poll(() => calls.saves).toBeGreaterThan(0);
  expect(calls.applies).toBe(0);
  await expect(page.getByRole('button', { name: 'Applying evidence…', exact: true })).toBeDisabled();
  release();
  await expect(page.getByText('Applied — unit caps set to £253/ft²', { exact: true })).toBeVisible();
  expect(calls.applies).toBe(1);
  await adjustment.fill('20');
  await expect(page.getByText(/Applied — unit caps/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply & open appraisal', exact: true })).toBeVisible();
});

test('a failed evidence save never applies the old server figures', async ({ page }) => {
  const calls = await evidence(page, { failSave: true });
  await page.getByRole('spinbutton', { name: 'Test evidence Size adjustment %', exact: true }).fill('15');
  await page.getByRole('button', { name: 'Apply & open appraisal', exact: true }).click();
  await expect(page.getByText(/Evidence was not saved: Save refused/)).toBeVisible();
  expect(calls.applies).toBe(0);
  await expect(page.getByRole('spinbutton', { name: 'Test evidence Size adjustment %', exact: true })).toHaveValue('15');
});


test('adding evidence asks for real inputs instead of creating a placeholder rate', async ({ page }) => {
  const calls = await evidence(page, { empty: true, metric: true });
  await page.getByRole('button', { name: 'Add comp', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add comparable evidence', exact: true });
  await expect(form).toBeVisible();
  expect(calls.saves).toBe(0);
  await expect(page.getByLabel('Sale rate (£/m²)', { exact: true })).toHaveValue('');
  await page.getByLabel('Property address', { exact: true }).fill('12 Recorded Road');
  await page.getByLabel('Sale rate (£/m²)', { exact: true }).fill('220');
  await page.getByLabel('Source and sale details', { exact: true }).fill('Recorded sale, 1 October 2026');
  await page.getByRole('button', { name: 'Save comparable', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(calls.writes).toHaveLength(1);
  expect(calls.writes[0]).toMatchObject({ address: '12 Recorded Road', meta: 'Recorded sale, 1 October 2026' });
  expect(ratePerAreaIn(Number(calls.writes[0].basePsf), 'm²')).toBeCloseTo(220, 8);
  await expect(page.getByText('12 Recorded Road', { exact: true })).toBeVisible();
});

test('cancelling new evidence discards the draft without saving invented data', async ({ page }) => {
  const calls = await evidence(page, { empty: true });
  await page.getByRole('button', { name: 'Add comp', exact: true }).click();
  await page.getByLabel('Property address', { exact: true }).fill('Unsaved property');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Add comparable evidence', exact: true })).toHaveCount(0);
  expect(calls.saves).toBe(0);
  await expect(page.getByText('Not assessed — no evidence', { exact: true })).toBeVisible();
});

test('a failed new-evidence save retains every entered field for retry', async ({ page }) => {
  const calls = await evidence(page, { empty: true, failSave: true });
  await page.getByRole('button', { name: 'Add comp', exact: true }).click();
  await page.getByLabel('Property address', { exact: true }).fill('12 Recorded Road');
  await page.getByLabel('Sale rate (£/ft²)', { exact: true }).fill('220');
  await page.getByLabel('Source and sale details', { exact: true }).fill('Recorded sale evidence');
  await page.getByRole('button', { name: 'Save comparable', exact: true }).click();
  await expect(page.getByText(/Evidence was not saved: Save refused/)).toBeVisible();
  await expect(page.getByLabel('Property address', { exact: true })).toHaveValue('12 Recorded Road');
  await expect(page.getByLabel('Sale rate (£/ft²)', { exact: true })).toHaveValue('220');
  await expect(page.getByLabel('Source and sale details', { exact: true })).toHaveValue('Recorded sale evidence');
  expect(calls.saves).toBe(1);
  expect(calls.applies).toBe(0);
});
