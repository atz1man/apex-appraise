import { expect, test, type Page } from '@playwright/test';

/**
 * A deal's stage can be corrected, from the screen a valuer advances it on.
 *
 * `deals.setStage` has always accepted any stage. Both controls in the product
 * computed `stageIdx + 1` and clamped at the last, so in practice a stage only
 * ever went forward — a mis-click was permanent, `figureStatus` hardened with
 * it, and arriving at COMPLETED contributed the scheme's certified build £/ft²
 * to a pool other firms read as market evidence. Nothing on the server needed
 * changing; there was no way to ask.
 *
 * Driven in the browser because that is where the whole defect lived. The API
 * test beside it (`stage-correction.test.ts`) covers the withdrawal of the
 * out-turn contribution, which is the part that reaches other firms; this
 * covers the part a person touches.
 */

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('a mis-advanced stage can be put back, on the overview that advanced it', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);

  const dealId = (await page.evaluate(async () => {
    const res = await fetch('/trpc/deals.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      body: JSON.stringify({
        json: {
          name: `Stage Correction ${Date.now()}`,
          address: '3 Test Row, Bournemouth',
          postcode: 'BH1 1AA',
          assetType: 'RESIDENTIAL',
          stage: 'APPRAISAL',
        },
      }),
    });
    return (await res.json())?.result?.data?.json?.id as string;
  })) as string;
  expect(dealId, 'could not create a deal').toBeTruthy();

  const stageNow = () =>
    page.evaluate(async (id) => {
      const input = encodeURIComponent(JSON.stringify({ json: id }));
      const res = await fetch(`/trpc/deals.get?input=${input}`, {
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      });
      return (await res.json())?.result?.data?.json?.stage as string;
    }, dealId);

  await page.goto(`/deal/${dealId}`);
  const advance = page.getByRole('button', { name: /Advance stage/ });
  const back = page.getByRole('button', { name: /Back a stage/ });

  await expect(advance).toBeVisible();
  await expect(back, 'no way back from the stage a deal is on').toBeVisible();

  // forward, as before
  await advance.click();
  await expect.poll(stageNow).toBe('OFFER');

  // and back again — the whole of what was missing
  await back.click();
  await expect.poll(stageNow).toBe('APPRAISAL');

  /**
   * At the FIRST stage there is nothing to go back to, so the control is not
   * offered. A disabled button that can never enable is furniture.
   */
  await back.click();
  await expect.poll(stageNow).toBe('SOURCING');
  await expect(page.getByRole('button', { name: /Back a stage/ })).toHaveCount(0);
  await expect(advance, 'a deal at the first stage can still move forward').toBeVisible();
});
