import { expect, test, type Page } from '@playwright/test';

/**
 * A claim about the firm, printed on documents that go to a lender.
 *
 * Measured on the demo workspace: "RICS Regulated" appeared on the Red Book
 * cover, again as a seal beside the valuer's signature, and on the terms of
 * engagement the client signs — as a literal in two components, for every firm
 * on the platform. `Organisation` held no field that could ever have made it
 * true, so the mark said exactly the same thing about a regulated firm and an
 * unregulated one.
 *
 * The Red Book already had to be cured of this one level down, where the
 * valuer's name and RICS registration number were hardcoded and "belong to a
 * real registered valuer who has never seen the property". There the claim was
 * about a person; here it is about the firm.
 *
 * Driven in both states rather than read: a component that ignored the declared
 * number and hardcoded the mark passes any test that only ever sees one of them.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

const mutate = (page: Page, path: string, json: unknown) =>
  page.evaluate(
    ([p, body]) =>
      fetch(`/trpc/${p}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ json: body }),
      })
        .then((r) => r.json())
        .then((j) => ({ ok: !j.error, data: j.result?.data?.json ?? null, err: j.error?.json?.message ?? null })),
    [path, json] as const,
  );

const MARK = /RICS\s*Regulated/i;
const NUMBER = '907731';

test('the RICS mark appears only where the firm has declared its number', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);

  const created = await mutate(page, 'deals.create', {
    name: `Regulation Check ${Date.now()}`,
    address: '1 Register Row, Bournemouth',
    assetType: 'RESIDENTIAL',
    stage: 'APPRAISAL',
  });
  expect(created, `could not create a deal: ${created.err}`).toMatchObject({ ok: true });
  const id = (created.data as { id: string }).id;
  const saved = await mutate(page, 'appraisal.save', {
    dealId: id,
    input: {
      units: [{ label: '2-bed apartments', count: 8, area: 750, cap: 420 }],
      efficiency: 85,
      trades: [{ label: 'Superstructure', rate: 118 }],
      profFeePct: 11,
      contingencyPct: 5,
      otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 20,
    },
    label: 'Base',
  });
  expect(saved, `appraisal.save failed: ${saved.err}`).toMatchObject({ ok: true });

  const documents = async () => {
    await page.goto(`/deal/${id}/redbook`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    const report = await page.locator('body').innerText();
    await page.goto(`/deal/${id}/engagement/document`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    return { report, terms: await page.locator('body').innerText() };
  };

  /** put the workspace back however this test ends — the demo firm is shared */
  const restore = async (value: string) => {
    const res = await mutate(page, 'org.update', { ricsFirmNumber: value });
    expect(res, `org.update failed: ${res.err}`).toMatchObject({ ok: true });
  };

  const before = ((await mutate(page, 'org.update', {})).data as { ricsFirmNumber?: string })?.ricsFirmNumber ?? '';

  try {
    // ---- nothing declared: no mark anywhere ----
    await restore('');
    const bare = await documents();
    expect(bare.report, 'the report claimed RICS regulation the firm has not declared').not.toMatch(MARK);
    expect(bare.terms, 'the terms claimed RICS regulation the firm has not declared').not.toMatch(MARK);

    // ---- declared: the mark appears, and carries the number a reader can check ----
    await restore(NUMBER);
    const marked = await documents();
    expect(marked.report, 'the mark went missing once the firm declared its number').toMatch(MARK);
    expect(marked.report, 'the mark named no number, so nobody can check it').toContain(NUMBER);
    expect(marked.terms).toMatch(MARK);
    expect(marked.terms).toContain(NUMBER);
  } finally {
    await restore(before);
  }
});
