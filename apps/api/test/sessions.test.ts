import { beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, issuedBefore, principalFromAuthHeader } from '../src/context.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Ending a session you no longer want.
 *
 * A sign-in token carries a subject and an expiry and is good for twelve hours
 * on its signature alone. Nothing revoked one. So the advice every service
 * gives after a laptop goes missing or a password is phished — change your
 * password — did nothing whatsoever to the session already in the attacker's
 * hands. They stayed signed in for the rest of the day, past the moment the
 * victim believed they had shut the door.
 */

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Sessions');
  await prisma.user.update({ where: { id: T.userId }, data: { password: hash('old-password-1') } });
}, 120_000);

// the API hashes with sha256 (see auth/password.ts); imported rather than
// reimplemented so this cannot drift
import { hashPassword as hash } from '../src/auth/password.js';

const tokenFor = (userId: string, issuedAt?: number) =>
  jwt.sign({ sub: userId, ...(issuedAt !== undefined ? { iat: issuedAt } : {}) }, JWT_SECRET, { expiresIn: '12h' });

/**
 * A session that already existed: the account has been signed into before, and
 * this token was minted a minute ago. Both halves matter — a fresh row's cutoff
 * is now(), so a backdated token against an untouched account is correctly
 * refused, and a test that skipped this would be asserting the wrong thing.
 */
async function existingSession(userId: string) {
  const oneMinuteAgo = Math.floor(Date.now() / 1000) - 60;
  await prisma.user.update({
    where: { id: userId },
    data: { sessionsValidFrom: new Date((oneMinuteAgo - 60) * 1000) },
  });
  return tokenFor(userId, oneMinuteAgo);
}

const resolve = (token: string) => principalFromAuthHeader(prisma, `Bearer ${token}`);

describe('a token outlives nothing it should not', () => {
  it('is accepted while the account is untouched', async () => {
    expect(await resolve(tokenFor(T.userId))).toMatchObject({ userId: T.userId });
  });

  it('stops working the moment the password changes', async () => {
    const stolen = await existingSession(T.userId);
    expect(await resolve(stolen), 'precondition: the stolen token worked').toMatchObject({ userId: T.userId });

    await callerFor(T.principal).auth.changePassword({ current: 'old-password-1', next: 'a-much-better-one' });

    expect(
      await resolve(stolen),
      'the session issued before the password changed was still good',
    ).toBeNull();
  });

  it('hands the browser doing the changing a token that still works', async () => {
    await prisma.user.update({ where: { id: T.userId }, data: { password: hash('another-one-1') } });
    const res = await callerFor(T.principal).auth.changePassword({
      current: 'another-one-1',
      next: 'and-another-one',
    });
    /**
     * Without this the user is signed out by their own security step, one second
     * after taking it — which is how people learn to put it off.
     */
    expect(await resolve(res.token), 'the replacement token was dead on arrival').toMatchObject({
      userId: T.userId,
    });
  });

  it('stops working when the password is RESET, which is the case that matters most', async () => {
    /**
     * A reset is the flow for someone who may have lost control of the
     * credential entirely. If any flow has to end the old sessions, it is this
     * one.
     */
    const stolen = await existingSession(T.userId);
    expect(await resolve(stolen)).toMatchObject({ userId: T.userId });

    const raw = 'reset-token-under-test';
    const { hashResetToken } = await import('../src/auth/password.js');
    await prisma.user.update({
      where: { id: T.userId },
      data: { resetTokenHash: hashResetToken(raw), resetTokenExpiresAt: new Date(Date.now() + 3_600_000) },
    });
    await callerFor(T.principal).auth.resetPassword({ token: raw, password: 'reset-password-9' });

    expect(await resolve(stolen), 'a password reset left the old sessions alive').toBeNull();
  });

  it('does not touch anybody else’s sessions', async () => {
    const other = await makeTenant('Bystander');
    const theirs = await existingSession(other.userId);
    await prisma.user.update({ where: { id: T.userId }, data: { password: hash('yet-another-1') } });
    await callerFor(T.principal).auth.changePassword({ current: 'yet-another-1', next: 'one-more-time-1' });
    expect(await resolve(theirs), 'one firm’s password change signed out another firm').toMatchObject({
      userId: other.userId,
    });
  });
});

/**
 * The upload routes are plain Fastify, not tRPC, so they never went through
 * createContext — and they verified the session token in a second copy of the
 * same six lines. The copy fell behind the moment sessions gained a cutoff:
 * tRPC honoured it, this did not. Changing a phished password shut the attacker
 * out of the application and left them the data room.
 */
describe('every surface uses the same verifier', () => {
  it('the upload routes honour the cutoff too', async () => {
    const t = await makeTenant('Uploads');
    await prisma.user.update({ where: { id: t.userId }, data: { password: hash('upload-pass-1') } });
    const stolen = await existingSession(t.userId);

    const { principalFrom } = await import('../src/uploads.js');
    const asHeader = (token: string) =>
      principalFrom({ headers: { authorization: `Bearer ${token}` } }, prisma);

    expect(await asHeader(stolen), 'precondition: the stolen token reached the data room').toMatchObject({
      userId: t.userId,
    });

    await callerFor({ ...t.principal, userId: t.userId }).auth.changePassword({
      current: 'upload-pass-1',
      next: 'a-better-one-1',
    });

    expect(
      await asHeader(stolen),
      'the revoked session could still read and write the firm’s documents',
    ).toBeNull();
  });

  /**
   * internalWriter is the upload routes' copy of the internalProcedure chain,
   * and it carries all three rules at once. Asserted together, because what
   * went wrong twice was one rule arriving and the others being assumed.
   */
  it('carries the whole chain: token, internal, live trial', async () => {
    const { internalWriter, GuardError } = await import('../src/http-guards.js');
    const t = await makeTenant('Chain');
    const call = (token: string) =>
      internalWriter({ headers: { authorization: `Bearer ${token}` } }, 'uploads.document', prisma);

    // 1. no token at all
    await expect(
      internalWriter({ headers: {} }, 'uploads.document', prisma),
    ).rejects.toBeInstanceOf(GuardError);

    // 2. a portal login is not a member of the firm
    await expect(call(tokenFor(t.investorPrincipal.userId))).rejects.toBeInstanceOf(GuardError);

    // 3. a member of the firm, on a live workspace
    await expect(call(tokenFor(t.userId))).resolves.toMatchObject({ userId: t.userId });

    // 4. the same member, once the trial has lapsed
    await prisma.organisation.update({
      where: { id: t.orgId },
      data: { plan: 'TRIAL', trialEndsAt: new Date(Date.now() - 86_400_000) },
    });
    await expect(call(tokenFor(t.userId))).rejects.toThrow(/trial ended/i);
  });

  it('refuses a portal login on the upload routes, cutoff or no cutoff', async () => {
    /**
     * This surface's own rule, kept when the verifier was shared out: an
     * investor or buyer portal login has no business writing to a firm's
     * document store.
     */
    const t = await makeTenant('Portals');
    const { principalFrom } = await import('../src/uploads.js');
    const token = tokenFor(t.investorPrincipal.userId);
    expect(await principalFrom({ headers: { authorization: `Bearer ${token}` } }, prisma)).toBeNull();
  });
});

describe('the cutoff comparison', () => {
  /**
   * `iat` is whole seconds and the cutoff is not, so the two are compared in
   * seconds. The cutoff rounds DOWN, which decides what happens to a token
   * minted in the same second as the change — and the replacement token issued
   * by changePassword is exactly that token.
   */
  const cutoff = new Date(1_800_000_000_500); // 1800000000.5s

  it('keeps a token issued in the same second as the change', () => {
    expect(issuedBefore(1_800_000_000, cutoff)).toBe(false);
  });

  it('refuses the second before', () => {
    expect(issuedBefore(1_799_999_999, cutoff)).toBe(true);
  });

  it('refuses a token that cannot be placed at all', () => {
    expect(issuedBefore(undefined, cutoff)).toBe(true);
  });
});
