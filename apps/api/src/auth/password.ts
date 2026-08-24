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
type ThrottleStore = {
  authThrottle: {
    findUnique(args: { where: { key: string } }): Promise<{ key: string; count: number; windowStart: Date; lockedUntil: Date | null } | null>;
    upsert(args: any): Promise<unknown>;
    delete(args: { where: { key: string } }): Promise<unknown>;
    deleteMany(args?: any): Promise<{ count: number }>;
  };
};

export async function checkLockout(db: ThrottleStore, email: string): Promise<{ locked: boolean; retryAfterMins?: number }> {
  const row = await db.authThrottle.findUnique({ where: { key: `login:${email}` } }).catch(() => null);
  if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { locked: true, retryAfterMins: Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000) };
  }
  return { locked: false };
}

export async function recordFailure(db: ThrottleStore, email: string): Promise<void> {
  const key = `login:${email}`;
  const row = await db.authThrottle.findUnique({ where: { key } }).catch(() => null);
  const expired = row?.lockedUntil ? row.lockedUntil.getTime() <= Date.now() : false;
  // a lock that has run out starts the count again rather than leaving the user
  // one failure from another fifteen minutes
  const count = (expired ? 0 : (row?.count ?? 0)) + 1;
  const locking = count >= MAX_FAILURES;
  const data = {
    count: locking ? 0 : count,
    lockedUntil: locking ? new Date(Date.now() + LOCK_MS) : expired ? null : (row?.lockedUntil ?? null),
    windowStart: row && !expired ? row.windowStart : new Date(),
  };
  await db.authThrottle.upsert({ where: { key }, create: { key, ...data }, update: data }).catch(() => undefined);
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

export async function tooManyResetRequests(db: ThrottleStore, email: string): Promise<boolean> {
  const key = `reset:${email}`;
  const row = await db.authThrottle.findUnique({ where: { key } }).catch(() => null);
  const fresh = row && Date.now() - row.windowStart.getTime() < RESET_WINDOW_MS;
  const count = (fresh ? row.count : 0) + 1;
  const data = { count, windowStart: fresh ? row.windowStart : new Date(), lockedUntil: null };
  await db.authThrottle.upsert({ where: { key }, create: { key, ...data }, update: data }).catch(() => undefined);
  return count > RESET_MAX;
}

/**
 * Drop rows that can no longer affect a decision — the pruning the Maps never
 * had. Called on boot beside the open-data sweeper, for the same reason: a table
 * that only grows eventually stops being a feature.
 */
export async function pruneAuthThrottles(db: ThrottleStore, olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await db.authThrottle.deleteMany({ where: { updatedAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  return count;
}
