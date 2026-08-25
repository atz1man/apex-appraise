import { expect, test, type Page } from '@playwright/test';

/**
 * What a developer reads on the cost monitor.
 *
 * The "Appraised cost" card carried the subtitle "from current appraisal" and
 * showed the sum of the package budget fields — typed on the same screen. So
 * the report measured the packages against themselves. Measured on Harbour
 * Reach: seven packages forecasting £9,877,000 against an appraisal whose build
 * cost is £6,855,195, reported as **+£167,000 over**. The scheme is £3.02m over
 * the cost it was appraised at.
 *
 * Asserted as agreement with the appraisal, so a change to the fixture cannot
 * make this wrong.
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
        .then((j) => {
          if (!j.result?.data?.json) throw new Error(`${p} failed: ${j.error?.json?.message ?? 'no result'}`);
          return j.result.data.json;
        }),
    [path, input] as const,
  );

const dealNamed = (page: Page, prefix: string) =>
  page.evaluate(async (name) => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith(name)).id;
  }, prefix);

/** the figure printed under a stat card's label (labels render uppercase) */
const stat = async (page: Page, label: string) => {
  const card = page.getByText(label, { exact: true }).locator('xpath=..');
  const lines = (await card.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
  return lines[at + 1] ?? '';
};

test('the appraised cost on the cost monitor is the appraisal’s, not the packages’', async ({ page }) => {
  await signIn(page);
  const id = await dealNamed(page, 'Harbour');
  const [cost, appr] = await Promise.all([
    call(page, 'cost.packages', id) as Promise<{
      rollup: { appraisedBuild: number | null; packageBudgets: number; forecast: number; variance: number | null };
    }>,
    call(page, 'appraisal.getCurrent', id) as Promise<{ result: { build: number } }>,
  ]);

  // the baseline IS the appraisal's construction cost
  expect(cost.rollup.appraisedBuild).toBeCloseTo(appr.result.build, 6);
  // and it is not the packages' own budgets — the fixture makes those differ
  expect(cost.rollup.packageBudgets).not.toBeCloseTo(appr.result.build, 0);
  expect(cost.rollup.variance).toBeCloseTo(cost.rollup.forecast - appr.result.build, 6);

  await page.goto(`/deal/${id}/costs`);
  await expect(page.getByText('Cost report — packages & contractors')).toBeVisible();

  // what a person reads, in the same units the card is drawn in
  const fM = (n: number) => (n >= 1e6 ? `£${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}m` : `£${Math.round(n / 1e3)}k`);
  expect(await stat(page, 'Appraised cost')).toBe(fM(appr.result.build));
  expect(await stat(page, 'Package budgets')).toBe(fM(cost.rollup.packageBudgets));
  await expect(page.getByText('construction, current appraisal')).toBeVisible();
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

test('a cost plan with no appraisal behind it is not reported as on track', async ({ page }) => {
  /**
   * `costOver` was `(variance ?? 0) > 0`, so a null variance fell through to
   * false and the deal overview chipped the cost panel "On track" — a claim
   * made out of an absence. Reachable whenever packages are entered before the
   * scheme is appraised, which is an ordinary order to work in.
   *
   * On a deal of its own, because every seeded deal already has an appraisal.
   */
  await signIn(page);
  const created = await mutate(page, 'deals.create', {
    name: `Uncosted Baseline ${Date.now()}`,
    address: '2 Baseline Row, Poole',
    assetType: 'RESIDENTIAL',
    stage: 'CONSTRUCTION',
  });
  expect(created, `could not create a deal: ${created.err}`).toMatchObject({ ok: true });
  const id = (created.data as { id: string }).id;

  const pkg = await mutate(page, 'cost.upsertPackage', {
    dealId: id, name: 'Substructure', budget: 1_000_000, committed: 900_000, spent: 200_000, forecast: 1_050_000,
  });
  expect(pkg, `could not add a package: ${pkg.err}`).toMatchObject({ ok: true });

  const cost = (await call(page, 'cost.packages', id)) as {
    rollup: { variance: number | null; appraisedBuild: number | null };
    hasAppraisal: boolean;
  };
  expect(cost.hasAppraisal).toBe(false);
  expect(cost.rollup.variance, 'a variance was computed with no appraisal behind it').toBeNull();

  await page.goto(`/deal/${id}`);
  await expect(page.getByText('Construction cost health')).toBeVisible();
  // the chips render uppercase through their token class, so match on the page
  // text rather than on the string the component was written with
  const panel = ((await page.locator('body').innerText()).match(/Construction cost health[\s\S]{0,200}/) ?? [''])[0].toLowerCase();
  expect(panel, 'a deal with no appraisal was chipped "On track"').not.toContain('on track');
  expect(panel).toContain('no appraisal');
  expect(panel).toContain('no appraised cost');

  await page.goto(`/deal/${id}/costs`);
  await expect(page.getByText('Cost report — packages & contractors')).toBeVisible();
  expect(await stat(page, 'Variance to appraisal')).toBe('—');
  await expect(page.getByText('save an appraisal to measure against')).toBeVisible();
});
