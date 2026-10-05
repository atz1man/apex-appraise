import { beforeAll, describe, expect, it } from 'vitest';
import { anonymous, callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Enforcing single sign-on is a one-way door, so it cannot be opened onto a
 * connection nobody has walked through.
 *
 * `enforced` makes `auth.login` refuse EVERY password in the workspace, and
 * `requestPasswordReset` deliberately issues no token to a firm that does not
 * use passwords. Turning it back off needs `org.saveSso` or `org.deleteSso`,
 * both `adminProcedure` — reachable only by an admin who can sign IN, which by
 * then means only through the identity provider. So a wrong issuer, a wrong
 * client id, or an IdP that is simply down locked a firm out of its own
 * workspace permanently, and nothing stopped an administrator from arriving
 * there in a single save on a configuration that had never been tested.
 *
 * `a9cbb50` found the lockout and answered it with the optimistic stamp, which
 * stops a SECOND admin restoring the switch. It does not stop a first admin
 * setting it.
 *
 * The precondition is `lastLoginAt`, stamped by the SSO callback the moment a
 * sign-in resolves to a user. It is exactly "has this ever worked", it already
 * existed, and the settings panel already displayed it.
 */

let T: Tenant;
const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

const CONFIG = {
  issuer: 'https://login.microsoftonline.com/contoso/v2.0',
  clientId: 'client-abc',
  clientSecret: 'secret-abc',
  domains: ['contoso.example'],
  defaultRole: 'ANALYST' as const,
};

const stored = () => prisma.ssoConnection.findUniqueOrThrow({ where: { orgId: T.orgId } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('SsoEnforce');
}, 120_000);

describe('a connection nobody has signed in through', () => {
  it('refuses to be enforced, and says what to do first', async () => {
    await expect(
      admin().org.saveSso({ ...CONFIG, enforced: true } as never),
    ).rejects.toThrow(/sign in with single sign-on once before enforcing/i);
  });

  it('did not half-save the configuration on the way to refusing', async () => {
    expect(await prisma.ssoConnection.count({ where: { orgId: T.orgId } })).toBe(0);
  });

  it('saves perfectly well unenforced', async () => {
    await admin().org.saveSso({ ...CONFIG, enforced: false } as never);
    const c = await stored();
    expect(c.enforced).toBe(false);
    expect(c.lastLoginAt).toBeNull();
  });

  it('still refuses enforcement on the second attempt, with the config now stored', async () => {
    const c = await stored();
    await expect(
      admin().org.saveSso({ ...CONFIG, enforced: true, expectedUpdatedAt: c.updatedAt } as never),
    ).rejects.toThrow(/sign in with single sign-on once before enforcing/i);
    expect((await stored()).enforced, 'enforcement was stored despite the refusal').toBe(false);
  });
});

describe('once a sign-in has proven the connection', () => {
  beforeAll(async () => {
    // what auth.ssoCallback stamps the moment a sign-in resolves to a user
    await prisma.ssoConnection.update({ where: { orgId: T.orgId }, data: { lastLoginAt: new Date() } });
  });

  it('lets it be enforced', async () => {
    const c = await stored();
    await admin().org.saveSso({ ...CONFIG, enforced: true, expectedUpdatedAt: c.updatedAt } as never);
    expect((await stored()).enforced).toBe(true);
  });

  /** And the control itself still works — this guards the door, it does not widen it. */
  it('refuses every password in the workspace once enforced', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: T.userId } });
    await expect(
      anonymous().auth.login({ email: user.email, password: 'whatever' } as never),
    ).rejects.toThrow(/single sign-on/i);
  });

  /**
   * An unrelated edit on an ALREADY enforced connection keeps its setting.
   * Refusing a domain change because of a condition the firm is already living
   * in helps nobody — and the guard is on the transition, not the state.
   */
  it('lets an enforced connection be edited without turning enforcement off', async () => {
    // clear the proof FIRST, then read the stamp: `updatedAt` is @updatedAt, so
    // writing lastLoginAt after reading it makes the stamp stale and the save
    // fails on the concurrency guard rather than on what this test is about
    await prisma.ssoConnection.update({ where: { orgId: T.orgId }, data: { lastLoginAt: null } });
    const c = await stored();
    await admin().org.saveSso({
      ...CONFIG,
      domains: ['contoso.example', 'contoso-group.example'],
      enforced: true,
      expectedUpdatedAt: c.updatedAt,
    } as never);
    const after = await stored();
    expect(after.enforced).toBe(true);
    expect(after.domains).toContain('contoso-group.example');
  });
});
