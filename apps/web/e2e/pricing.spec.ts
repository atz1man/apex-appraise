import { expect, test } from '@playwright/test';
import { FEATURE_COPY, PLANS, PLAN_FEATURES, planLabel, type Feature } from '@apex/types/plan';

/**
 * The public pricing page against the catalogue the server enforces.
 *
 * The landing page used to hold its own copy of the three columns, and it had
 * drifted: Enterprise was offered as "Data exports + API access" where the
 * product sells "Public API + webhooks", and the site pack was named differently
 * on each side. A prospect and a subscriber were reading different promises
 * about the same tier, and nothing anywhere could notice.
 *
 * There is one definition now, so drift is impossible by construction — which is
 * exactly why this test exists. Its job is not to compare a constant with
 * itself; it is to fail the moment somebody types a price or a feature line into
 * this page again, which is how the first copy got there.
 *
 * The chain it closes: what the public page SHOWS is PLANS; what PLANS sells is
 * pinned to PLAN_FEATURES by apps/api/test/plan-features.test.ts; and
 * PLAN_FEATURES is what the procedures refuse on.
 */

test('the pricing page shows the plans the server actually sells', async ({ page }) => {
  await page.goto('/');
  const pricing = page.locator('#pricing');
  await expect(pricing).toBeVisible();

  for (const plan of PLANS) {
    const card = pricing.locator(`[data-plan="${plan.key}"]`);
    await expect(card, `${plan.key} card`).toBeVisible();

    // the price, rendered from pence, in the page's own formatting
    await expect(card).toContainText(`£${(plan.pricePencePerMonth / 100).toLocaleString('en-GB')}`);
    await expect(card).toContainText('/month');

    for (const feature of plan.features) {
      await expect(card, `${plan.key} should list "${feature}"`).toContainText(feature);
    }
  }
});

test('every gated feature appears on the page in the words it is refused with', async ({ page }) => {
  await page.goto('/');
  const pricing = page.locator('#pricing');

  for (const [key, copy] of Object.entries(FEATURE_COPY) as Array<[Feature, string]>) {
    // the refusal message an admin sees says "<copy> is included from <Plan>",
    // and a customer who then looks at the pricing page has to find that phrase
    const cheapest = PLANS.find((p) => PLAN_FEATURES[p.key].includes(key));
    expect(cheapest, `${key} is enforced but on no plan`).toBeTruthy();
    await expect(pricing, `${copy} should appear on the ${planLabel(cheapest!.key)} column`).toContainText(copy);
  }
});

test('nothing is sold on the page that is not a plan we can bill for', async ({ page }) => {
  await page.goto('/');
  // a hand-written fourth column, or a renamed tier, is exactly the drift that
  // put "Data exports + API access" on this page and nowhere else
  // evaluateAll does not auto-wait, and the section reveals on scroll
  await expect(page.locator('#pricing [data-plan]').first()).toBeVisible();
  const shown = await page.locator('#pricing [data-plan]').evaluateAll((els) => els.map((e) => e.getAttribute('data-plan')));
  expect(shown).toEqual(PLANS.map((p) => p.key));
});
