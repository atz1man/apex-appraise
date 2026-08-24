import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordFailure, tooManyResetRequests } from '../src/auth/password.js';
import { SWEEP_INTERVAL_MS, startRowSweeper, sweepExpiredRows } from '../src/row-sweeper.js';
import { DELIVERY_RETENTION_MS } from '../src/webhook-delivery.js';
import { prisma, resetDatabase } from './harness.js';

/**
 * The table a stranger writes to.
 *
 * AuthThrottle is keyed by the email somebody typed at the login form, and a
 * row appears whether or not that account exists — it has to, because a store
 * that only remembers real accounts will tell anyone who asks which addresses
 * are real. So the row count is chosen by whoever is hitting the endpoint, and
 * a stuffing run through a million addresses leaves a million rows.
 *
 * The sweeper for it ran once, at boot. That bounded the table by how often we
 * happened to deploy — on an API that stays up for two months, two months of
 * rows that stopped mattering after twenty-four hours.
 */

beforeAll(async () => {
  resetDatabase();
}, 120_000);

afterEach(() => {
  vi.useRealTimers();
});

const age = (key: string, ms: number) =>
  prisma.authThrottle.update({ where: { key }, data: { updatedAt: new Date(Date.now() - ms) } });

const DAY = 24 * 60 * 60 * 1000;

describe('what the sweep removes', () => {
  it('drops throttles that can no longer affect a decision, and keeps the ones that can', async () => {
    await recordFailure(prisma, 'stale@attacker.test');
    await recordFailure(prisma, 'recent@attacker.test');
    await age('login:stale@attacker.test', DAY + 60_000);

    const swept = await sweepExpiredRows(prisma);
    expect(swept.throttles).toBe(1);
    expect(await prisma.authThrottle.findUnique({ where: { key: 'login:stale@attacker.test' } })).toBeNull();
    expect(
      await prisma.authThrottle.findUnique({ where: { key: 'login:recent@attacker.test' } }),
      'a live lockout was swept away, handing the attacker their attempts back',
    ).not.toBeNull();
  });

  it('counts a reset request too — that row appears on the first attempt, not the fourth', async () => {
    await tooManyResetRequests(prisma, 'probe@attacker.test');
    expect(
      await prisma.authThrottle.findUnique({ where: { key: 'reset:probe@attacker.test' } }),
      'the reset endpoint left nothing behind, so this table is not the whole story',
    ).not.toBeNull();
    await age('reset:probe@attacker.test', DAY + 60_000);
    expect((await sweepExpiredRows(prisma)).throttles).toBe(1);
  });
});

describe('when the sweep runs', () => {
  /**
   * Real timers and an interval far longer than the test, so the only thing that
   * can produce a sweep here is the one on start. An earlier version of this
   * test advanced the clock first, which meant deleting the boot sweep entirely
   * still passed it — the interval had covered for it.
   */
  it('sweeps on start, without waiting an hour for the first one', async () => {
    await recordFailure(prisma, 'onboot@attacker.test');
    await age('login:onboot@attacker.test', DAY + 60_000);

    const swept: number[] = [];
    const timer = startRowSweeper(prisma, { intervalMs: 3_600_000, onSweep: (r) => swept.push(r.throttles) });
    await vi.waitFor(() => expect(swept).toEqual([1]));
    clearInterval(timer);
  });

  it('and again every interval — not only when we deploy', async () => {
    vi.useFakeTimers();
    const swept: number[] = [];
    const timer = startRowSweeper(prisma, { intervalMs: 1000, onSweep: (r) => swept.push(r.throttles) });

    await recordFailure(prisma, 'first@attacker.test');
    await age('login:first@attacker.test', DAY + 60_000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(swept).toEqual([1]));

    /**
     * The point of the whole change: a second batch arrives while the process is
     * still up, and is cleared without anybody restarting anything.
     */
    await recordFailure(prisma, 'second@attacker.test');
    await age('login:second@attacker.test', DAY + 60_000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(swept, 'the table only emptied when the API restarted').toEqual([1, 1]));

    clearInterval(timer);
  });

  it('does not let a failing sweep take the process with it', async () => {
    const broken = {
      openDataCache: { deleteMany: () => Promise.reject(new Error('database gone')) },
      authThrottle: { deleteMany: () => Promise.reject(new Error('database gone')) },
      webhookDelivery: { deleteMany: () => Promise.reject(new Error('database gone')) },
    } as unknown as Parameters<typeof sweepExpiredRows>[0];
    await expect(sweepExpiredRows(broken)).resolves.toEqual({ cache: 0, throttles: 0, deliveries: 0 });
  });

  it('runs hourly by default — often enough to keep a day-long cutoff flat', () => {
    expect(SWEEP_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});

/**
 * The third table with no retention, and the one that mattered for a reason
 * other than size. WebhookDelivery.payload is a verbatim copy of what we sent,
 * and for these events that means deal figures. org.webhookDeliveries — the
 * only thing that reads this table after delivery — selects the event, status,
 * attempts, response code and timestamps, and never the body. So the payloads
 * were a permanent copy of client-confidential numbers kept for nobody.
 */
describe('delivery records do not accumulate for ever', () => {
  const makeDelivery = async (status: string, ageMs: number) => {
    const org = await prisma.organisation.create({ data: { name: 'Retention Ltd', plan: 'TRIAL' } });
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        orgId: org.id,
        url: 'https://a.example.com/hook',
        secret: 'whsec_x',
        events: 'deal.created',
        createdById: 'nobody',
      },
    });
    const row = await prisma.webhookDelivery.create({
      data: {
        orgId: org.id,
        endpointId: endpoint.id,
        event: 'deal.created',
        payload: JSON.stringify({ gdv: 4_278_000_00 }),
        status,
      },
    });
    await prisma.webhookDelivery.update({
      where: { id: row.id },
      data: { createdAt: new Date(Date.now() - ageMs) },
    });
    return row.id;
  };

  const gone = async (id: string) => (await prisma.webhookDelivery.findUnique({ where: { id } })) === null;

  it('drops a delivered record once it has aged out', async () => {
    const old = await makeDelivery('delivered', DELIVERY_RETENTION_MS + DAY);
    const recent = await makeDelivery('delivered', DAY);
    await sweepExpiredRows(prisma);
    expect(await gone(old), 'the payload we sent was still on disk a month later').toBe(true);
    expect(await gone(recent), 'a record still useful for diagnosing an integration was thrown away').toBe(false);
  });

  it('drops a failed one too — a failure is finished, not outstanding', async () => {
    const id = await makeDelivery('failed', DELIVERY_RETENTION_MS + DAY);
    await sweepExpiredRows(prisma);
    expect(await gone(id)).toBe(true);
  });

  it('never touches one still pending, however old it looks', async () => {
    /** Deleting the queue is not a way to tidy the queue. */
    const id = await makeDelivery('pending', DELIVERY_RETENTION_MS * 12);
    await sweepExpiredRows(prisma);
    expect(await gone(id), 'the sweeper deleted work that had not been done yet').toBe(false);
  });

  it('keeps a month, which is well past useful for diagnosing an integration', () => {
    expect(DELIVERY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
