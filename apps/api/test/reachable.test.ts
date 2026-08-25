import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';

/**
 * Every procedure the server offers, and whether anything can actually reach it.
 *
 * This branch has now found the same defect five times: something declared on
 * one side of a boundary with nothing on the other. Four webhook events that
 * were documented and never emitted. A write scope no route consumed. Five
 * pricing features nothing enforced. Endpoints only tRPC could create. And the
 * worst of them, single sign-on: three complete, tested procedures and a
 * settings switch marked "require single sign-on", with no button anywhere that
 * called any of them — so turning the switch on locked the firm out of its own
 * workspace, and the error told them to press the button that did not exist.
 *
 * Every one of those was invisible because nothing compares the two halves. This
 * does: it walks the real router, greps the real app, and refuses a procedure
 * that no screen and no documented surface can get to.
 *
 * An unreachable procedure is not dead code — dead code is harmless. It is a
 * capability we believe we have.
 */

const WEB_SRC = resolve(new URL('..', import.meta.url).pathname, '../../apps/web/src');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const p = resolve(dir, entry);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });

/**
 * The four ways the app reaches a procedure, all of them real and all of them in
 * use: the React hooks, the query-cache utils, the vanilla client for a call
 * that is not a hook, and a raw fetch from the error boundary, which cannot use
 * the client because the client may be what broke.
 */
const CALL_FORMS = (path: string) => [`trpc.${path}.`, `utils.${path}.`, `client.${path}.`, `/trpc/${path}`];

/**
 * Procedures with no caller in the app, each a decision rather than an
 * oversight. A new entry needs a reason, and the test below fails if a reason
 * here stops being true.
 */
const NO_APP_CALLER: Record<string, string> = {
  'auth.me':
    'the canonical "who am I" for an API consumer. The app holds the principal from sign-in, so it has never needed to ask.',
  'org.demoMailbox':
    'reads the in-memory mailbox a demo instance keeps when no SMTP is configured. e2e/screens.spec.ts drives it over HTTP; there is no screen, so a demo instance can be tested but an operator still cannot read an invite. A gap, deliberately left rather than missed.',
  'appraisal.compute':
    'the app imports the engine directly and computes in the browser, which is the point of a shared engine. This is the same computation for an API consumer.',
  'appraisal.sensitivity':
    'likewise — sensitivityGrid() is called straight from @apex/appraisal-engine in the report and the workbook export.',
};

describe('what the server offers', () => {
  const paths = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
  const app = sourceFiles(WEB_SRC)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const reached = (path: string) => CALL_FORMS(path).some((form) => app.includes(form));

  it('reads a real router and a real app', () => {
    // if either side ever comes back empty this file passes vacuously, which is
    // the failure mode of every test that greps
    expect(paths.length, 'no procedures — the router shape has changed').toBeGreaterThan(100);
    expect(app.length, 'no app source — the path has moved').toBeGreaterThan(100_000);
    expect(reached('auth.login'), 'the app cannot even reach auth.login — the matcher is wrong').toBe(true);
  });

  it('can be reached from the app, or says in writing why not', () => {
    const unreachable = paths.filter((p) => !reached(p) && !(p in NO_APP_CALLER));
    expect(
      unreachable,
      'these procedures exist and nothing in the app can call them. Build the screen, or add an entry to ' +
        `NO_APP_CALLER with a reason: ${unreachable.join(', ')}`,
    ).toEqual([]);
  });

  it('has not kept an excuse past its usefulness', () => {
    // an entry that IS now called is an entry nobody will re-read, and the list
    // stops meaning anything the moment it is allowed to go stale
    const stale = Object.keys(NO_APP_CALLER).filter((p) => reached(p));
    expect(stale, `these are called by the app now — drop them from NO_APP_CALLER: ${stale.join(', ')}`).toEqual([]);

    const gone = Object.keys(NO_APP_CALLER).filter((p) => !paths.includes(p));
    expect(gone, `these no longer exist — drop them from NO_APP_CALLER: ${gone.join(', ')}`).toEqual([]);
  });
});

/**
 * Single sign-on, specifically.
 *
 * The general rule above would have caught this, but it is worth naming: an
 * enforced workspace has exactly one way in, and if the page that is supposed to
 * offer it does not, the firm is locked out with no recovery short of the
 * database.
 */
describe('the way in for a workspace that enforces single sign-on', () => {
  const login = readFileSync(resolve(WEB_SRC, 'routes/Login.tsx'), 'utf8');
  const app = readFileSync(resolve(WEB_SRC, 'App.tsx'), 'utf8');

  it('offers the button auth.login tells people to press', () => {
    // auth.login refuses an enforced org with "Use the SSO button instead"
    expect(login).toContain('trpc.auth.ssoStart.');
    expect(login).toContain('trpc.auth.ssoAvailable.');
    expect(login.toLowerCase()).toContain('single sign-on');
  });

  it('serves the address the identity provider is told to return to', () => {
    // auth.ssoStart registers `${APP_URL}/sso/callback` as the redirect URI
    expect(app).toContain('path="/sso/callback"');
  });
});
