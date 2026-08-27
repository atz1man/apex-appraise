import { expect, test, type Page } from '@playwright/test';

/**
 * What the printed documents say about dates.
 *
 * Every date on both reports was `new Date()` — the moment the file was opened.
 * Measured on the demo workspace: accepted terms of engagement stating
 * 30 June 2026, no inspection on file, and a Red Book report printing
 * 25 August 2026 as its valuation date, its inspection date and the date under
 * the valuer's signature. So the document contradicted the contract it was
 * instructed under, asserted an inspection of a property nobody had attended,
 * and re-dated its own signature every time anybody opened it.
 *
 * These assert AGREEMENT with the record rather than fixed dates, so another
 * spec inspecting this deal cannot make them wrong.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

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

const northgate = (page: Page) =>
  page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });

const longDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

/** the value printed under an uppercase panel label on the report's front sheet */
const panelValue = (body: string, label: string) => {
  const m = body.match(new RegExp(`${label}\\n([^\\n]+)`, 'i'));
  return m?.[1]?.trim() ?? null;
};

test('the Red Book prints the dates in the record, not the day it is opened', async ({ page }) => {
  await signIn(page);
  const id = await northgate(page);
  const toe = (await call(page, 'engagement.get', id)) as { valuationDate: string | null };
  const inspection = (await call(page, 'inspections.get', id)) as { inspectedAt: string } | null;

  await page.goto(`/deal/${id}/redbook`);
  await page.waitForSelector('.a4-page', { timeout: 20_000 });
  const body = await page.locator('body').innerText();

  // the date the client agreed, not today
  expect(toe.valuationDate, 'the fixture needs terms carrying a valuation date').toBeTruthy();
  expect(panelValue(body, 'VALUATION DATE')).toBe(longDate(toe.valuationDate!));

  if (inspection) {
    expect(panelValue(body, 'INSPECTION DATE')).toBe(longDate(inspection.inspectedAt));
  } else {
    // a date here would assert that a professional attended a property. The
    // page applies the same rule to the valuer's name: "an unsigned valuation
    // is a fixable state and a falsely signed one is not."
    expect(body).toContain('No inspection is recorded for this property');
    expect(panelValue(body, 'INSPECTION DATE')).not.toBe(
      new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }),
    );
  }
});

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

const TERMS = {
  clientName: 'Signature Check Ltd', clientAddress: '', otherUsers: 'None.', purpose: 'Loan security.',
  interest: 'Freehold.', basisOfValue: 'Market Value', valuationDate: null,
  extentOfInvestigation: 'Inspection.', sourcesOfInformation: 'Client.', assumptions: 'Standard.',
  specialAssumptions: 'None.', reportFormat: 'PDF.', restrictionsOnUse: 'None.', feeBasis: 'Fixed.',
  liabilityCap: null, complaintsProcedure: 'RICS.', aiUse: 'May be used.',
  valuerName: 'Dana Whitlock MRICS', valuerReg: 'RICS Registered Valuer',
};

test('the signature block dates a signature only when there was one', async ({ page }) => {
  /**
   * The unnamed-valuer branch of this block already refuses to print "a date
   * pretending it was signed". A version nobody approved, printed under a named
   * valuer with a date beside it, is the same claim with a name on it.
   *
   * Both states are driven here rather than read, because a test that only ever
   * sees the one its fixture happens to be in guards half the branch.
   *
   * On a deal of its own: this one approves an appraisal, and an approved
   * version cannot be edited in place, so any spec sharing the deal would then
   * be refused. Every seeded deal is already claimed by some spec — the note in
   * screens.spec.ts keeps that list — so this makes its own.
   */
  await signIn(page);
  const created = await mutate(page, 'deals.create', {
    name: `Signature Check ${Date.now()}`,
    address: '1 Signature Row, Bournemouth',
    assetType: 'RESIDENTIAL',
    stage: 'APPRAISAL',
  });
  expect(created, `could not create a deal: ${created.err}`).toMatchObject({ ok: true });
  const id = (created.data as { id: string }).id;

  for (const [path, body] of [
    ['engagement.save', { dealId: id, terms: TERMS }],
    ['appraisal.save', { dealId: id, input: APPRAISAL_INPUT, label: 'Base' }],
  ] as const) {
    const res = await mutate(page, path, body);
    expect(res, `${path} failed: ${res.err}`).toMatchObject({ ok: true });
  }

  const redbookText = async () => {
    await page.goto(`/deal/${id}/redbook`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    return page.locator('body').innerText();
  };
  const current = () =>
    call(page, 'appraisal.getCurrent', id) as Promise<{ id: string; reviewedAt: string | null }>;

  // ---- unapproved: says so, and prints no signing date ----
  const draft = await redbookText();
  expect(draft, 'the valuer named in the terms should be signing this').toContain('Dana Whitlock MRICS');
  expect(draft).toContain('has not been approved for issue');
  expect(draft, 'a draft printed a signing date').not.toMatch(/Date: \d/);

  // ---- approved: dated when it was signed off, not when it is read ----
  const version = await current();
  for (const [path, body] of [
    ['appraisal.submitForReview', { versionId: version.id }],
    ['appraisal.review', { versionId: version.id, decision: 'approve' }],
  ] as const) {
    const res = await mutate(page, path, body);
    expect(res, `${path} failed: ${res.err}`).toMatchObject({ ok: true });
  }
  const signed = await current();
  expect(
    signed.reviewedAt,
    'getCurrent must carry the signing date — see apps/api/src/routers/appraisal.ts',
  ).toBeTruthy();

  const approved = await redbookText();
  expect(approved).toContain(`Date: ${longDate(signed.reviewedAt!)}`);
  expect(approved).not.toContain('has not been approved for issue');
});

test('a client abroad reads the same dates as the valuer who issued them', async ({ browser }) => {
  const dates = async (timezoneId: string) => {
    const ctx = await browser.newContext({ timezoneId });
    const page = await ctx.newPage();
    await signIn(page);
    const id = await northgate(page);
    await page.goto(`/deal/${id}/redbook`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    const body = await page.locator('body').innerText();
    // every long-form date on the sheet, not just the labelled ones: a date
    // that shifts is a defect wherever it appears
    const out = body.match(/\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/g) ?? [];
    await ctx.close();
    return out;
  };

  const london = await dates('Europe/London');
  // west of Greenwich a UTC-midnight date lands on the day before: this is the
  // browser that read 29 June off a document issued for 30 June
  const newYork = await dates('America/New_York');

  expect(london.length, 'the report printed no dates at all').toBeGreaterThan(0);
  expect(newYork).toEqual(london);
});

/**
 * The document is not allowed to contradict itself.
 *
 * Measured on the demo workspace, on one signed valuation of a deal with no
 * inspection on file, all four of these were printed:
 *
 *   page 2  "No inspection is recorded for this property."
 *   page 3  "...no adverse environmental factors were noted on inspection."
 *   page 3  "the site is identified as Flood Zone 1 (low risk)"
 *   page 7  "the property is not in an area of material flood risk"  (assumed)
 *
 * The first two are a straight contradiction: the certificate discloses that
 * nobody attended and the next page reports what was seen there. The second two
 * contradict in the more dangerous direction — the declaration correctly treats
 * flood risk as an assumption, while page 3 states the zone as identified,
 * which reads as somebody having looked it up. Nobody had; the classification
 * was a literal in the component, printed for every property in the country.
 *
 * This lives here because it is the same rule as the dates above and the
 * photographs before them: state the gap rather than fill it.
 */
test('the Red Book never reports an inspection it has just disclosed did not happen', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);

  /**
   * Both states are driven rather than read, on a deal of its own: this one
   * records an inspection, and a spec sharing the deal would then be reading an
   * inspection it did not put there. Every seeded deal is already claimed — the
   * note in screens.spec.ts keeps that list.
   */
  const created = await mutate(page, 'deals.create', {
    name: `Situation Check ${Date.now()}`,
    address: '1 Situation Row, Bournemouth',
    assetType: 'RESIDENTIAL',
    stage: 'APPRAISAL',
  });
  expect(created, `could not create a deal: ${created.err}`).toMatchObject({ ok: true });
  const id = (created.data as { id: string }).id;
  const saved = await mutate(page, 'appraisal.save', { dealId: id, input: APPRAISAL_INPUT, label: 'Base' });
  expect(saved, `appraisal.save failed: ${saved.err}`).toMatchObject({ ok: true });

  const reportText = async () => {
    await page.goto(`/deal/${id}/redbook`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    return page.locator('body').innerText();
  };
  const body = await reportText();

  /**
   * Never, in either state. An inspection record holds rooms, conditions and
   * notes — nothing about contamination, ground stability or flood — so having
   * attended is not evidence that those were looked at either.
   */
  expect(body, 'a flood zone classification was stated that nothing checked').not.toMatch(/flood zone/i);
  expect(body, 'the report claimed a finding from an inspection').not.toMatch(/noted on inspection/i);

  /**
   * And the flood position is stated once, as the assumption it is, rather than
   * in two places that can drift apart.
   */
  expect(body, 'the general assumption on flood risk has gone').toMatch(/not in an area of material flood risk/i);
  expect(body).toMatch(/flood risk[^.]*general assumptions/i);

  // ---- nothing on file: the gap is disclosed, and nothing is reported from it ----
  expect(body, 'the certificate should disclose that nobody attended').toMatch(/No inspection is recorded/i);
  expect(body, 'the report described an inspection it had just said did not happen').not.toMatch(/was inspected on/i);

  // ---- inspected: both pages say so, and neither invents a finding ----
  const inspected = await mutate(page, 'inspections.save', {
    dealId: id,
    rooms: [{ name: 'Living room', condition: 4, photos: 0, notes: '' }],
    reconciledValue: null,
    approachWeights: { salesComparison: 100, cost: 0, income: 0 },
    status: 'submitted',
  });
  expect(inspected, `inspections.save failed: ${inspected.err}`).toMatchObject({ ok: true });

  const after = await reportText();
  expect(after, 'an inspection is on file and the certificate still disclosed a gap').not.toMatch(
    /No inspection is recorded/i,
  );
  expect(after, 'an inspection is on file and the situation panel did not say so').toMatch(/was inspected on/i);
  expect(after, 'attending a property is not evidence that flood risk was looked at').not.toMatch(/flood zone/i);
  expect(after, 'the report claimed a finding the inspection record does not hold').not.toMatch(/noted on inspection/i);

  /**
   * The two pages read the same value, which is what makes the contradiction
   * impossible rather than merely absent today.
   */
  const record = (await call(page, 'inspections.get', id)) as { inspectedAt: string };
  expect(after).toContain(`was inspected on ${longDate(record.inspectedAt)}`);
});
