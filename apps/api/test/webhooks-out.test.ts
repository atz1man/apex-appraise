import { beforeAll, describe, expect, it } from 'vitest';
import {
  FAILURE_LIMIT,
  MAX_ATTEMPTS,
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

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drainWebhooks(prisma, { deliver: async () => ({ status: 500 }) });
    }
    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.status).toBe('failed');
    expect((await drainWebhooks(prisma, { deliver: async () => ({ status: 200 }) })).sent).toBe(0);
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
