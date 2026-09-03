import { expect, test, type Page } from '@playwright/test';

/**
 * What the Red Book says about evidence it does not have, and about checks
 * nobody recorded.
 *
 * Section 4 ends with a "Basis of adjustment" paragraph. It was printed
 * unconditionally, so on a deal with no comparables the same page said, two
 * inches apart:
 *
 *   "No comparable evidence logged for this deal yet"
 *   "Comparables have been adjusted for differences in size, condition,
 *    location and date of sale..."
 *
 * and closed with a claim that was wrong even WHERE there are comparables:
 * "All evidence is drawn from open-market arm's-length transactions verified
 * against HM Land Registry sold-price records and local agency confirmation."
 *
 * `Comparable` holds address, meta, basePsf and four adjustment percentages.
 * Nothing about where the evidence came from, and nothing about who checked
 * it. A comparable typed by hand and one imported by `sitepack.applyComps`
 * are indistinguishable to this report, and it asserted Land Registry
 * verification over both — the same shape as the RICS mark before
 * `Organisation.ricsFirmNumber` existed (`rics-regulation.spec.ts`), one
 * document over.
 *
 * It also contradicted the valuer. The terms of engagement carry
 * `sourcesOfInformation`, written by the valuer, saying by default that
 * information "is relied upon as accurate and is not independently verified".
 * The report never printed that, and printed this instead.
 *
 * Driven in BOTH states on one deal, because a paragraph that is correctly
 * absent and a paragraph that was never reached look identical from one run.
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

const APPRAISAL = {
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

/** the sentence that no field could ever have made true */
const VERIFICATION_CLAIM = /verified against HM Land Registry|local agency confirmation/i;
/** the description of work done on evidence */
const ADJUSTMENT_PROSE = /Comparables have been adjusted for differences/i;

test('the Red Book describes adjusting evidence only where there is evidence', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);

  const created = await mutate(page, 'deals.create', {
    name: `Evidence Basis ${Date.now()}`,
    address: '3 Register Row, Bournemouth',
    assetType: 'RESIDENTIAL',
    stage: 'APPRAISAL',
  });
  expect(created, `could not create a deal: ${created.err}`).toMatchObject({ ok: true });
  const id = (created.data as { id: string }).id;
  const saved = await mutate(page, 'appraisal.save', { dealId: id, input: APPRAISAL, label: 'Base' });
  expect(saved, `appraisal.save failed: ${saved.err}`).toMatchObject({ ok: true });

  const report = async () => {
    await page.goto(`/deal/${id}/redbook`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    // the comparable schedule is the page under test — wait for it specifically,
    // so a slow render cannot pass this test by showing an absent paragraph
    await expect(page.getByText('Comparable evidence').first()).toBeVisible();
    return page.locator('body').innerText();
  };

  // ---- no comparables: the page must not describe adjusting them ----
  const bare = await report();
  expect(bare, 'the schedule did not report the empty state — this test is reading the wrong page').toContain(
    'No comparable evidence logged',
  );
  expect(bare, 'the report described adjustments to evidence it had just said did not exist').not.toMatch(ADJUSTMENT_PROSE);

  // ---- with comparables: the methodology appears, the unsupported claim does not ----
  /**
   * Typed by hand, deliberately. These are the comparables the report had the
   * least business claiming Land Registry verification over: nobody imported
   * them from anywhere, and `Comparable` records nothing that says so.
   */
  for (const c of [
    { address: '12 Quay Road', meta: 'Valuer’s own records · agency confirmation', basePsf: 430, adjSize: -2, adjDate: 1.5 },
    { address: '18 Quay Road', meta: 'Valuer’s own records', basePsf: 412, adjCondition: 3 },
  ]) {
    const res = await mutate(page, 'comparables.upsert', { dealId: id, ...c });
    expect(res, `comparables.upsert failed: ${res.err}`).toMatchObject({ ok: true });
  }

  const evidenced = await report();
  expect(evidenced, 'the methodology went missing once there was evidence to describe').toMatch(ADJUSTMENT_PROSE);
  expect(
    evidenced,
    'the report asserted Land Registry verification, which no field on Comparable records',
  ).not.toMatch(VERIFICATION_CLAIM);
});
