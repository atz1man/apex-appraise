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
 * In-memory login throttle: 5 failures per email → 15-minute lockout
 * (matches the spec; swap for Redis when running more than one API instance).
 */
const failures = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export function checkLockout(email: string): { locked: boolean; retryAfterMins?: number } {
  const f = failures.get(email);
  if (f && f.lockedUntil > Date.now()) {
    return { locked: true, retryAfterMins: Math.ceil((f.lockedUntil - Date.now()) / 60_000) };
  }
  return { locked: false };
}

export function recordFailure(email: string) {
  const f = failures.get(email) ?? { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILURES) {
    f.lockedUntil = Date.now() + LOCK_MS;
    f.count = 0;
  }
  failures.set(email, f);
}

export function recordSuccess(email: string) {
  failures.delete(email);
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
 */
const resetRequests = new Map<string, number[]>();
const RESET_MAX = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;

export function tooManyResetRequests(email: string): boolean {
  const now = Date.now();
  const recent = (resetRequests.get(email) ?? []).filter((t) => now - t < RESET_WINDOW_MS);
  recent.push(now);
  resetRequests.set(email, recent);
  return recent.length > RESET_MAX;
}
