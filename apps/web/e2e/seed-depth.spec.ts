import { expect, test, type Page } from '@playwright/test';

/**
 * The demo is end-to-end on every seeded deal — measured in the browser.
 *
 * `apps/api/test/seed-depth.test.ts` proves the ROWS exist for each deal's
 * stage. This proves the screens show them, because a row the screen does not
 * read renders as the same "No … yet" as no row at all — and that is exactly
 * how this walk found the demo in the first place: signed in, every deal,
 * every tab, counting empty states. 197 before the seed was filled in; the
 * ones left are stage-appropriate (no cost plan on a scheme still being
 * appraised), the extraction screen's idle state, or a live open-data panel.
 *
 * Only the eleven SEEDED deals are walked, by name: specs create shells of
 * their own ("Policy Draft …", "Unvalued …") and those are meant to be empty.
 */

const SEEDED: Array<[name: string, stage: string]> = [
  ['Northgate Trade & Industrial Park', 'CONSTRUCTION'],
  ['Harbour Reach', 'CONSTRUCTION'],
  ['Elm Grove Apartments', 'ACQUISITION'],
  ['Morgan Furniture Factory', 'OFFER'],
  ['Stour Valley Logistics', 'OFFER'],
  ['Clovelly Road', 'APPRAISAL'],
  ['Westover Yard', 'APPRAISAL'],
  ['Old Brewery Quarter', 'SALES_LETTING'],
  ['Parkstone Mews', 'COMPLETED'],
];

const RANK: Record<string, number> = { SOURCING: 0, APPRAISAL: 1, OFFER: 2, ACQUISITION: 3, CONSTRUCTION: 4, SALES_LETTING: 5, COMPLETED: 6 };

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('every seeded deal past sourcing shows its evidence, and every built one its plan', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const deals = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json.deals as Array<{ id: string; name: string }>;
  });
  const empties: string[] = [];
  for (const [name, stage] of SEEDED) {
    const deal = deals.find((d) => d.name === name);
    expect(deal, `the demo seeds "${name}"`).toBeTruthy();
    const tabs = ['comparables', 'scenarios', 'dataroom', ...(RANK[stage]! >= RANK.CONSTRUCTION! ? ['costs', 'sales'] : [])];
    for (const tab of tabs) {
      await test.step(`${name} / ${tab}`, async () => {
        await page.goto(`/deal/${deal!.id}/${tab}`);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        // a cost plan or a unit list that is absent is the headline empty state
        // on those two screens; a secondary panel ("No photos logged yet") is not
        // what a shell looks like, so the first empty state on the page is the one asked about
        const first = page.locator('[data-testid="empty-state"]').first();
        const text = (await first.count()) ? ((await first.innerText()).replace(/\s+/g, ' ').slice(0, 80)) : null;
        const shell = text != null && /^(No (comparable|option|units|cost plan)|This folder is empty)/i.test(text);
        if (shell) empties.push(`${name} (${stage}) / ${tab}: "${text}"`);
      });
    }
  }
  expect(empties, `a seeded deal rendering as a shell:\n  ${empties.join('\n  ')}`).toEqual([]);
});
