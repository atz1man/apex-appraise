import { expect, test, type Page } from '@playwright/test';

/**
 * The AI Development Director's Manual entry form starts from the deal.
 *
 * It started from the demo scheme: `DEFAULT_MANUAL` was the prototype's state
 * copied verbatim, so on Parkstone Mews the form named "Northgate Trade &
 * Industrial Park, Holdenhurst Road, Bournemouth", full consent granted, six
 * trade-counter units, a B8 warehouse, mezzanine offices and an asking price
 * of £400,000 — and "Open full appraisal" would have saved that schedule and
 * that land price to Parkstone as a new version. The AI panel beside it says
 * its notes are a worked example; the manual form said nothing.
 *
 * Asserted on a deal that is NOT the demo scheme, so seeding from the record
 * and seeding from the prototype cannot look the same.
 */
const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

test('manual entry names this deal and no other, and cannot run on nothing', async ({ page }) => {
  await signIn(page);
  const deal = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    const d = j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Parkstone'));
    return { id: d.id as string, name: d.name as string, address: d.address as string };
  });
  await page.goto(`/deal/${deal.id}/auto`);
  await expect(page.getByText('AI Development Director').first()).toBeVisible({ timeout: 20_000 });
  await page.getByText('Manual entry', { exact: true }).click();

  await expect(page.getByLabel('Scheme')).toHaveValue(deal.name);
  await expect(page.getByLabel('Site address')).toHaveValue(new RegExp(`^${deal.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // nothing of the demo scheme anywhere in the form
  const values = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).join('\n'));
  expect(values).not.toMatch(/Northgate|Holdenhurst|Trade counter|B8 warehouse|Mezzanine|400000/);

  // and with no unit to sell there is nothing to appraise
  const run = page.getByRole('button', { name: 'Run appraisal' });
  await expect(run).toBeDisabled();
  await page.getByRole('button', { name: /Add unit/ }).click();
  await expect(run).toBeDisabled();
  await page.getByLabel('Unit 1 area sq ft').fill('750');
  await page.getByLabel('Unit 1 price per sq ft').fill('420');
  await expect(run).toBeEnabled();
});
