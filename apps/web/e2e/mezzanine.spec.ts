import { expect, test } from '@playwright/test';

/**
 * The Capital stack panel, which could not save.
 *
 * Its three terms were component state, so changing the mezzanine rate did not
 * mark the appraisal dirty. Measured: after changing it from 12 to 18 the Save
 * button still read "Saved" and was still disabled — the appraisal never
 * registered the change, and a reload restored the default.
 */

test('a mezzanine rate marks the appraisal dirty, saves, and comes back', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });

  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const rate = page.getByLabel('Mezzanine rate');
  await expect(rate).toBeVisible();

  const save = page.getByRole('button', { name: /^Save appraisal$|^Saved$/ }).last();
  await expect(save, 'the fixture should open on a saved appraisal').toHaveText('Saved');

  /**
   * Alternated rather than fixed, so a second run of this spec is a real test.
   * A fixed value re-typed over itself is no change, the button stays "Saved",
   * and the assertion below fails for a reason that has nothing to do with the
   * code — the same trap four other specs on this branch fell into.
   */
  const before = await rate.inputValue();
  const next = before === '17.5' ? '16.5' : '17.5';
  await rate.fill(next);
  await expect(save, 'changing the mezzanine rate did not mark the appraisal dirty').toHaveText('Save appraisal');
  await save.click();
  await expect(save).toHaveText('Saved');

  await page.reload();
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await expect(page.getByLabel('Mezzanine rate')).toHaveValue(next);
});

test('the stack says the appraisal’s figures are senior-only', async ({ page }) => {
  /**
   * The mezzanine and its interest are drawn beside engine figures. The
   * engine's finance cost, profit and residual land value are senior debt
   * only — treating mezzanine cost as an appraisal input is a modelling
   * decision nobody has made, and a reader would otherwise assume it had been.
   */
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Finance', exact: true }).click();

  // give it a tranche so the stack has a mezzanine to caveat — not saved, so
  // this leaves nothing behind for the next run
  await page.getByLabel('Mezzanine to').fill('80');
  await expect(page.getByText('Capital stack')).toBeVisible();
  await expect(page.getByText(/senior debt only/)).toBeVisible();
});
