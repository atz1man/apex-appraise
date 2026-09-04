import { expect, test, type Page } from '@playwright/test';

/**
 * A destructive control asks first, and takes no for an answer.
 *
 * `src/lib/destructive.test.ts` proves every remove/delete control in the
 * browser is GATED. That is a static claim about the source. Whether the gate
 * actually stops the write is a browser fact, and nothing was asserting it:
 * six `confirm()` call sites existed and not ONE spec in this suite registers a
 * dialog handler.
 *
 * Which is what makes this test work at all. Playwright DISMISSES a dialog by
 * default, so pressing a remove button here is a person clicking it and then
 * saying no. Nothing may come off the record.
 *
 * It asserts after a RELOAD rather than against the DOM. Asserting the row is
 * still on screen immediately after the click proves nothing: if the gate were
 * gone the removal is a round trip, and the assertion would pass before the
 * answer came back. The count read from a fresh page is a fact about the
 * record; the count read a millisecond after a click is a fact about latency.
 *
 * What it does NOT prove is that ACCEPTING removes the row. That is covered
 * where the removal happens — `apps/api/test/removal.test.ts` asserts the
 * supported £/ft² recalculates without a withdrawn comparable, the audit line
 * that records it, and the refusal across tenants. Proving it again here means
 * writing to the demo workspace a dozen other specs read, in parallel, which is
 * a worse trade than the coverage is worth.
 *
 * One control rather than six, and deliberately: the seed creates comparables
 * and no tasks, no webhook endpoints and no SSO configuration, so the other
 * gates have nothing to press. A test that fails for the environment rather
 * than for the code is worse than no test.
 */

async function loginInternal(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('declining the prompt leaves a comparable in the evidence', async ({ page }) => {
  await loginInternal(page);
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id as string;
  });

  const removes = page.getByRole('button', { name: /^Remove / });
  await page.goto(`/deal/${id}/comparables`);
  await expect(removes.first()).toBeVisible();
  const before = await removes.count();
  expect(before, 'the subject carries no comparable evidence, so nothing here is being tested').toBeGreaterThan(1);

  await removes.first().click();

  await page.reload();
  await expect(removes.first()).toBeVisible();
  await expect(removes, 'a comparable came off the evidence on a click nobody confirmed').toHaveCount(before);
});
