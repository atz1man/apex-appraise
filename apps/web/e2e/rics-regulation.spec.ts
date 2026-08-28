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


/**
 * The Red Book may weight its approaches, and may conclude on a figure that is
 * not their blend — but it must not say it blended them when it did not.
 *
 * Section 3 shows three approaches, each with a "Weight N%". Those weights are
 * deliberate: they follow the scheme rather than sitting at a fixed 70/20/10,
 * and `screens.spec.ts` holds them to it. They express EMPHASIS, which is what
 * the prose above them says — primary reliance on the comparable method, the
 * others "prepared as cross-checks and afforded limited weight".
 *
 * The conclusion beneath was headed "Reconciled Market Value", which claims a
 * different thing: an arithmetic. Measured on the seeded scheme:
 *
 *   Comparable  £14,925,000 × 70%  = 10,447,500
 *   DRC         £10,847,000 × 20%  =  2,169,400
 *   Investment  £13,975,000 × 10%  =  1,397,500
 *                                    ——————————
 *                                     14,014,400   against a stated 14,925,000
 *
 * £910,600 apart, under a valuer's signature. The Market Value is
 * `reportedMarketValue(R.gdv)` — the derivation `one-engine-sweep` owns — so
 * the value is right and the word was wrong.
 *
 * Stated as the general property, so either half can move: weight them how you
 * like, conclude where you like, but if the page calls the conclusion a
 * reconciliation then the weights have to produce it.
 */
test('the Red Book does not call its conclusion a reconciliation unless the weights produce it', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id as string;
  });
  await page.goto(`/deal/${id}/redbook`);
  await expect(page.locator('.a4-page').first()).toBeVisible();

  const methodology = page.locator('.a4-page').filter({ hasText: 'Valuation methodology' });
  const text = await methodology.innerText();

  /**
   * Read the approach CARDS, not a regex across the page.
   *
   * The first version of this matched "£value, one line, Weight N%", and a
   * mutation printing the weight one line further down walked straight past it
   * — the check reporting success for a question it had stopped asking. Same
   * lesson as the residual table in `report-figures.spec.ts`.
   */
  const approaches: Array<{ value: number; weight: number }> = [];
  for (const name of ['Comparable', 'DRC', 'Investment']) {
    const card = methodology.locator('div').filter({ hasText: new RegExp(`^${name}£`) }).last();
    if (!(await card.count())) continue;
    const t = await card.innerText();
    const w = /Weight\s*(\d+)\s*%/.exec(t);
    const v = /£([\d,]+)/.exec(t);
    if (w && v) approaches.push({ value: Number(v[1]!.replace(/,/g, '')), weight: Number(w[1]) });
  }

  // teeth now, not only under a future change: the panel is still three
  // weighted approaches, which is the behaviour screens.spec.ts pins
  expect(approaches, 'three weighted approaches are on the page').toHaveLength(3);
  expect(approaches.reduce((a, x) => a + x.weight, 0), 'the weights total 100%').toBe(100);

  const stated = /market value\s*\n\s*£([\d,]+)/i.exec(text);
  expect(stated, 'the Red Book states a Market Value').not.toBeNull();
  const mv = Number(stated![1]!.replace(/,/g, ''));

  /** does the page claim the conclusion IS the blend? */
  const claimsABlend = /reconcil|weighted average|blend/i.test(text);
  if (!claimsABlend) return;

  const blend = approaches.reduce((a, x) => a + (x.value * x.weight) / 100, 0);
  expect(
    Math.abs(blend - mv),
    `the page calls its conclusion a reconciliation, but the weights give £${Math.round(blend).toLocaleString('en-GB')} against a stated £${mv.toLocaleString('en-GB')}`,
  ).toBeLessThanOrEqual(1000); // the statement is rounded to the nearest £1,000
});
