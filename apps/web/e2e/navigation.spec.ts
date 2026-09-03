import { expect, test, type Page } from '@playwright/test';

/**
 * What a browser does on a real navigation, and what this app did not.
 *
 * Changing the URL without reloading is the whole point of a single-page app;
 * putting back what the browser stops doing is the part nobody writes down.
 * Measured over the route table before this: 37 routes, ONE `<title>`, no
 * scroll reset anywhere in the source, and focus left on the link that had
 * just been replaced.
 *
 * These are browser facts and cannot be asserted in a unit test — the table of
 * titles is checked in `src/lib/page-title.test.ts`; that it reaches the tab,
 * and what else happens on the way, is checked here.
 */

async function loginInternal(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

async function northgateId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id as string;
  });
}

test('every screen names itself in the tab, the history menu and the bookmark', async ({ page }) => {
  await loginInternal(page);
  await expect(page).toHaveTitle('Home · Apex Appraise');

  await page.getByRole('link', { name: /Pipeline board/ }).first().click();
  await expect(page).toHaveTitle('Pipeline board · Apex Appraise');

  await page.goto('/settings');
  await expect(page).toHaveTitle('Settings · Apex Appraise');

  // and back is back — the history entry carries its own name, which is the
  // thing 37 identical titles took away
  await page.goBack();
  await expect(page).toHaveTitle('Pipeline board · Apex Appraise');
});

test('a client-facing tab does not advertise the software', async ({ page }) => {
  // the portal shows the FIRM's mark and name rather than ours; the tab is the
  // one place that rule had not reached
  await page.goto('/login');
  await page.getByLabel('Email').fill('buyer@demo.co.uk');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/portal\/buyer$/);
  await expect(page).toHaveTitle('Your home');
  expect(await page.title()).not.toContain('Apex');
});

test('arriving at a page puts you at the top of it', async ({ page }) => {
  /**
   * The hardest of these to state honestly, and it took three rounds to work
   * out why — each one failing on its own premise check rather than on the
   * assertion, which is the guard doing its job.
   *
   *   round 1  Hub → appraisal at 1280×720. The Hub scrolls 79px at that size,
   *            so there was no offset for anything to reset.
   *   round 2  appraisal → Settings, scrolled as soon as the top bar appeared.
   *            scrollY came back 4: the page was still a skeleton. The header
   *            renders long before any row does.
   *   round 3  the origin scrolled, and the DESTINATION measured 700 — exactly
   *            the viewport. Settings was a skeleton on arrival, so the browser
   *            clamped the scroll to zero on its own and the test could not
   *            tell the code from the clamp.
   *
   * Round 3 is the interesting one, because it is a fact about the product and
   * not just about the test: every route is `lazy()`, so a FIRST visit lands on
   * something viewport-high and the browser resets the scroll whether we do or
   * not. The case that needs the code is the second visit — chunk loaded, data
   * in the query cache, the destination tall from its first render, nothing for
   * the browser to clamp. Which is also the case a person is actually in when
   * they move between screens they have been using all afternoon.
   *
   * So Settings is warmed first, and the click that matters is the return.
   */
  await page.setViewportSize({ width: 1440, height: 700 });
  await loginInternal(page);
  const id = await northgateId(page);

  await page.goto(`/deal/${id}/appraisal`);
  await expect(page.getByRole('navigation', { name: 'Global' })).toBeVisible();
  // the content, not the chrome — see round 2
  await expect
    .poll(() => page.evaluate(() => document.body.scrollHeight), { timeout: 15_000 })
    .toBeGreaterThan(1400);

  /**
   * Warm the destination IN THE APP, and that qualifier is round four.
   *
   * The first attempt warmed Settings with `page.goto('/settings')` before
   * navigating on. A `goto` is a full page load: it throws away the module
   * cache and the query cache, so by the time Settings was clicked nothing was
   * warm and it rendered at exactly 700 again — the same viewport-high skeleton,
   * reached by a longer route.
   *
   * Going there and coming back with `goBack` keeps both caches, because both
   * hops are client-side. After this, Settings' chunk is loaded and its data is
   * in the query cache, so the click that matters renders it tall on the first
   * frame with nothing for the browser to clamp.
   */
  await page.getByRole('navigation', { name: 'Global' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveTitle('Settings · Apex Appraise');
  await page.goBack();
  await expect(page).toHaveTitle('Development appraisal · Apex Appraise');
  await expect
    .poll(() => page.evaluate(() => document.body.scrollHeight), { timeout: 15_000 })
    .toBeGreaterThan(1400);

  await page.evaluate(() => window.scrollTo(0, 600));
  const left = await page.evaluate(() => window.scrollY);
  expect(left, 'the appraisal is too short at this viewport to leave a scroll offset behind').toBeGreaterThan(200);

  // a STICKY link: Playwright scrolls a target into view before clicking it, so
  // a link in the body of the page moves the very offset being measured. The
  // global nav is why the viewport is 1440 — below 1400 the header hides it.
  await page.getByRole('navigation', { name: 'Global' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveTitle('Settings · Apex Appraise');

  const arrival = await page.evaluate(() => ({ y: window.scrollY, height: document.body.scrollHeight }));
  expect(
    arrival.height,
    'the destination was still short on arrival, so a browser clamping the scroll would pass this without the code doing anything',
  ).toBeGreaterThan(left + 700);
  expect(arrival.y, 'Settings opened part-way down, at the offset left behind by the appraisal').toBe(0);
});

test('and puts keyboard focus there too', async ({ page }) => {
  await loginInternal(page);
  await page.getByRole('link', { name: /Comparables/ }).first().click();
  await expect(page).toHaveTitle('Comparables · Apex Appraise');
  // focus follows the person to the new screen; without this the next Tab
  // resumes from a link that no longer exists and a screen reader says nothing
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('page');
});

test('a keyboard user can skip the header instead of tabbing through it', async ({ page }) => {
  await loginInternal(page);
  /**
   * Reloaded on purpose. After an in-app navigation focus is already ON the
   * page wrapper — which is what the test above asserts — and the wrapper sits
   * AFTER the skip link in the document, so Tab from there goes forward into
   * the content rather than back to a link that has already done its job. The
   * skip link is for somebody arriving at a fresh document, which is what a
   * reload produces: focus on `<body>`, nothing yet skipped.
   */
  await page.reload();
  await expect(page.getByText('Deal tools')).toBeVisible();

  // WCAG 2.4.1. The first Tab from the top of the document reaches it, and it
  // is invisible until then
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('page');
});
