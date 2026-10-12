import superjson from 'superjson';
import { test, expect } from '@playwright/test';

test('appraisal saves preserve draft ownership across refreshes and in-flight edits', async ({ page, request }) => {
  test.setTimeout(60_000);
  const orgName = `Appraisal editor ${Date.now()}`;
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Your name').fill('Appraisal Editor');
  await page.getByLabel('Email', { exact: true }).fill(`editor-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));
  const rpc = async (route: string, input: unknown) => {
    const res = await request.post(`/trpc/${route}`, { headers: { authorization: `Bearer ${token}` }, data: superjson.serialize(input) });
    expect(res.status(), await res.text()).toBe(200); return superjson.deserialize<any>((await res.json()).result.data);
  };
  const current = async (dealId: string) => {
    const res = await request.get('/trpc/appraisal.getCurrent', { headers: { authorization: `Bearer ${token}` }, params: { input: JSON.stringify({ json: dealId }) } });
    expect(res.status(), await res.text()).toBe(200); return superjson.deserialize<any>((await res.json()).result.data);
  };
  try {
    const deal = await rpc('deals.create', { name: 'Editor conflict project', address: 'Synthetic site', assetType: 'RESIDENTIAL' });
    await page.goto(`/deal/${deal.id}/appraisal`);
    const label = page.getByLabel('Unit type 1 label', { exact: true });
    await label.fill('Initial saved unit');
    await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    const initial = await current(deal.id);
    await page.reload();
    await expect(label).toHaveValue('Initial saved unit');
    await label.fill('Local unsaved unit');
    const newerInput = { ...initial.input, units: initial.input.units.map((unit: object) => ({ ...unit, label: 'Colleague saved unit', count: 3 })) };
    await rpc('appraisal.save', { dealId: deal.id, input: newerInput, expectedUpdatedAt: initial.updatedAt });
    // The app's staleTime is five seconds. Simulate returning to this tab once
    // stale, and prove the real query received the colleague's newer record.
    await page.waitForTimeout(5100);
    const refreshed = page.waitForResponse(res => res.url().includes('appraisal.getCurrent') && res.request().method() === 'GET');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      window.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      window.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await (await refreshed).text()).toContain('Colleague saved unit');
    await expect(label).toHaveValue('Local unsaved unit');
    const refused = page.waitForResponse(res => res.url().includes('appraisal.save') && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
    expect((await refused).status()).toBe(409);
    expect((await current(deal.id)).input.units[0]).toMatchObject({ label: 'Colleague saved unit', count: 3 });
    await expect(label).toHaveValue('Local unsaved unit');
    // Explicit reload accepts the new snapshot. Consecutive saves must then
    // advance from their own responses, without needing a background refresh.
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(label).toHaveValue('Colleague saved unit');
    for (const name of ['Reviewed unit', 'Reviewed unit again']) {
      await label.fill(name);
      await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
      expect((await current(deal.id)).input.units[0]).toMatchObject({ label: name, count: 3 });
    }
    for (const asVersion of [false, true]) {
      const submitted = asVersion ? 'Submitted version unit' : 'Submitted ordinary unit';
      const continued = asVersion ? 'New edits after version submission' : 'New edits after ordinary submission';
      await label.fill(submitted);
      let release!: () => void;
      let committed!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const wrote = new Promise<void>(resolve => { committed = resolve; });
      await page.route('**/trpc/appraisal.save*', async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed();
        await held;
        await route.fulfill({ response });
      });
      if (asVersion) {
        await page.getByRole('button', { name: /^Versions/ }).click();
        await page.getByPlaceholder('Label this version', { exact: false }).fill('In-flight review version');
        await page.getByRole('button', { name: 'Save as version', exact: true }).click();
        await page.getByRole('button', { name: 'Close Appraisal versions', exact: true }).click();
      } else await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
      await wrote;
      await label.fill(continued);
      release();
      if (asVersion) await expect(page.getByText('Saved version “In-flight review version”', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save appraisal', exact: true })).toBeEnabled();
      await expect(label).toHaveValue(continued);
      expect((await current(deal.id)).input.units[0].label).toBe(submitted);
      // The unsaved warning must survive the older save's success response.
      const warning = page.waitForEvent('dialog');
      const navigate = page.getByRole('link', { name: 'Open project field companion' }).click();
      const dialog = await warning;
      expect(dialog.message()).toContain('have not been saved');
      await dialog.dismiss();
      await navigate;
      await expect(label).toHaveValue(continued);
      await page.unroute('**/trpc/appraisal.save*');
      await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
      expect((await current(deal.id)).input.units[0].label).toBe(continued);
    }
  } finally { await rpc('org.deleteWorkspace', { confirmName: orgName }); }
});

test('restoring an appraisal loads the restored inputs instead of the cached current version', async ({ page, request }) => {
  test.setTimeout(60_000);
  const orgName = `Appraisal editor ${Date.now()}`;
  await page.goto('/register');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByLabel('Your name').fill('Appraisal Editor');
  await page.getByLabel('Email', { exact: true }).fill(`editor-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByLabel('Confirm password').fill('long-test-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));
  const rpc = async (route: string, input: unknown) => {
    const res = await request.post(`/trpc/${route}`, { headers: { authorization: `Bearer ${token}` }, data: superjson.serialize(input) });
    expect(res.status(), await res.text()).toBe(200); return superjson.deserialize<any>((await res.json()).result.data);
  };
  const current = async (dealId: string) => {
    const res = await request.get('/trpc/appraisal.getCurrent', { headers: { authorization: `Bearer ${token}` }, params: { input: JSON.stringify({ json: dealId }) } });
    expect(res.status(), await res.text()).toBe(200); return superjson.deserialize<any>((await res.json()).result.data);
  };
  try {
    const deal = await rpc('deals.create', { name: 'Restore project', address: 'Synthetic site', assetType: 'RESIDENTIAL' });
    await page.goto(`/deal/${deal.id}/appraisal`);
    const label = page.getByLabel('Unit type 1 label', { exact: true });
    await label.fill('Original unit');
    await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    const original = await current(deal.id);
    await rpc('appraisal.save', { dealId: deal.id, input: { ...original.input, units: original.input.units.map((unit: object) => ({ ...unit, label: 'Replacement unit' })) }, asNewVersion: true, label: 'Replacement version' });
    await page.reload();
    await expect(label).toHaveValue('Replacement unit');
    await page.getByRole('button', { name: /^Versions/ }).click();
    // Hold the background query on the pre-restore snapshot. The mutation must
    // supply the exact restored inputs, regardless of cache/refetch timing.
    await page.route('**/trpc/appraisal.getCurrent*', route => route.abort());
    await page.getByRole('button', { name: 'Restore as current', exact: true }).click();
    await expect(page.getByText('Version restored as the new current appraisal', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Appraisal versions', exact: true }).click();
    await expect(label).toHaveValue('Original unit');
    await page.unroute('**/trpc/appraisal.getCurrent*');
    await label.fill('Reviewed restored unit');
    await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    expect((await current(deal.id)).input.units[0].label).toBe('Reviewed restored unit');
    await label.fill('Unsaved draft before restore');
    await page.getByRole('button', { name: /^Versions/ }).click();
    const beforeCancel = await current(deal.id);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Restore as current', exact: true }).first().click();
    expect((await current(deal.id)).id).toBe(beforeCancel.id);
    let release!: () => void;
    let committed!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const wrote = new Promise<void>(resolve => { committed = resolve; });
    await page.route('**/trpc/appraisal.restore*', async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed();
      await held;
      await route.fulfill({ response });
    });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Restore as current', exact: true }).first().click();
    await wrote;
    await page.getByPlaceholder('Label this version', { exact: false }).fill('Cannot overlap restore');
    await expect(page.getByRole('button', { name: 'Save as version', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save appraisal', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close Appraisal versions', exact: true }).click();
    await label.fill('Typed while restoring');
    release();
    await expect(page.getByText('Version restored. Your newer edits remain unsaved in this editor.', { exact: true })).toBeVisible();
    await expect(label).toHaveValue('Typed while restoring');
    await expect(page.getByRole('button', { name: 'Save appraisal', exact: true })).toBeEnabled();
    expect((await current(deal.id)).input.units[0].label).not.toBe('Typed while restoring');
    await page.unroute('**/trpc/appraisal.restore*');
    await page.getByRole('button', { name: 'Save appraisal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    expect((await current(deal.id)).input.units[0].label).toBe('Typed while restoring');

  } finally { await rpc('org.deleteWorkspace', { confirmName: orgName }); }
});
