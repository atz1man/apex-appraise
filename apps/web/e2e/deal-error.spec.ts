import { expect, test } from '@playwright/test';

/**
 * The deal screen says what it knows when it cannot load, and no more.
 *
 * It used to print "it may have been removed or you may not have access" for
 * EVERY failure — the same sentence for a bad id and for an API that never
 * answered. On 4 September that cost an hour pointing at "removed" and
 * "access" while the real question was whether the API machine was up. Both
 * real-world paths are driven here; the classifier's boundaries are in
 * `lib/load-failure.test.ts`.
 */

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('a deal that is not in the workspace is reported as not found — with no retry, because retrying cannot help', async ({ page }) => {
  await signIn(page);
  await page.goto('/deal/no-such-deal-anywhere');

  const error = page.getByTestId('deal-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('data-kind', 'missing');
  await expect(page.getByText('This deal could not be found')).toBeVisible();
  // it does not claim to know WHY — removed, mistyped and another firm's all
  // answer NOT_FOUND, on purpose, and the screen must not pick one
  await expect(error).not.toContainText('access');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to pipeline' })).toBeVisible();
});

test('an API that does not answer is reported as exactly that — and Try again recovers the deal once it does', async ({ page }) => {
  await signIn(page);
  await page.goto('/board');
  const href = await page.locator('a[href^="/deal/"]').first().getAttribute('href');
  expect(href, 'the pipeline lists at least one deal').toBeTruthy();

  /**
   * Refuse the connection for any batch carrying `deals.get`, which is what a
   * stopped API machine looks like from the browser. The client builds a
   * TRPCClientError with a `cause` and NO `data` for this, and that absence is
   * the thing the screen used to misread as "removed".
   */
  const refuse = (route: import('@playwright/test').Route) =>
    route.request().url().includes('deals.get') ? route.abort('connectionrefused') : route.continue();
  await page.route('**/trpc/**', refuse);
  await page.goto(href!);

  const error = page.getByTestId('deal-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('data-kind', 'unreachable');
  await expect(page.getByText('The server did not respond')).toBeVisible();
  await expect(error).not.toContainText('removed');
  await expect(error).not.toContainText('access');

  // the one failure a second attempt most often fixes offers one, and it works
  await page.unroute('**/trpc/**', refuse);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(error).toHaveCount(0);
  await expect(page.locator('h1').first()).toBeVisible();
});
