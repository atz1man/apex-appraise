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
const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
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
  await signIn(page);
  const name = `Working Deal ${Date.now()}`;
  const created = await call(page, 'deals.create', { name, address: '9 Working Road, Poole', assetType: 'RESIDENTIAL' });
  expect(created.ok, created.err ?? '').toBe(true);
  const id = (created.data as { id: string }).id;
  expect(id).toBeTruthy();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: `Everything on ${name}` })).toBeVisible();
  await expect(page.getByRole('link', { name: /Development appraisal/ })).toHaveAttribute('href', `/deal/${id}/appraisal`);
  await expect(page.getByRole('link', { name: /Cost monitoring/ })).toHaveAttribute('href', `/deal/${id}/costs`);

  await page.goto('/benchmarking');
  await expect(page.getByLabel('Deal to contribute')).toHaveValue(id);

  await page.goto('/integrations');
  await expect(page.getByRole('button', { name: 'Sync target deal' })).toContainText(name);

  // completing it is the most recent thing to happen to it — and takes it off the home screen
  const done = await call(page, 'deals.setStage', { id, stage: 'COMPLETED' });
  expect(done.ok, done.err ?? '').toBe(true);
  await page.goto('/');
  await expect(page.getByText('Deal tools')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Everything on / })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Everything on ${name}` })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Development appraisal/ })).not.toHaveAttribute('href', `/deal/${id}/appraisal`);
});
