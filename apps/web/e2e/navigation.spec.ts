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
  await loginInternal(page);

  // to the foot of the Hub, past the tool grid
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const left = await page.evaluate(() => window.scrollY);
  expect(left, 'the Hub is too short at this viewport to leave a scroll offset behind').toBeGreaterThan(200);

  await page.getByRole('link', { name: /Development appraisal/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  const arrival = await page.evaluate(() => ({ y: window.scrollY, height: document.body.scrollHeight }));
  // the destination must be taller than the offset we brought, or a browser
  // clamping the scroll would pass this test without the code doing anything
  expect(arrival.height, 'the destination is too short for this to prove a reset').toBeGreaterThan(left + 600);
  expect(arrival.y, 'the appraisal opened part-way down, at the offset left behind by the Hub').toBe(0);
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

  // WCAG 2.4.1. The first Tab from the top of the document reaches it, and it
  // is invisible until then
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('page');
});
