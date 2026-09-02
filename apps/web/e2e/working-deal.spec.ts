import { expect, test, type Page } from '@playwright/test';

/**
 * The home screen is on the deal the firm worked last.
 *
 * Three screens chose "the flagship" by the demo scheme's name and, where
 * there was none, by the highest probability — which is where every finished
 * scheme sits. Measured on the demo workspace with the name pin removed: the
 * home screen read "Everything on Parkstone Mews", closed in April, and put
 * Auto-Appraisal and the cost monitor on it. The rule now lives in
 * `src/lib/working-deal.ts` (its boundaries are unit-tested there) and the
 * timestamp it reads comes from `deals.list` (`apps/api/test/working-deal.test.ts`).
 * This drives the three screens: a deal just created is the deal, on all of
 * them; completing it takes it off the home screen however recently it was touched.
 */
/**
 * A workspace of this test's own. The first version ran on the demo firm and
 * passed once, then failed under two CI workers: a neighbouring spec touched
 * Elm Grove between two page loads and "the deal worked last" moved under the
 * test — which is the rule working, on a workspace every spec shares.
 */
const freshWorkspace = async (page: Page) => {
  const stamp = `${Date.now()}`.slice(-7);
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Start your organisation' })).toBeVisible();
  await page.getByLabel(/Organisation name/i).fill(`Working Co ${stamp}`);
  await page.getByLabel(/Your name/i).fill('Wren Working');
  await page.getByLabel(/^Email/i).fill(`working-${stamp}@test.co.uk`);
  await page.getByLabel(/^Password/i).fill('a-strong-working-password');
  await page.getByLabel(/Confirm password/i).fill('a-strong-working-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('Add your first deal')).toBeVisible({ timeout: 30_000 });
};

const call = (page: Page, path: string, json: unknown) =>
  page.evaluate(
    async ([p, body]) => {
      const r = await fetch(`/trpc/${p}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ json: body }),
      });
      const j = await r.json();
      return { ok: !j.error, data: j.result?.data?.json ?? null, err: j.error?.json?.message ?? null };
    },
    [path, json] as const,
  );

test('every tool opens on the deal worked last, on all three screens, and never on a finished scheme', async ({ page }) => {
  await freshWorkspace(page);
  const first = `First Scheme ${Date.now()}`;
  const second = `Second Scheme ${Date.now()}`;
  const a = await call(page, 'deals.create', { name: first, address: '1 Working Road, Poole', assetType: 'RESIDENTIAL', probability: 90 });
  expect(a.ok, a.err ?? '').toBe(true);
  const b = await call(page, 'deals.create', { name: second, address: '2 Working Road, Poole', assetType: 'RESIDENTIAL', probability: 30 });
  expect(b.ok, b.err ?? '').toBe(true);
  const aId = (a.data as { id: string }).id;
  const bId = (b.data as { id: string }).id;

  // the second is the one worked last, whatever its probability
  await page.goto('/');
  await expect(page.getByRole('heading', { name: `Everything on ${second}` })).toBeVisible();
  await expect(page.getByRole('link', { name: /Development appraisal/ })).toHaveAttribute('href', `/deal/${bId}/appraisal`);
  await expect(page.getByRole('link', { name: /Cost monitoring/ })).toHaveAttribute('href', `/deal/${bId}/costs`);

  await page.goto('/benchmarking');
  await expect(page.getByLabel('Deal to contribute')).toHaveValue(bId);

  await page.goto('/integrations');
  await expect(page.getByRole('button', { name: 'Sync target deal' })).toContainText(second);

  // completing it is the most recent thing to happen to it — and takes it off the home screen
  const done = await call(page, 'deals.setStage', { id: bId, stage: 'COMPLETED' });
  expect(done.ok, done.err ?? '').toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: `Everything on ${first}` })).toBeVisible();
  await expect(page.getByRole('link', { name: /Development appraisal/ })).toHaveAttribute('href', `/deal/${aId}/appraisal`);
});
