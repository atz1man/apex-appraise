import { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkLockout,
  pruneAuthThrottles,
  recordFailure,
  recordSuccess,
  tooManyResetRequests,
} from '../src/auth/password.js';
import { prisma, resetDatabase } from './harness.js';

/**
 * The login lockout and the reset throttle lived in two process-local Maps, and
 * were wrong in two directions at once.
 *
 * The headline problem was ACROSS INSTANCES: two API containers meant two
 * independent counters, so five guesses became five per instance and a lockout
 * earned on one was invisible to the other.
 *
 * The problem that arrives first was ON ONE INSTANCE: a key was removed on a
 * successful login and on no other path, so failed attempts against addresses
 * that do not exist — which is what credential stuffing produces — accumulated
 * for the life of the process.
 */

/**
 * A SECOND API instance — and getting this right is the whole test.
 *
 * A second PrismaClient is NOT a second instance: both live in this process, so
 * they share module-level state and a per-process Map passes happily. The first
 * version of these tests made exactly that mistake and went green against the
 * very Map they were written to condemn.
 *
 * `vi.resetModules()` before re-importing gives a genuinely separate copy of the
 * module — its own top-level bindings, its own Map — which is what a second
 * container actually is. Paired with its own client, that is instance B.
 */
let B: typeof import('../src/auth/password.js');
let clientB: PrismaClient;

beforeAll(async () => {
  resetDatabase();
  clientB = new PrismaClient({ datasources: { db: { url: `file:${new URL('../test.db', import.meta.url).pathname}` } } });
  vi.resetModules();
  B = await import('../src/auth/password.js');
}, 120_000);

beforeEach(async () => {
  await prisma.authThrottle.deleteMany({});
});

describe('a login lockout', () => {
  it('locks after five failures and says how long', async () => {
    const email = 'target@firm.co.uk';
    for (let i = 0; i < 4; i++) await recordFailure(prisma, email);
    expect((await checkLockout(prisma, email)).locked, 'locked too early').toBe(false);

    await recordFailure(prisma, email);
    const lock = await checkLockout(prisma, email);
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterMins).toBeGreaterThan(0);
    expect(lock.retryAfterMins).toBeLessThanOrEqual(15);
  });

  /**
   * The bypass. Guesses land on instance A, the sixth arrives at instance B, and
   * before this change B had never heard of the address and let it through.
   */
  it('holds across API instances, so an attacker cannot just ask the other one', async () => {
    const email = 'spread@firm.co.uk';
    for (let i = 0; i < 5; i++) await recordFailure(prisma, email);

    expect((await B.checkLockout(clientB, email)).locked, 'the second instance did not see the lockout').toBe(true);
  });

  it('counts failures from both instances toward the same five', async () => {
    const email = 'split@firm.co.uk';
    for (let i = 0; i < 3; i++) await recordFailure(prisma, email);
    for (let i = 0; i < 2; i++) await B.recordFailure(clientB, email);

    expect((await checkLockout(prisma, email)).locked, 'three here plus two there was not five anywhere').toBe(true);
  });

  it('a successful sign-in clears the count, on every instance', async () => {
    const email = 'recovers@firm.co.uk';
    for (let i = 0; i < 3; i++) await recordFailure(prisma, email);
    await B.recordSuccess(clientB, email);
    expect(await prisma.authThrottle.findUnique({ where: { key: `login:${email}` } })).toBeNull();
  });

  it('an expired lock starts the count over rather than locking on the next failure', async () => {
    const email = 'expired@firm.co.uk';
    await prisma.authThrottle.create({
      data: { key: `login:${email}`, count: 0, windowStart: new Date(), lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await checkLockout(prisma, email)).locked).toBe(false);
    await recordFailure(prisma, email);
    expect((await checkLockout(prisma, email)).locked, 'one failure after a lapsed lock re-locked the account').toBe(false);
  });
});

describe('reset-request throttling', () => {
  it('allows three then refuses, shared across instances', async () => {
    const email = 'mailbomb@firm.co.uk';
    expect(await tooManyResetRequests(prisma, email)).toBe(false);
    expect(await tooManyResetRequests(prisma, email)).toBe(false);
    expect(await B.tooManyResetRequests(clientB, email)).toBe(false);
    // the fourth, on either instance, is one too many
    expect(await B.tooManyResetRequests(clientB, email), 'the other instance handed out a fresh allowance').toBe(true);
  });
});

describe('the sweeper', () => {
  /**
   * The Maps had no pruning at all: a key created by a failed login for an
   * address that does not exist stayed for the life of the process. A table with
   * the same property is just a slower leak.
   */
  it('drops rows too old to affect a decision, and keeps the ones that still can', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await prisma.authThrottle.create({ data: { key: 'login:ancient@x.co', count: 2, windowStart: old } });
    await prisma.authThrottle.update({ where: { key: 'login:ancient@x.co' }, data: { updatedAt: old } });
    await recordFailure(prisma, 'current@x.co');

    const pruned = await pruneAuthThrottles(prisma);
    expect(pruned).toBe(1);
    expect(await prisma.authThrottle.findUnique({ where: { key: 'login:ancient@x.co' } })).toBeNull();
    expect(await prisma.authThrottle.findUnique({ where: { key: 'login:current@x.co' } })).not.toBeNull();
  });
});
