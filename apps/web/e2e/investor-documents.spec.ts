import { expect, test, type Page } from '@playwright/test';

/**
 * A document reaches an investor, and the file behind it opens.
 *
 * The investor portal's Documents panel was fed from `Investor.documents` — a
 * JSON list of names on the investor row that nothing but the demo seed ever
 * wrote, with a download icon beside each name that downloaded nothing. The
 * API half is held in `apps/api/test/investor-documents.test.ts`. This is the
 * half that suite cannot reach: that a person in the data room has a control
 * to share a file with investors at all, that the LP then sees it, and that
 * the link they are given actually serves the bytes — signed for them, and for
 * nobody who merely knows the path.
 */

const signIn = async (page: Page, email = 'arthur@apexappraise.co.uk') => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
};

const call = (page: Page, path: string, json: unknown, method: 'GET' | 'POST' = 'POST') =>
  page.evaluate(
    async ([p, body, m]) => {
      const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}` };
      const r =
        m === 'GET'
          ? await fetch(`/trpc/${p}?input=${encodeURIComponent(JSON.stringify({ json: body }))}`, { headers: auth })
          : await fetch(`/trpc/${p}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ json: body }) });
      const j = await r.json();
      return { ok: !j.error, data: j.result?.data?.json ?? null, err: j.error?.json?.message ?? null };
    },
    [path, json, method] as const,
  );

test('a file shared from the data room opens in the investor’s portal', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await expect(page.getByText('Deal tools')).toBeVisible();

  // the LP the demo investor login signs in as — the seed maps it to Meridian
  const investors = await call(page, 'investors.list', null, 'GET');
  expect(investors.ok, investors.err ?? '').toBe(true);
  const meridian = (investors.data as Array<{ id: string; name: string }>).find((i) => i.name === 'Meridian Capital LP');
  expect(meridian, 'the seed no longer has Meridian Capital LP — pick the LP investor@demo.co.uk maps to').toBeTruthy();

  // a deal of this test's own, held by that LP
  const created = await call(page, 'deals.create', {
    name: `Investor Docs ${Date.now()}`, address: '1 Syndicate Way, Poole', assetType: 'RESIDENTIAL', stage: 'CONSTRUCTION',
  });
  expect(created.ok, created.err ?? '').toBe(true);
  const dealId = (created.data as { id: string }).id;
  const held = await call(page, 'investors.setHolding', { investorId: meridian!.id, dealId, committed: 250_000 });
  expect(held.ok, held.err ?? '').toBe(true);

  // a real file, through the real upload route
  const name = `Investor pack ${Date.now()}.txt`;
  const body = `for the syndicate only ${Date.now()}`;
  const uploaded = await page.evaluate(
    async ([deal, filename, text]) => {
      const fd = new FormData();
      fd.append('dealId', deal);
      fd.append('category', 'Finance');
      fd.append('file', new Blob([text], { type: 'text/plain' }), filename);
      const r = await fetch('/uploads/document', {
        method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` }, body: fd,
      });
      return { status: r.status, json: (await r.json()) as { id?: string; url?: string; error?: string } };
    },
    [dealId, name, body] as const,
  );
  expect(uploaded.status, uploaded.json.error ?? '').toBe(200);

  // the control this test is about
  await page.goto(`/deal/${dealId}/dataroom`);
  const box = page.getByRole('checkbox', { name: `Share ${name} with investors` });
  await expect(box, 'no investor control in the data room at all').toBeVisible({ timeout: 20_000 });
  await expect(box).not.toBeChecked();
  // click, not check(): a controlled box re-renders a tick after the click, and
  // check() reads it in between; the assertion after retries until it settles
  await box.click();
  await expect(page.getByText('Shared with investors')).toBeVisible();
  await expect(box).toBeChecked();
  // RELOAD before believing it — a checkbox that only moves in the browser is the defect
  await page.reload();
  await expect(page.getByRole('checkbox', { name: `Share ${name} with investors` })).toBeChecked();
  // and the access panel says who that reaches
  await expect(page.getByText('Meridian Capital LP', { exact: true })).toBeVisible();
  await expect(page.getByText('1 shared document')).toBeVisible();

  // now as the LP
  await signIn(page, 'investor@demo.co.uk');
  await page.waitForURL('**/portal/investor');
  const link = page.getByRole('link', { name: `Open ${name}` });
  await expect(link, 'the shared document did not reach the investor’s portal').toBeVisible({ timeout: 20_000 });
  const href = (await link.getAttribute('href')) ?? '';
  expect(href.startsWith('/uploads/files/')).toBe(true);
  expect(href, 'the link carries no file token — a new tab sends no bearer header').toContain('?t=');

  // the link serves the bytes; the same path without its token serves nothing
  const fetched = await page.evaluate(async (u) => {
    const [signed, bare] = await Promise.all([fetch(u), fetch(u.split('?')[0]!)]);
    return { signed: signed.status, text: await signed.text(), bare: bare.status };
  }, href);
  expect(fetched.signed).toBe(200);
  expect(fetched.text).toBe(body);
  expect(fetched.bare, 'the file is reachable by anyone who knows its path').toBe(404);
});
