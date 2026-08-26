import { expect, test, type Page } from '@playwright/test';

/**
 * The forms that hold a whole document, saved twice by one person.
 *
 * The API side of this lock has its own tests. This exists for the OTHER half,
 * which is where `a48b7b3` found the real bug: the sales drawer re-read its
 * stamp from the list rather than from the save's own response, so the same
 * person's second edit was refused as a conflict with themselves. Removing the
 * line that keeps the stamp did NOT fail the API tests — the browser is the only
 * place that failure shows.
 *
 * So this saves twice with no reload in between. If the stamp is threaded
 * wrongly the second save fails, and the form the whole Red Book narrative is
 * checked against becomes one that cannot be edited twice in a sitting.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

/**
 * Its own deal, found or created — never one of the demo schemes.
 *
 * Saving terms on a shared deal is not a value change, it is the creation of an
 * EngagementTerms ROW where there was none, and `engagement.get` serves the
 * saved row in preference to the draft it builds from the firm's house style.
 * Pointed at Harbour Reach, this spec silently broke
 * "the terms document paginates to fit whatever house style a firm writes",
 * which changes the house style and expects to see it — measured: that spec
 * passes on a fresh seed, fails once this one has run, and passes again after
 * a reseed.
 *
 * The name is fixed rather than stamped, so repeated runs reuse one deal
 * instead of growing the pipeline a deal at a time.
 */
const NAME = 'E2E — terms lock';

const ownDeal = (page: Page) =>
  page.evaluate(async (name) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}` };
    const list = await (await fetch('/trpc/deals.list', { headers: auth })).json();
    const found = list.result.data.json.deals.find((d: { name: string }) => d.name === name);
    if (found) return found.id as string;
    const made = await (
      await fetch('/trpc/deals.create', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ json: { name, address: '1 Lock Street, Bristol', assetType: 'RESIDENTIAL' } }),
      })
    ).json();
    return made.result.data.json.id as string;
  }, NAME);

test('terms of engagement: saved twice in a row without reloading', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  const id = await ownDeal(page);
  await page.goto(`/deal/${id}/engagement`);

  const purpose = page.getByLabel('Purpose of the valuation', { exact: true });
  await expect(purpose).toBeVisible();

  // a value unique to this run: the seed is shared with every other spec, and a
  // fixed one matches leftovers from a previous failure
  const stamp = `${Date.now()}`.slice(-6);
  const save = page.getByRole('button', { name: 'Save terms', exact: true });

  /**
   * Hold the post-save refetch until this test lets it go.
   *
   * A gate rather than a delay. A fixed three seconds reproduced the failure but
   * was itself timing-dependent — it raced the machine under two workers and
   * turned a real regression test into a flake. Holding the request until the
   * second save has happened is deterministic at any speed, and costs no
   * wall-clock at all.
   */
  let releaseRefetch: () => void = () => {};
  const refetchHeld = new Promise<void>((resolve) => {
    releaseRefetch = resolve;
  });
  await page.route('**/trpc/engagement.get*', async (route) => {
    await refetchHeld;
    await route.continue();
  });

  await purpose.fill(`Secured lending ${stamp}a`);
  await save.click();
  await expect(page.getByText('Terms saved')).toBeVisible();

  // no reload, no refetch waited on — exactly what a person editing does
  await purpose.fill(`Secured lending ${stamp}b`);
  await save.click();

  /**
   * Wait for a signal that can only follow a SUCCESSFUL save before asserting
   * the absence of a conflict — the button label flips to "Saved" when the
   * mutation resolves and the form goes clean.
   *
   * Asserting the absence straight after the click passed whatever happened: the
   * request had not come back yet, so the conflict message could not have been
   * on the page either way. An absence assertion that runs before the thing
   * could appear is not an assertion.
   */
  /**
   * Fifteen seconds, not the default five. This waits on a real round trip to a
   * server two Playwright workers are sharing, and the run that found the bug
   * this test now guards was itself a two-worker run on a loaded machine.
   *
   * It does not soften the assertion. The failure being guarded — a save
   * refused as a conflict — never produces this button at all, so a longer wait
   * changes only how long a genuine failure takes to report, not whether it
   * does. Verified: all three stamp mutations still fail with it.
   */
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/after you opened it|Reload to see/i)).toHaveCount(0);

  /**
   * Held-back refetch, and why it is the whole point of this test.
   *
   * The page keeps its stamp current two ways: from each save's own response,
   * and by following the query while the form is clean. With the refetch
   * delayed above, the save's response is the ONLY source — so all three ways
   * this can break are reachable here, and each was driven backwards:
   *
   *   not sending a stamp at all             → refused
   *   not taking it from the save's response → refused
   *   the clean-follow effect going backwards → refused
   *
   * That last one is a bug this file's own change shipped and CI caught. An
   * earlier version of this comment claimed the delay "broke the page for
   * unrelated reasons" and that the first path could not be proven here. That
   * was wrong on both counts: the delay was reproducing the third failure, and
   * I misread the reproduction as noise.
   */

  /**
   * Let the held refetch through. The handler stays registered on purpose:
   * once the gate is open it is a pass-through, and calling `unroute` here
   * instead handled the still-suspended request out from under
   * `route.continue()` — "Route is already handled!".
   */
  releaseRefetch();
  await page.reload();
  await expect(page.getByLabel('Purpose of the valuation', { exact: true })).toHaveValue(`Secured lending ${stamp}b`);
});

/**
 * The firm-level panel above it. Seventeen fields of standing wording — the
 * clauses every future instruction drafts from — read once into local state and
 * posted back in full.
 *
 * Restores what it found, because unlike the terms above this one is shared by
 * every deal in the workspace: "the terms document paginates to fit whatever
 * house style a firm writes" reads this exact policy, and a demo left holding
 * this test's wording is worse than the defect being covered.
 */
test('firm policy: saved twice in a row without reloading', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');

  const note = page.getByLabel('AI policy note', { exact: true });
  await expect(note).toBeVisible();
  const original = await note.inputValue();
  const save = page.getByRole('button', { name: 'Save policy', exact: true });
  const run = `${Date.now()}`.slice(-6);

  /**
   * Click, and read what the server actually said.
   *
   * Asserting through a reload instead was wrong twice over: the reload cancels
   * the in-flight save, and a refusal would show up as a stale value rather than
   * as the refusal it is. The response IS the thing this test is about — "the
   * second save was not refused as a conflict with itself" — so it asserts that
   * directly.
   */
  const saveAndRead = async () => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('org.savePolicy')),
      save.click(),
    ]);
    return (await res.json())[0] as { error?: { json?: { message?: string } } };
  };

  try {
    await note.fill(`Extraction only ${run}a`);
    expect((await saveAndRead()).error, 'the first save was refused').toBeUndefined();

    // no reload, no refetch waited on — exactly what a person editing does
    await note.fill(`Extraction only ${run}b`);
    const second = await saveAndRead();
    expect(
      second.error?.json?.message,
      'the second save was refused — the panel is holding a stamp it did not get from the first save',
    ).toBeUndefined();

    await page.reload();
    await expect(page.getByLabel('AI policy note', { exact: true })).toHaveValue(`Extraction only ${run}b`);
  } finally {
    await page.reload();
    const restore = page.getByLabel('AI policy note', { exact: true });
    await expect(restore).toBeVisible();
    await restore.fill(original);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('org.savePolicy')),
      page.getByRole('button', { name: 'Save policy', exact: true }).click(),
    ]);
  }
});
