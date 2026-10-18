import type { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing: scrypt with per-user salt, stored as "scrypt:<salt>:<hash>".
 * Legacy sha256 hex digests (early seeds) are still verified but should be re-seeded.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    const candidate = scryptSync(plain, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
  // legacy sha256 fallback
  const legacy = createHash('sha256').update(plain).digest('hex');
  return stored === legacy;
}

/**
 * Login throttle: 5 failures per email → 15-minute lockout, held in the DATABASE.
 *
 * This was a `Map` in the API process, which was wrong in two directions.
 *
 * ACROSS INSTANCES it did not exist. Two API containers meant two independent
 * counters, so an attacker spreading guesses across them got five attempts per
 * instance before anything locked, and a lockout earned on one was invisible to
 * the other. A throttle that an attacker can multiply by asking a different
 * machine is not a throttle; it is a speed bump with a documented bypass.
 *
 * ON ONE INSTANCE it grew forever. A key was deleted on a SUCCESSFUL login and
 * on no other path, so every failed attempt against an address that does not
 * exist — exactly what a credential-stuffing run produces — left a permanent
 * entry. That is the failure that arrives first, because one instance is how
 * this product ships today.
 *
 * Postgres rather than Redis, for the reason the webhook queue is a table and a
 * loop: another service to run, secure and back up is a worse trade at this size
 * than a table. The volume is failed logins, which is to say almost none.
 */
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Anything that can talk to the AuthThrottle table — the real client, or a test's. */
type ThrottleStore = Pick<PrismaClient, 'authThrottle'>;

export async function checkLockout(db: ThrottleStore, email: string): Promise<{ locked: boolean; retryAfterMins?: number }> {
  const row = await db.authThrottle.findUnique({ where: { key: `login:${email}` } });
  if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { locked: true, retryAfterMins: Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000) };
  }
  return { locked: false };
}

export async function recordFailure(db: Pick<PrismaClient, 'authThrottle' | '$transaction'>, email: string): Promise<void> {
  const key = `login:${email}`;
  // Publish the count and resulting lock together. Atomic increments preserve
  // simultaneous failures; the conditional expiry reset cannot erase a new lock.
  const now = new Date();
  // A batch transaction needs no JS round trips while holding SQLite's writer
  // lock, and gives Postgres the same atomic three-statement operation.
  await db.$transaction([
    db.authThrottle.updateMany({
      where: { key, lockedUntil: { lte: now } },
      data: { count: 0, lockedUntil: null, windowStart: now },
    }),
    db.authThrottle.upsert({
      where: { key },
      create: { key, count: 1, windowStart: now },
      update: { count: { increment: 1 } },
    }),
    // Requests already in flight must not extend an established lock.
    db.authThrottle.updateMany({
      where: { key, count: { gte: MAX_FAILURES }, lockedUntil: null },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    }),
  ]);
}

export async function recordSuccess(db: ThrottleStore, email: string): Promise<void> {
  await db.authThrottle.delete({ where: { key: `login:${email}` } }).catch(() => undefined);
}

/**
 * Password-reset tokens.
 *
 * The token is random, single-use and short-lived, and only its SHA-256 digest
 * is stored. A leaked database row must not be a working reset link — and the
 * user table is precisely what leaks. Digest, not scrypt: the token already has
 * 256 bits of entropy, so there is nothing to brute-force and no reason to make
 * every verification expensive.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;

export function newResetToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) };
}

export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Reset requests are throttled per email so the endpoint cannot be used to mail-bomb
 * someone, or to farm timing differences between known and unknown addresses.
 *
 * Same store and the same two reasons as the login lockout above: a per-process
 * Map let an attacker multiply the allowance by the number of instances, and
 * never released a key it had once created.
 */
const RESET_MAX = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;

export async function tooManyResetRequests(db: Pick<PrismaClient, 'authThrottle'>, email: string): Promise<boolean> {
  const key = `reset:${email}`;
  const now = new Date();
  // Only an expired window can be reset. Concurrent callers cannot erase the
  // count of a window another caller has just opened.
  await db.authThrottle.updateMany({
    where: { key, windowStart: { lte: new Date(now.getTime() - RESET_WINDOW_MS) } },
    data: { count: 0, windowStart: now, lockedUntil: null },
  });
  const row = await db.authThrottle.upsert({
    where: { key },
    create: { key, count: 1, windowStart: now, lockedUntil: null },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  // Fail closed on database errors: no allowance was recorded, so no reset
  // email may be sent. The public request still does not reveal account state.
  return row.count > RESET_MAX;
}

/**
 * Drop rows that can no longer affect a decision — the pruning the Maps never
 * had. Called on boot beside the open-data sweeper, for the same reason: a table
 * that only grows eventually stops being a feature.
 */
/**
 * Every key shape this module can write for one address.
 *
 * Registration and verification each add a namespaced key: registration throttling calls
 * checkLockout with "register:<email>" as its subject, and checkLockout then
 * prefixes it, so the row lands under "login:register:<email>". Ugly, and
 * harmless while it is written down — but it means a caller enumerating keys by
 * hand can miss it. Verification resends likewise use "reset:verify:<email>".
 *
 * Exported so deleting a workspace can take these with it. They are keyed by
 * email and carry no orgId, so the structural cascade test cannot see them and
 * the org cascade would otherwise leave an ex-customer's address behind.
 */
export const throttleKeysFor = (email: string) => [`login:${email}`, `reset:${email}`, `login:register:${email}`, `reset:verify:${email}`];

export async function pruneAuthThrottles(db: ThrottleStore, olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await db.authThrottle.deleteMany({ where: { updatedAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  return count;
}
