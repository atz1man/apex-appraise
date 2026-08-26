import { expect, test, type Page } from '@playwright/test';

/**
 * What a signed valuation is entitled to claim about its own certainty.
 *
 * Measured on the demo workspace, on a deal with no comparables on file: the
 * certificate printed an "Indicated value range" of £3,477,000 – £3,691,000 —
 * Market Value ± 2.5% of GDV, typeset in the same face, weight and row as one
 * derived from evidence — and stated "Valuation confidence assessed as medium
 * under the RICS confidence framework". Neither had anything behind it, and the
 * reconciliation page drew both onto a scale bar with the opinion marked inside
 * a spread that did not exist.
 *
 * `238d265` fixed this same file's sibling claim, where the narrative declared
 * "the evidence base of 1 comparable is considered adequate for the class" on
 * any count above zero. This is that defect one panel over: a reader who cannot
 * tell a supported figure from an unsupported one cannot discount it, which is
 * what makes printing it worse than printing nothing.
 *
 * Both states are driven here rather than read. `valuation-confidence.test.ts`
 * holds the decision itself; what this adds is that the page asks it — a
 * component that ignored the module and hardcoded either answer passes the unit
 * tests and fails here.
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

const call = (page: Page, path: string, input: string) =>
  page.evaluate(
    ([p, i]) =>
      fetch(`/trpc/${p}?input=${encodeURIComponent(JSON.stringify({ json: i }))}`, {
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      })
        .then((r) => r.json())
        .then((j) => j.result?.data?.json ?? null),
    [path, input] as const,
  );

const APPRAISAL_INPUT = {
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
};

/**
 * Adjustments of zero, so the supported rate is the base rate and the range the
 * page prints is arithmetic this test can check rather than re-derive. The
 * spread is deliberately wide enough that no rounding to the nearest £1,000
 * could collapse it.
 */
const COMPS = [
  { address: '14 Evidence Row, Bournemouth', basePsf: 400 },
  { address: '22 Evidence Row, Bournemouth', basePsf: 430 },
  { address: '31 Evidence Row, Bournemouth', basePsf: 460 },
];

const GRADE = /assessed as (high|medium|low)\b/i;

/**
 * The value printed under an uppercase panel label. The grade is claimed twice —
 * once in the certificate's prose and once as a bare word in the "Valuation
 * confidence" tile on the comparables page — and a component that ignored the
 * module and hardcoded a grade passed this spec until the tile was read too.
 */
const panelValue = (body: string, label: string) =>
  (body.match(new RegExp(`${label}\\n([^\\n]+)`, 'i')) ?? [])[1]?.trim() ?? null;

test('the Red Book grades its confidence on evidence, or says it has none', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);

  /**
   * On a deal of its own: this one adds comparables, `comparables.upsert` has no
   * inverse, and a spec sharing the deal would then be reading evidence it did
   * not put there. Every seeded deal is already claimed — the note in
   * screens.spec.ts keeps that list.
   */
  const created = await mutate(page, 'deals.create', {
    name: `Confidence Check ${Date.now()}`,
    address: '1 Evidence Row, Bournemouth',
    assetType: 'RESIDENTIAL',
    stage: 'APPRAISAL',
  });
  expect(created, `could not create a deal: ${created.err}`).toMatchObject({ ok: true });
  const id = (created.data as { id: string }).id;

  const saved = await mutate(page, 'appraisal.save', { dealId: id, input: APPRAISAL_INPUT, label: 'Base' });
  expect(saved, `appraisal.save failed: ${saved.err}`).toMatchObject({ ok: true });

  const redbookText = async () => {
    await page.goto(`/deal/${id}/redbook`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    await expect(page.getByText('Indicated value range')).toBeVisible();
    return page.locator('body').innerText();
  };

  // ---- no comparables: no range, no grade, and a reason in place of both ----
  const bare = await redbookText();
  expect(bare, 'a RICS confidence grade was asserted with no market evidence').not.toMatch(GRADE);
  expect(bare, 'the certificate should say why it is not grading').toMatch(/no comparable evidence is held/i);
  expect(panelValue(bare, 'Valuation confidence'), 'the confidence tile graded a valuation with no evidence').toBe('—');
  expect(bare, 'a value range was printed with nothing supporting it').toContain('Not assessed — no comparable evidence');

  /**
   * The specific fabrication this replaced: Market Value ± 2.5% of GDV. Asserted
   * against the engine's own figures rather than against numbers typed here, so
   * a change to the fixture cannot quietly make this pass.
   */
  const R = ((await call(page, 'appraisal.getCurrent', id)) as { result: { gdv: number; nia: number } } | null)?.result;
  expect(R?.gdv, 'no current appraisal on this deal').toBeGreaterThan(0);
  const mv = Math.round(R!.gdv / 1_000) * 1_000; // the report's Market Value, to the nearest £1,000
  expect(bare, 'the Market Value the old band was drawn around is not on the page').toContain(
    `£${mv.toLocaleString('en-GB')}`,
  );
  for (const fabricated of [mv - R!.gdv * 0.025, mv + R!.gdv * 0.025]) {
    const printed = `£${(Math.round(fabricated / 1_000) * 1_000).toLocaleString('en-GB')}`;
    expect(bare, `the ±2.5%-of-GDV band is still on the page as ${printed}`).not.toContain(printed);
  }

  // ---- with comparables: the range comes from them, and the grade is stated ----
  for (const c of COMPS) {
    const res = await mutate(page, 'comparables.upsert', { dealId: id, ...c });
    expect(res, `comparables.upsert failed: ${res.err}`).toMatchObject({ ok: true });
  }
  const evidenced = await redbookText();
  expect(evidenced, 'the grade went missing once there was evidence to give one').toMatch(GRADE);
  expect(evidenced).not.toMatch(/no comparable evidence is held/i);
  expect(panelValue(evidenced, 'Valuation confidence'), 'the tile withheld a grade the evidence supports').toMatch(
    /^(High|Medium|Low)$/,
  );

  /**
   * The comparables' own low and high rate across the net internal area — the
   * only range the evidence supports. Read from the API, not restated.
   */
  const nia = R!.nia;
  const rates = COMPS.map((c) => c.basePsf);
  for (const rate of [Math.min(...rates), Math.max(...rates)]) {
    const bound = `£${(Math.round((rate * nia) / 1_000) * 1_000).toLocaleString('en-GB')}`;
    expect(evidenced, `the range no longer runs to ${bound}, which is what the comparables support`).toContain(bound);
  }
});
