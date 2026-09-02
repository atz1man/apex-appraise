import { expect, test } from '@playwright/test';

/**
 * The funding pack's Exceptions box paginates.
 *
 * It lived on page one only, and grew with the book: one line per covenant
 * breach, one per overspending scheme. Page one's row budget shrank to make
 * room, and once the lines alone filled the sheet page one carried no rows —
 * but the LINES still had to fit, and nothing checked that they did. Measured
 * with a forty-scheme book under a 20% loan-to-GDV limit: 43 breach lines,
 * page one 1,424px against an A4 sheet of 1,122. Three hundred pixels of the
 * exceptions a lender reads the pack for, printed off the bottom of the first
 * sheet, and the post-render reserve could not help because it reclaims rows
 * and there were none left.
 *
 * Forced the way the pagination spec forces its forty schemes: the response
 * is rewritten so every position breaches, which is what a book looks like
 * the quarter a lender tightens a limit. The demo book cannot be made to do
 * this without a policy every other spec would then see.
 */
test('forty breaches print on as many sheets as they need, every one of them', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  await page.route('**/trpc/deals.exposure*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const envelope = Array.isArray(body) ? body[0] : body;
    const data = envelope.result.data.json;
    const one = data.positions[0];
    data.positions = Array.from({ length: 40 }, (_, i) => ({
      ...one,
      dealId: `synthetic-${i}`,
      name: `Scheme ${i + 1}`,
      covenants: {
        untested: false,
        breaches: [{ key: 'ltgdv', label: 'Loan to GDV', actualPct: 61.2, direction: 'max', limitPct: 20 }],
      },
    }));
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/portfolio/pack');
  await page.waitForSelector('.a4-page');
  await page.waitForTimeout(800);

  const pack = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.a4-page')];
    return {
      pages: p.length,
      overflowing: p.filter((x) => x.getBoundingClientRect().height > 1123).map((x) => Math.round(x.getBoundingClientRect().height)),
      linesPerSheet: p.map((x) => (x.textContent ?? '').match(/against a maximum of 20%/g)?.length ?? 0),
      continued: p.map((x) => /Exceptions \(continued\)/.test(x.textContent ?? '')),
      rows: p.reduce((a, x) => a + x.querySelectorAll('.pack-row').length, 0),
      feet: p.map((x) => (x.textContent ?? '').match(/Page (\d+) of (\d+)/)?.[0]),
      totals: p.filter((x) => /schemes? · \d+ postcode/.test(x.textContent ?? '')).length,
    };
  });
  expect(pack.overflowing, 'a sheet of the pack overflowed A4 under its exceptions').toEqual([]);
  // every breach is printed exactly once, and not all on the first sheet
  expect(pack.linesPerSheet.reduce((a, n) => a + n, 0)).toBe(40);
  expect(pack.linesPerSheet[0]).toBeLessThan(40);
  expect(pack.linesPerSheet[0]).toBeGreaterThan(0);
  // the box goes on where it left off, headed as such, and never on page one
  expect(pack.continued[0]).toBe(false);
  expect(pack.continued.slice(1).some(Boolean)).toBe(true);
  expect(pack.continued.every((c, i) => c === (i > 0 && pack.linesPerSheet[i]! > 0))).toBe(true);
  // and the table, every scheme once, the totals once, the feet in order
  expect(pack.rows).toBe(40);
  expect(pack.totals).toBe(1);
  expect(pack.feet).toEqual(Array.from({ length: pack.pages }, (_, i) => `Page ${i + 1} of ${pack.pages}`));
});

/**
 * A pack that could not be built says so. `isLoading || !exposure` was true of
 * a failed read as well as a pending one, so a failed exposure read spun for
 * ever — in CI that read as "the pack never rendered", and a person printing
 * one was told nothing at all.
 */
test('a pack whose exposure read fails says so, and offers to try again', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  let fail = true;
  await page.route('**/trpc/deals.exposure*', async (route) => {
    if (!fail) return route.continue();
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { json: { message: 'exposure could not be computed', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } }),
    });
  });
  await page.goto('/portfolio/pack');
  await expect(page.getByText('The funding pack could not be built')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pack-error')).toContainText('exposure could not be computed');
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('Portfolio funding pack').first()).toBeVisible();
});
