import { expect, test, type Page } from '@playwright/test';
import { firstSkippedHeading } from '../src/lib/outline';

/**
 * The break-glass codes, on the two screens a person meets them on.
 *
 * `apps/api/test/sso-recovery.test.ts` holds the claim — that a workspace whose
 * identity provider has stopped letting anyone in can be recovered — and proves
 * it against the procedures, with eight recorded mutants. This is the half that
 * counts what is RENDERED, because the thing that makes a recovery code work is
 * that somebody has it written down, and that happens (or does not) on screen.
 *
 * Its own ORGANISATION, registered through the product's own public
 * `org.register`, and the reason is not tidiness. Every other spec in this suite
 * signs in to the one seeded demo workspace with a password, and
 * `SsoConnection.enforced` refuses every password in the workspace it is set on —
 * so a spec that enforced SSO on the demo org would fail every concurrent spec
 * at sign-in, including its own `afterEach`. Two workers share that workspace.
 * `CLAUDE.md` records the same hazard for `OrgPolicy`; this one is sharper,
 * because the state it leaks locks the door behind it.
 *
 * NOT DRIVABLE HERE, and said rather than left looking thorough: signing in with
 * a code. `org.saveSso` will not enforce a connection until `lastLoginAt` is
 * stamped, and only the SSO callback stamps it — so reaching the enforced state
 * needs a real handshake with a real identity provider, or a direct row write,
 * and a browser can do neither. Same shape as `webhook-resume`'s note about
 * twenty failures. The API test is where that claim lives; what is proven here is
 * everything up to the door, plus the one thing about the door that IS reachable:
 * that a workspace which does not enforce single sign-on offers no code field at
 * all.
 */

const CODE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

/**
 * A firm of this spec's own making, signed in.
 *
 * The page is taken to the app BEFORE anything is fetched: `page.evaluate` on a
 * fresh context runs against `about:blank`, where a cross-origin absolute URL
 * is refused outright — "Failed to fetch", which reads as the server being
 * down. Relative, from the app's own origin, as the other specs do.
 */
async function freshFirm(page: Page) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // at the domain this firm will CLAIM, or `auth.ssoAvailable` finds nothing
  const email = `admin@rec-${tag}.example`;
  const password = 'break-glass-9876';

  await page.goto('/login');
  const registered = await page.evaluate(
    async ([mail, pw, t]) => {
      const res = await fetch('/trpc/org.register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          json: { orgName: `Recovery Firm ${t}`, name: 'Recovery Admin', email: mail, password: pw },
        }),
      });
      return res.ok;
    },
    [email, password, tag],
  );
  expect(registered, 'could not register an organisation').toBe(true);

  // sign in through the product, so the session is stored the way the app stores it
  await page.reload();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  return { email, password, tag };
}

/** Save an SSO connection the way the panel does, leaving it UNENFORCED. */
async function configureSso(page: Page, tag: string) {
  const ok = await page.evaluate(async (t) => {
    const res = await fetch('/trpc/org.saveSso', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      body: JSON.stringify({
        json: {
          issuer: 'https://login.microsoftonline.com/recovery-e2e/v2.0',
          clientId: 'client-e2e',
          clientSecret: 'secret-e2e',
          domains: [`rec-${t}.example`],
          defaultRole: 'ANALYST',
          enforced: false,
        },
      }),
    });
    return res.ok;
  }, tag);
  expect(ok, 'could not save an SSO connection').toBe(true);
}

test('recovery codes are shown once, and never again', async ({ page }) => {
  test.setTimeout(120_000);
  const { tag } = await freshFirm(page);
  await configureSso(page, tag);

  await page.goto('/settings');
  const panel = page.getByRole('heading', { name: 'Recovery codes' });
  await expect(panel).toBeVisible();

  /**
   * Nothing is offered as a reassurance before it is true: with the connection
   * optional, passwords still work and there is nothing to recover from —
   * `auth.recoveryLogin` refuses such a workspace outright.
   */
  await expect(page.getByText(/Codes are generated when you require single sign-on/)).toBeVisible();

  /**
   * Generating ASKS FIRST. What it destroys is a printed credential, which is
   * why `destructive` now reads `regenerate` as a destroying verb — so the
   * control must arm before it fires, and the spec presses both halves.
   */
  await page.getByRole('button', { name: /Generate codes/ }).click();
  await page.getByRole('button', { name: 'Generate new codes', exact: true }).click();

  const shown = page.getByText(/recovery codes — copy these now/i);
  await expect(shown, 'generating produced no codes on screen').toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/cannot be shown again/i)).toBeVisible();

  // ten of them, each in the printable grouped form
  const codes = await page.locator('li.fig').allInnerTexts();
  const real = codes.map((c) => c.trim()).filter((c) => CODE.test(c));
  expect(real, `expected ten grouped codes, saw ${JSON.stringify(codes)}`).toHaveLength(10);
  expect(new Set(real).size, 'a duplicate code was printed').toBe(10);

  /**
   * THE CLAIM about secrecy. Only digests are stored and nothing can recover a
   * code from one, so a reload must not bring them back — if it did, the sheet
   * would not need keeping and the server would be holding the key to itself.
   */
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recovery codes' })).toBeVisible();
  await expect(shown, 'the codes came back after a reload').toHaveCount(0);
  for (const c of real) {
    await expect(page.getByText(c, { exact: true }), `${c} was shown again`).toHaveCount(0);
  }

  // what IS shown afterwards is a count, which is all a panel needs
  await expect(page.getByText(/10 recovery codes unused/)).toBeVisible();

  /**
   * The outline, with this section in it.
   *
   * `e2e/headings.spec.ts` walks every route but cannot reach this one: the
   * section renders only for a workspace that HAS an SSO connection, and the
   * demo workspace it signs in to has none. So the only screen where this
   * heading exists is the one this spec made, and the claim is this spec's to
   * keep. `lib/outline.ts` holds the predicate both use — the heading was
   * written as an `h4` first, directly under `Panel level={2}`, and h2 → h4 is
   * a step a screen reader reads as a section missing its parent.
   */
  const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', (hs) =>
    hs.filter((h) => (h as HTMLElement).offsetParent !== null || h.closest('.sr-only'))
      .map((h) => Number(h.tagName[1])),
  );
  expect(levels.length, 'no headings were found, so nothing was checked').toBeGreaterThan(2);
  expect(
    firstSkippedHeading(levels),
    'the recovery section leaves a gap in the outline',
  ).toBeNull();
});

test('a workspace that does not enforce single sign-on is offered no code field', async ({ page }) => {
  test.setTimeout(120_000);
  const { email, tag } = await freshFirm(page);
  await configureSso(page, tag);

  /**
   * The other direction, and the one thing about the login door this suite can
   * reach. A code field on every sign-in screen would read as a second
   * password, which is the opposite of what enforcement is for — so the control
   * appears only where a password is impossible.
   */
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  // the home-realm query is debounced; the SSO button is the tell that it landed
  await expect(page.getByRole('button', { name: /Continue with single sign-on/ })).toBeVisible({ timeout: 20_000 });

  await expect(
    page.getByRole('button', { name: /recovery code/i }),
    'a recovery code was offered on a workspace where passwords still work',
  ).toHaveCount(0);
  // and the password field is still there, because it still works
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});
