import { expect, test } from '@playwright/test';

/**
 * A surveyor with no signal.
 *
 * The service worker precaches the shell and the typefaces precisely so the
 * field app opens on a site with no reception, and it deliberately never caches
 * /trpc — money data must always be live. What nothing covered is what happens
 * when somebody out there presses Save.
 *
 * react-query PAUSES a mutation while the browser reports offline rather than
 * failing it, and replays it on reconnect. That is the right behaviour. But a
 * paused mutation raises no error, so the global handler that exists so there
 * are "no more silent failures" never ran and nothing appeared at all: the
 * surveyor tapped Save, saw nothing change, and tapped again — queueing another
 * write that would also replay.
 *
 * The second test is the one that matters. A bar claiming work is held is worth
 * nothing unless the work is actually held, so it asserts the claim rather than
 * the bar.
 */

const signIn = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

const banner = (page: import('@playwright/test').Page) => page.getByText(/No signal — your work is held/);

/**
 * The Members panel's own heading, not the word "Members" anywhere on the page.
 *
 * `getByText('Members')` also matches the plan comparison — "✓ 2 team members",
 * "✓ 10 team members", "✓ Unlimited members" — which Settings renders while the
 * workspace is still on TRIAL. So these two tests passed only when an earlier
 * spec had already changed the plan, and failed on a fresh seed in isolation:
 * measured identically before and after the change that surfaced it.
 */
const membersPanel = (page: import('@playwright/test').Page) =>
  page.getByRole('heading', { name: 'Members', exact: true });

test('says so, instead of appearing to do nothing', async ({ page, context }) => {
  await signIn(page);
  await page.goto('/settings');
  await expect(membersPanel(page)).toBeVisible();
  await expect(banner(page)).toHaveCount(0);

  await context.setOffline(true);
  await expect(banner(page)).toBeVisible();

  /**
   * And does not cover the thing it appears above. The first version was fixed
   * at the top with a high z-index and sat on the TopBar — sticky at top-0, 56px
   * tall — hiding the brand lockup and the breadcrumb. Taking the navigation
   * away exactly when somebody is offline and wants a screen that still works is
   * a bad trade for a notice.
   */
  const covered = await page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return 'no header';
    const r = header.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + 40), Math.round(r.top + r.height / 2));
    return hit?.closest('header') ? 'header' : (hit?.getAttribute('role') ?? hit?.tagName ?? '?');
  });
  expect(covered, 'the offline bar is sitting on top of the navigation').toBe('header');

  await context.setOffline(false);
  // and goes when the signal does, without a reload
  await expect(banner(page)).toHaveCount(0);
});

test('holds the work and sends it when the signal returns', async ({ page, context }) => {
  await signIn(page);
  await page.goto('/settings');
  await expect(membersPanel(page)).toBeVisible();

  // a name unique to this run: the members table is shared with every other
  // spec, and a fixed one matches leftovers from a previous failure
  const stamp = `${Date.now()}`.slice(-6);
  const person = `Offline ${stamp}`;
  const email = `offline-${stamp}@apexappraise.co.uk`;
  await page.getByRole('button', { name: /Invite teammate/i }).click();

  await context.setOffline(true);
  await expect(banner(page)).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(person);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();

  // nothing has reached the server, and nothing pretends it has
  await page.waitForTimeout(800);
  await expect(page.getByText(/won.t be shown again/i)).toHaveCount(0);

  await context.setOffline(false);
  // the queued write replays on its own — no second tap, no reload
  await expect(page.getByText(/won.t be shown again/i)).toBeVisible({ timeout: 15_000 });

  // and it is one invitation, not one per tap
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const rows = page.getByRole('row', { name: new RegExp(person) });
  await expect(rows).toHaveCount(1);

  // leave the workspace as it was found — other specs count seats
  await rows.getByRole('button', { name: 'Remove…' }).click();
  await rows.getByRole('button', { name: /^Remove/ }).last().click();
  await expect(page.getByRole('row', { name: new RegExp(person) })).toHaveCount(0);
});
