import { expect, test, type Page } from '@playwright/test';

/**
 * Who a Red Book report says valued the property.
 *
 * `engagement.get` answers an unsaved DRAFT when a deal has no terms, prefilled
 * for the form: `valuerName` is whoever is signed in and `valuerReg` is the
 * firm's house default. Both reports read the valuer off that answer without
 * asking which kind it was. Measured on this workspace: 8 of 12 deals had no
 * saved terms, and the Red Book cover and signature block for every one of
 * them named the signed-in user as the valuer with "MRICS · RICS Registered
 * Valuer no. 1148207" under their name — a different valuer for each person
 * who opened the page, and chartered status nobody had claimed for them.
 *
 * Driven in both states: a report with no terms names nobody, and the same
 * report names the valuer the moment the terms are saved. The unit test in
 * `lib/valuer.test.ts` holds the rule; this proves the page uses it.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
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
  clientName: 'Valuer Check Ltd', clientAddress: '', otherUsers: 'None.', purpose: 'Loan security.',
  interest: 'Freehold.', basisOfValue: 'Market Value', valuationDate: null,
  extentOfInvestigation: 'Inspection.', sourcesOfInformation: 'Client.', assumptions: 'Standard.',
  specialAssumptions: 'None.', reportFormat: 'PDF.', restrictionsOnUse: 'None.', feeBasis: 'Fixed.',
  liabilityCap: null, complaintsProcedure: 'RICS.', aiUse: 'May be used.',
  valuerName: 'Dana Whitlock MRICS', valuerReg: 'RICS Registered Valuer no. 7654321',
};

test('the Red Book names a valuer only from saved terms of engagement', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const created = await call(page, 'deals.create', {
    name: `Valuer Check ${Date.now()}`, address: '1 Signature Row, Bournemouth', assetType: 'RESIDENTIAL', stage: 'APPRAISAL',
  });
  expect(created.ok, created.err ?? '').toBe(true);
  const id = (created.data as { id: string }).id;
  const saved = await call(page, 'appraisal.save', { dealId: id, input: APPRAISAL_INPUT, label: 'Base' });
  expect(saved.ok, saved.err ?? '').toBe(true);

  // what the draft WOULD have printed — the precondition this test exists for
  const draft = await call(page, 'engagement.get', id, 'GET');
  expect(draft.ok, draft.err ?? '').toBe(true);
  const d = draft.data as { saved: boolean; valuerName: string; valuerReg: string };
  expect(d.saved).toBe(false);
  expect(d.valuerName, 'the draft names nobody, so there is nothing here to guard against').not.toBe('');

  const pages = async () => {
    await page.goto(`/deal/${id}/redbook`);
    await page.waitForSelector('.a4-page', { timeout: 20_000 });
    return page.locator('.a4-page').allInnerTexts().then((t) => t.join('\n'));
  };

  // ---- no terms: no valuer, no credentials ----
  const unsigned = await pages();
  expect(unsigned).toContain('Not named in the terms of engagement');
  if (d.valuerReg.trim()) {
    expect(unsigned, 'the firm’s house registration text was printed under an unsaved name').not.toContain(d.valuerReg.trim());
  }
  // the signature block is the same story one page on: no name over the line
  await expect(page.getByText('For and on behalf of')).toHaveCount(0);

  // ---- terms saved: the valuer they name, and only then ----
  const terms = await call(page, 'engagement.save', { dealId: id, terms: TERMS });
  expect(terms.ok, terms.err ?? '').toBe(true);
  const signed = await pages();
  expect(signed).toContain('Dana Whitlock MRICS');
  expect(signed).toContain('RICS Registered Valuer no. 7654321');
  expect(signed).not.toContain('Not named in the terms of engagement');
});
