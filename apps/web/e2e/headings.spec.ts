import { expect, test, type Page } from '@playwright/test';
import { firstSkippedHeading } from '../src/lib/outline';

/**
 * Every screen renders exactly one `h1` — measured in the browser, not read
 * from the source.
 *
 * `lib/screen-heading.test.ts` proves each route's file CAN render one. This
 * proves each route DOES, because a static presence check cannot see render
 * branches: `FundingPack.tsx` contained `<h1` for months and a populated pack
 * rendered none — the tag lived in its empty state. Walked signed in, on a
 * deal that HAS a saved appraisal, so the printed documents render their real
 * sheets rather than their refusals.
 *
 * Exactly one, not at least one: a second `h1` splits the outline in two and
 * a reader's "next heading" cannot tell which is the page.
 *
 * And below the root, no level is skipped IN DOCUMENT ORDER: each heading is
 * at most one level deeper than the one before it. Measured before this half
 * existed, with the frame's `h1` in place: eight screens rendered h1 → h3
 * with no h2 between — Settings fourteen times over, the appraisal on every
 * tab, costs, sales, engagement, the site pack, the workbench and investors.
 * Every one of those `h3`s came from `Panel`, so `lib/headings.test.ts`
 * could not see it: that sweep counts the literal `<hN` tags in a route
 * FILE, and the tag lives in `components/ui.tsx`. Panels now take a
 * `level`, and this is the proof that each caller chose the right one —
 * the predicate is `lib/outline.ts`, so its boundaries are unit-tested and
 * this spec only feeds it what the browser rendered.
 *
 * Soft on purpose: one run names every screen that skips, rather than the
 * first.
 */

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('every screen has one h1, on a deal with a saved appraisal', async ({ page }) => {
  // ~25 navigations. Per-action timeouts in playwright.config.ts name the one
  // that hangs; this is the budget for the sum.
  test.setTimeout(120_000);
  await signIn(page);

  await page.goto('/board');
  await page.waitForLoadState('networkidle');
  const deals = await page.locator('a[href^="/deal/"]').evaluateAll((as) =>
    as.map((a) => [a.getAttribute('href') ?? '', (a.textContent ?? '').trim()] as const),
  );
  // the seeded golden fixture carries an appraisal, a Red Book and terms
  const deal = (deals.find(([, name]) => /Northgate/i.test(name)) ?? deals[deals.length - 1])?.[0];
  expect(deal, 'the pipeline lists at least one deal').toBeTruthy();

  await page.goto(deal!);
  await page.waitForLoadState('networkidle');
  const tabs = [...new Set(await page.locator(`a[href^="${deal}/"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')))];

  const routes = [
    '/',
    '/board',
    deal!,
    ...tabs,
    `${deal}/engagement/document`,
    '/portfolio/pack',
    '/calendar',
    '/benchmarking',
    '/integrations',
    '/settings',
    '/investors',
    '/whats-new',
    '/docs/api',
    '/privacy',
    '/terms',
  ];

  for (const route of routes) {
    await test.step(route.replace(deal!, '/deal/…'), async () => {
      await page.goto(route);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      const h1 = page.locator('h1');
      await expect(h1, `${route} renders no h1 — its outline has no root`).toHaveCount(1);
      await expect(h1).not.toBeEmpty();

      const headings = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll((els) =>
        els.map((el) => ({ level: Number(el.tagName[1]), text: (el.textContent ?? '').trim().slice(0, 40) })),
      );
      const skip = firstSkippedHeading(headings.map((h) => h.level));
      expect
        .soft(
          skip,
          `${route} skips a heading level: h${skip?.from} "${headings[(skip?.index ?? 1) - 1]?.text}" is followed by h${skip?.to} "${headings[skip?.index ?? 0]?.text}" — outline ${headings.map((h) => `h${h.level}`).join(' ')}`,
        )
        .toBeNull();
    });
  }
});
