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
   * Two things this test has to get right, and the first attempt got both
   * wrong — it ran Hub → appraisal at 1280×720 and failed on its OWN premise
   * check: the Hub scrolls 79px at that size, so there was never an offset for
   * anything to reset.
   *
   * The origin and destination must both be genuinely long. The appraisal and
   * Settings are the two longest screens in the product, so this runs between
   * them.
   *
   * And the link clicked has to be STICKY. Playwright scrolls a target into
   * view before clicking it, so a link in the body of the page moves the very
   * offset being measured. The global nav is sticky and is why the viewport is
   * 1440 wide — below 1400 the header hides it, deliberately, so the deal
   * screens' own controls are not pushed off.
   */
  await page.setViewportSize({ width: 1440, height: 700 });
  await loginInternal(page);
  const id = await northgateId(page);
  await page.goto(`/deal/${id}/appraisal`);
  await expect(page.getByRole('navigation', { name: 'Global' })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 600));
  const left = await page.evaluate(() => window.scrollY);
  expect(left, 'the appraisal is too short at this viewport to leave a scroll offset behind').toBeGreaterThan(200);

  await page.getByRole('navigation', { name: 'Global' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveTitle('Settings · Apex Appraise');

  const arrival = await page.evaluate(() => ({ y: window.scrollY, height: document.body.scrollHeight }));
  // the destination must be taller than the offset brought to it, or a browser
  // clamping the scroll would pass this test without the code doing anything
  expect(arrival.height, 'the destination is too short for this to prove a reset').toBeGreaterThan(left + 700);
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
