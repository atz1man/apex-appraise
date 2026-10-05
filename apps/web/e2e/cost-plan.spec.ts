import { expect, test, type Page } from '@playwright/test';

/**
 * Starting cost monitoring on a deal, the way a firm with no accounting
 * integration has to.
 *
 * The empty state promised that "budgets, contractor commitments and variance
 * alerts all flow from the appraisal" and its only control opened the appraisal,
 * which creates no packages. `cost.upsertPackage` is the browser's only writer
 * and its single call site is the contractor dropdown, which sends no figures;
 * outside the demo seed the only other writer is the Xero sync. So this screen
 * could not be started at all, and the one guided way out led nowhere.
 *
 * Driven in the browser rather than through the API because what was missing was
 * a CONTROL. The procedure could have existed for a week with nothing calling
 * it, which is the gap `route-reachable` and `e2e/reachable.spec.ts` exist for:
 * a capability nobody can press is a capability the firm does not have.
 *
 * A deal of the spec's own making, because the demo seed fills every seeded deal
 * in by stage and a test whose premise is "this deal has no cost plan" cannot
 * borrow one.
 */

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

async function post(page: Page, path: string, json: unknown): Promise<unknown> {
  return page.evaluate(
    async ([p, body]) => {
      const res = await fetch(`/trpc/${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
        body: JSON.stringify({ json: body }),
      });
      const j = await res.json();
      return j?.result?.data?.json ?? { error: j?.error?.json?.message ?? 'unknown' };
    },
    [path, json] as [string, unknown],
  );
}

const APPRAISAL = {
  units: [{ label: '2-bed apartments', count: 12, area: 755, cap: 415 }],
  efficiency: 83,
  trades: [
    { label: 'Substructure', rate: 37 },
    { label: 'Superstructure', rate: 113 },
    { label: 'Fit-out', rate: 61 },
  ],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

test('a firm with no cost plan can derive one from the appraisal, on the screen that promises it', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);

  const deal = (await post(page, 'deals.create', {
    name: `Cost Plan ${Date.now()}`,
    address: '2 Test Row, Bournemouth',
    postcode: 'BH1 1AA',
    assetType: 'RESIDENTIAL',
    stage: 'CONSTRUCTION',
  })) as { id?: string; error?: string };
  expect(deal.error, `could not create a deal: ${deal.error}`).toBeUndefined();
  const dealId = deal.id!;

  // ---- with no appraisal, the screen sends you to the appraisal, as before ----
  await page.goto(`/deal/${dealId}/costs`);
  await expect(page.getByText('No cost plan on this deal yet')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open the appraisal/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Create the cost plan/ }),
    'offered a derivation with no build cost to derive it from',
  ).toHaveCount(0);

  // ---- save one, and the same empty state offers the derivation ----
  const saved = (await post(page, 'appraisal.save', { dealId, input: APPRAISAL })) as {
    result?: { build: number };
    error?: string;
  };
  expect(saved.error, `could not save an appraisal: ${saved.error}`).toBeUndefined();
  const build = saved.result!.build;

  await page.goto(`/deal/${dealId}/costs`);
  await expect(page.getByText('No cost plan on this deal yet')).toBeVisible();
  const derive = page.getByRole('button', { name: /Create the cost plan from the appraisal/ });
  await expect(derive).toBeVisible();
  await derive.click();

  // ---- the plan is there, one package per trade, and the screen is live ----
  await expect(page.getByText('No cost plan on this deal yet')).toHaveCount(0);
  for (const trade of ['Substructure', 'Superstructure', 'Fit-out']) {
    await expect(page.getByText(trade, { exact: true }).first(), `${trade} is not in the plan`).toBeVisible();
  }

  /**
   * And the figure that matters: the budgets sum to the cost the scheme was
   * appraised at. The cost report measures the plan against the appraisal, so a
   * plan that did not add up would open reporting a variance nobody has earned.
   */
  const report = (await page.evaluate(async (id) => {
    const input = encodeURIComponent(JSON.stringify({ json: id }));
    const res = await fetch(`/trpc/cost.packages?input=${input}`, {
      headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
    });
    return (await res.json())?.result?.data?.json;
  }, dealId)) as { packages: Array<{ budget: number }>; rollup: { appraisedBuild: number; variance: number } };

  expect(report.packages).toHaveLength(3);
  const budgets = report.packages.reduce((a, p) => a + p.budget, 0);
  expect(report.rollup.appraisedBuild).toBeCloseTo(build, 2);
  // to the penny, which is as exact as pounds-over-the-wire can be
  expect(Math.abs(budgets - build)).toBeLessThan(0.01);
  expect(Math.abs(report.rollup.variance)).toBeLessThan(0.01);
});
