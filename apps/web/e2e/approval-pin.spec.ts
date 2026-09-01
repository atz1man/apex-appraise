import { expect, test, type Page } from '@playwright/test';

/**
 * A signed figure that can be checked.
 *
 * An approved version used to carry no record of which engine produced the
 * figures somebody signed, and the reports recompute from the inputs with
 * whatever engine ships today — so a rate rule fixed after approval moved the
 * Market Value under the valuer's signature, silently. Now approval pins the
 * engine version and the figures, and both documents say whether the figure
 * they print is the one that was signed.
 *
 * Parkstone Mews is used by no other spec that approves a version; an approved
 * version cannot be edited, so a deal cannot be shared for this.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

test('both reports state that the figures were verified against the approved record', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const tag = `${Date.now()}`.slice(-6);
  const dealId = await page.evaluate(async (label) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const call = async (path: string, json: unknown) => {
      const r = await fetch(`/trpc/${path}`, { method: 'POST', headers: auth, body: JSON.stringify({ json }) });
      const j = await r.json();
      if (!j.result?.data) throw new Error(`${path}: ${j.error?.json?.message ?? 'failed'}`);
      return j.result.data.json;
    };
    const list = await fetch('/trpc/deals.list', { headers: auth });
    const id = (await list.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Parkstone')).id;
    const saved = await call('appraisal.save', {
      dealId: id,
      asNewVersion: true,
      label: `Pinned ${label}`,
      input: {
        units: [{ label: '3-bed houses', count: 6, area: 1100, cap: 395 }],
        efficiency: 88,
        trades: [{ label: 'Build', rate: 132 }],
        profFeePct: 11,
        contingencyPct: 5,
        otherCosts: [],
        finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 16, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
        site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
        disposal: { agentPct: 1.5, legalPct: 0.5 },
        targetProfitOnGdvPct: 20,
      },
    });
    await call('appraisal.submitForReview', { versionId: saved.id });
    await call('appraisal.review', { versionId: saved.id, decision: 'approve' });
    return id;
  }, tag);

  await page.goto(`/deal/${dealId}/redbook`);
  const cover = page.locator('[data-approval-check]').first();
  await expect(cover).toHaveAttribute('data-approval-check', 'verified');
  await expect(page.getByText(/Figures verified against the approved record · engine \d{4}\.\d{2}\.\d+/).first()).toBeVisible();
  // and the same sentence sits under the signature
  await expect(page.locator('[data-approval-check]')).toHaveCount(1);
  await expect(page.getByText(/Figures verified against the approved record/)).toHaveCount(2);

  await page.goto(`/deal/${dealId}/report`);
  await expect(page.locator('[data-approval-check]')).toHaveAttribute('data-approval-check', 'verified');
});

test('the Red Book cover names the client the terms of engagement name, not an invented lender', async ({ page }) => {
  await signIn(page);
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });
  await page.goto(`/deal/${id}/redbook`);
  // Northgate's accepted terms name Halewood; the cover used to print "Northpoint Building Society"
  await expect(page.getByText('Halewood Asset Finance Ltd').first()).toBeVisible();
  await expect(page.getByText('Northpoint Building Society')).toHaveCount(0);
  await expect(page.getByText('Under the accepted terms of engagement')).toBeVisible();
});
