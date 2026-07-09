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
