import { beforeAll, describe, expect, it } from 'vitest';
import {
  CLAIM_LEASE_MS,
  FAILURE_LIMIT,
  MAX_ATTEMPTS,
  RETRY_DELAYS,
  drainWebhooks,
  emitWebhook,
  newWebhookSecret,
  signatureHeader,
  verifySignature,
} from '../src/webhook-delivery.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Hooks');
  B = await makeTenant('Nosy');
}, 120_000);

const addEndpoint = (t: Tenant, url: string, events: string[]) =>
  callerFor({ ...t.principal, role: 'ADMIN' }).org.createWebhook({ url, events } as never) as Promise<{
    id: string;
    secret: string;
  }>;

describe('the signature', () => {
  const secret = newWebhookSecret();
  const body = JSON.stringify({ event: 'appraisal.approved', data: { gdv: 1000000 } });

  it('verifies what we send — the receiver code is ours, so it is tested', () => {
    const now = 1_800_000_000;
    expect(verifySignature(secret, signatureHeader(secret, now, body), body, { now })).toBe(true);
  });

  it('rejects a body altered in flight', () => {
    const now = 1_800_000_000;
    const header = signatureHeader(secret, now, body);
    expect(verifySignature(secret, header, body.replace('1000000', '9999999'), { now })).toBe(false);
  });

  it('rejects a replay, however good the signature', () => {
    /**
     * The timestamp is inside the signed material for this reason. Signing the
     * body alone would leave every delivery we have ever made valid forever.
     */
    const then = 1_800_000_000;
    const header = signatureHeader(secret, then, body);
    expect(verifySignature(secret, header, body, { now: then + 301 })).toBe(false);
    expect(verifySignature(secret, header, body, { now: then + 299 })).toBe(true);
  });

  it('rejects another endpoint’s secret, and malformed headers', () => {
    const now = 1_800_000_000;
    const header = signatureHeader(secret, now, body);
    expect(verifySignature(newWebhookSecret(), header, body, { now })).toBe(false);
    for (const bad of ['', 'nonsense', 't=abc,v1=def', `t=${now}`, 'v1=deadbeef']) {
      expect(verifySignature(secret, bad, body, { now })).toBe(false);
    }
  });
});

describe('endpoints', () => {
  it('must be https, because payloads carry deal figures', async () => {
    await expect(addEndpoint(A, 'http://example.com/hook', ['appraisal.approved'])).rejects.toThrow(/https/i);
  });

  it('refuses a subscription to events we never emit', async () => {
    await expect(addEndpoint(A, 'https://example.com/hook', ['nothing.happens'])).rejects.toThrow(/Unknown events/i);
  });

  it('returns the secret once and never again', async () => {
    const made = await addEndpoint(A, 'https://example.com/once', ['appraisal.approved']);
    expect(made.secret).toMatch(/^whsec_/);
    const listed = await callerFor({ ...A.principal, role: 'ADMIN' }).org.webhooks();
    expect(JSON.stringify(listed)).not.toContain(made.secret);
  });
});

describe('delivery', () => {
  it('queues only for endpoints that asked, in the right workspace', async () => {
    // its own workspace, so the count cannot be moved by another test's endpoints
    const mine = await makeTenant('Queue');
    await addEndpoint(mine, 'https://a.example.com/approved', ['appraisal.approved']);
    await addEndpoint(mine, 'https://a.example.com/other', ['deal.created']);
    await addEndpoint(B, 'https://b.example.com/approved', ['appraisal.approved']);

    const queued = await emitWebhook(prisma, mine.orgId, 'appraisal.approved', { dealId: 'd1' });
    expect(queued, 'not the deal.created endpoint, and not the other firm’s').toBe(1);
    const rows = await prisma.webhookDelivery.findMany({ where: { orgId: mine.orgId } });
    expect(rows).toHaveLength(1);
  });

  it('signs what it sends and marks the delivery done', async () => {
    const t = await makeTenant('Hooks2');
    const made = await addEndpoint(t, 'https://a.example.com/hook', ['appraisal.approved']);
    await emitWebhook(prisma, t.orgId, 'appraisal.approved', { gdv: 250000 });

    const seen: Array<{ body: string; headers: Record<string, string> }> = [];
    const out = await drainWebhooks(prisma, {
      deliver: async (_url, body, headers) => {
        seen.push({ body, headers });
        return { status: 200 };
      },
    });
    // the drain is global by design — a background worker, not a per-org call —
    // so assert on THIS event rather than on the total it happened to send
    expect(out.failed).toBe(0);
    const mine = seen.find((x) => JSON.parse(x.body).data?.gdv === 250000);
    expect(mine, 'this workspace’s delivery was not attempted').toBeTruthy();
    expect(verifySignature(made.secret, mine!.headers['apex-signature']!, mine!.body)).toBe(true);
    expect(mine!.headers['apex-event']).toBe('appraisal.approved');

    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.status).toBe('delivered');
    expect(row.responseCode).toBe(200);
  });

  it('retries a failure and gives up after the last attempt', async () => {
    const t = await makeTenant('Hooks3');
    await addEndpoint(t, 'https://a.example.com/down', ['deal.created']);
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });

    /**
     * Time has to move. This loop used to call drain four times in a row with no
     * clock at all and see four attempts — which passed only because the retry
     * schedule was not applied to anything. It was the bug written down as the
     * expected behaviour.
     */
    let clock = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drainWebhooks(prisma, { deliver: async () => ({ status: 500 }), now: () => new Date(clock) });
      clock += RETRY_DELAYS[i + 1] !== undefined ? RETRY_DELAYS[i + 1]! * 1000 : 0;
    }
    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.status).toBe('failed');
    expect((await drainWebhooks(prisma, { deliver: async () => ({ status: 200 }) })).sent).toBe(0);
  });

  /**
   * The schedule is the point. The drain runs every 15 seconds, so without a due
   * time every pass re-tried every pending row: four attempts spent in about 45
   * seconds rather than the ~36 minutes RETRY_DELAYS describes. A receiver that
   * restarted lost the event outright — and burned four of its twenty failures
   * on the way, which is a fifth of the way to being parked for a blip.
   */
  it('waits the scheduled delay before retrying, rather than hammering every pass', async () => {
    const t = await makeTenant('Hooks5');
    await addEndpoint(t, 'https://a.example.com/restarting', ['deal.created']);
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });

    const start = Date.now();
    const fail = { deliver: async () => ({ status: 500 }) };

    // first attempt is due immediately
    expect((await drainWebhooks(prisma, { ...fail, now: () => new Date(start) })).failed).toBe(1);

    // the 15-second timer comes round again, twice, and must find nothing due
    for (const t2 of [15_000, 29_000]) {
      const r = await drainWebhooks(prisma, { ...fail, now: () => new Date(start + t2) });
      expect(r.failed, `retried after ${t2 / 1000}s, before the 30s delay was up`).toBe(0);
    }

    // at 30 seconds it is due
    expect((await drainWebhooks(prisma, { ...fail, now: () => new Date(start + 30_000) })).failed).toBe(1);

    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.attempts, 'attempts should have advanced exactly twice in 30 seconds').toBe(2);
    // and the third is scheduled five minutes out, not immediately
    expect(row.nextAttemptAt.getTime() - (start + 30_000)).toBe(RETRY_DELAYS[2]! * 1000);
  });

  /**
   * A refused connection or a timeout is the likelier failure of the two, and it
   * takes a different branch of the drain — one that did not back off at all.
   */
  it('backs off a connection that throws, not just an HTTP error', async () => {
    const t = await makeTenant('Hooks6');
    await addEndpoint(t, 'https://a.example.com/refused', ['deal.created']);
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });

    const start = Date.now();
    const boom = { deliver: async () => { throw new Error('ECONNREFUSED'); } };
    await drainWebhooks(prisma, { ...boom, now: () => new Date(start) });

    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime() - start, 'a thrown delivery was left due immediately').toBe(RETRY_DELAYS[1]! * 1000);

    // and the very next pass of the timer leaves it alone
    expect((await drainWebhooks(prisma, { ...boom, now: () => new Date(start + 15_000) })).failed).toBe(0);
  });

  it('parks an endpoint that keeps failing, and a success clears the count', async () => {
    const t = await makeTenant('Hooks4');
    const made = await addEndpoint(t, 'https://a.example.com/flaky', ['deal.created']);
    await prisma.webhookEndpoint.update({ where: { id: made.id }, data: { failureCount: FAILURE_LIMIT - 1 } });

    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });
    await drainWebhooks(prisma, { deliver: async () => ({ status: 503 }) });
    const parked = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: made.id } });
    expect(parked.active, 'an endpoint that never answers should stop being tried').toBe(false);

    await prisma.webhookEndpoint.update({ where: { id: made.id }, data: { active: true, failureCount: 5 } });
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd2' });
    await drainWebhooks(prisma, { deliver: async () => ({ status: 200 }) });
    const recovered = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: made.id } });
    expect(recovered.failureCount).toBe(0);
  });

  /**
   * Every API process runs the drain on the same fifteen-second timer. With one
   * process that is fine. With two — a scaled-out deployment, or just the
   * overlap in the middle of a rolling restart — both selected the same due rows
   * and both posted them, and the receiver was told twice that one appraisal had
   * been approved. For an integration that books something on the strength of
   * that, twice is not a cosmetic difference.
   */
  it('is delivered once when two processes drain at the same moment', async () => {
    const t = await makeTenant('Hooks7');
    await addEndpoint(t, 'https://a.example.com/once-only', ['deal.created']);
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });

    const posts: string[] = [];
    const instance = () =>
      drainWebhooks(prisma, {
        deliver: async (_url, body, headers) => {
          posts.push(headers['apex-delivery']!);
          return { status: 200 };
        },
      });

    const [a, b] = await Promise.all([instance(), instance()]);

    expect(posts, 'both processes posted the same event').toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.attempts, 'the attempt was counted twice against the receiver').toBe(1);
    expect(row.status).toBe('delivered');
  });

  /**
   * The race above depends on where the two processes happen to interleave, and
   * a test that only sometimes reaches the window is a test that only sometimes
   * means anything. This one puts the drain in the window on purpose: the
   * competing process claims the row in the gap between this drain's SELECT and
   * its own claim — which is precisely the gap the compare-and-set exists to
   * close, and the one a wider `where` would leave open.
   */
  it('gives up a row that was claimed between selecting it and claiming it', async () => {
    const t = await makeTenant('Hooks9');
    await addEndpoint(t, 'https://a.example.com/contended', ['deal.created']);
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });
    const now = new Date();

    let raced = false;
    const contended = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop !== 'webhookDelivery') return Reflect.get(target, prop, receiver);
        return new Proxy(target.webhookDelivery, {
          get(dTarget, dProp, dReceiver) {
            if (dProp !== 'findMany') return Reflect.get(dTarget, dProp, dReceiver);
            return async (...args: unknown[]) => {
              const rows = await (dTarget.findMany as (...a: unknown[]) => Promise<unknown[]>)(...args);
              if (!raced) {
                raced = true;
                // the other process gets there first
                await prisma.webhookDelivery.updateMany({
                  where: { orgId: t.orgId, status: 'pending' },
                  data: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
                });
              }
              return rows;
            };
          },
        });
      },
    });

    const posts: string[] = [];
    await drainWebhooks(contended, {
      now: () => now,
      deliver: async (_url, _body, headers) => {
        posts.push(headers['apex-delivery']!);
        return { status: 200 };
      },
    });

    expect(posts, 'posted a row another process had already taken').toHaveLength(0);
    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
  });

  it('holds a claimed delivery against a second pass, then releases it', async () => {
    const t = await makeTenant('Hooks8');
    await addEndpoint(t, 'https://a.example.com/slow', ['deal.created']);
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });
    const start = Date.now();

    // a process claims the row and then dies before recording anything
    await prisma.webhookDelivery.updateMany({
      where: { orgId: t.orgId, status: 'pending' },
      data: { nextAttemptAt: new Date(start + CLAIM_LEASE_MS) },
    });

    // the drain is global by design, so assert on THIS row rather than on the
    // totals it happened to return
    const mine = () => prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    const ok = { deliver: async () => ({ status: 200 }) };

    await drainWebhooks(prisma, { ...ok, now: () => new Date(start + 15_000) });
    expect(
      (await mine()).status,
      'another process took a delivery that was already in flight',
    ).toBe('pending');

    /**
     * And the recovery: the lease runs out, the row is due again with its
     * attempt count untouched, and the event goes out. A crash mid-POST costs a
     * minute, not the event.
     */
    await drainWebhooks(prisma, { ...ok, now: () => new Date(start + CLAIM_LEASE_MS) });
    const row = await mine();
    expect(row.status, 'the event was stranded by a claim nobody completed').toBe('delivered');
    expect(row.attempts, 'the abandoned claim was counted as an attempt').toBe(1);
  });

  it('never lets a delivery failure escape into the caller', async () => {
    const t = await makeTenant('Hooks5');
    await addEndpoint(t, 'https://a.example.com/throws', ['deal.created']);
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });
    await expect(
      drainWebhooks(prisma, {
        deliver: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    ).resolves.toMatchObject({ sent: 0, failed: 1 });
    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.error).toContain('ECONNREFUSED');
  });
});
