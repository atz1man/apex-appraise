import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Outbound webhooks.
 *
 * A system of record has to push. Until now nothing could react to anything that
 * happened in Apex — an appraisal approved, a covenant breached — which is the
 * difference between a place people look things up and a thing other systems are
 * built on.
 *
 * Two properties a receiver needs in order to trust what arrives:
 *
 *   a SIGNATURE, so they know it came from us and was not altered. HMAC-SHA256
 *   over "<timestamp>.<body>" with the endpoint's own secret — the same
 *   construction Stripe uses, chosen because integrators have already written the
 *   verification code for it.
 *
 *   a TIMESTAMP inside the signed material, so a captured delivery cannot be
 *   replayed months later. Signing the body alone would leave every past delivery
 *   valid forever.
 */

export const WEBHOOK_EVENTS = [
  'appraisal.approved',
  'appraisal.submitted',
  'covenant.breached',
  'deal.created',
  'report.shared',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const isWebhookEvent = (s: string): s is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(s);

/** Shown once when an endpoint is created, exactly like an API key. */
export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export const signPayload = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** The header a receiver checks. Versioned so the scheme can change later. */
export const signatureHeader = (secret: string, timestamp: number, body: string) =>
  `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;

/**
 * Verify a delivery, as a receiver would. Exported because it is the code an
 * integrator has to write, and shipping it means our documentation can be tested
 * rather than merely written.
 */
export function verifySignature(
  secret: string,
  header: string,
  body: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=').map((x) => x.trim()) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  // outside the window it is a replay, however good the signature is
  if (Math.abs(now - t) > tolerance) return false;
  const expected = Buffer.from(signPayload(secret, t, body));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Retry schedule in seconds. Fast twice, then back off — a receiver that is
 *  briefly down should not need a human, and one that is properly down should
 *  not be hammered. */
export const RETRY_DELAYS = [0, 30, 300, 1800];
export const MAX_ATTEMPTS = RETRY_DELAYS.length;
/** consecutive failures after which an endpoint is parked */
export const FAILURE_LIMIT = 20;

export interface EmitOptions {
  /** injected in tests; real callers use fetch */
  deliver?: (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number }>;
  now?: () => Date;
}

/**
 * Queue an event for every endpoint that asked for it.
 *
 * Recording the delivery is separate from making it. The request that triggered
 * the event — approving an appraisal — must not wait on someone else's server,
 * and must not fail because that server is down.
 */
export async function emitWebhook(
  prisma: PrismaClient,
  orgId: string,
  event: WebhookEvent,
  payload: unknown,
): Promise<number> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({ where: { orgId, active: true } });
    const wanted = endpoints.filter((e) => e.events.split(',').map((x) => x.trim()).includes(event));
    if (!wanted.length) return 0;

    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data: payload });
    await prisma.webhookDelivery.createMany({
      data: wanted.map((e) => ({ orgId, endpointId: e.id, event, payload: body })),
    });
    return wanted.length;
  } catch {
    // an event that cannot be queued must not take down the action that caused it
    return 0;
  }
}

/**
 * Attempt the pending deliveries.
 *
 * Called on a timer. Deliberately simple: no queue server, because one more piece
 * of infrastructure to operate is a worse trade at this size than a table and a
 * loop.
 */
export async function drainWebhooks(prisma: PrismaClient, opts: EmitOptions = {}): Promise<{ sent: number; failed: number }> {
  const deliver =
    opts.deliver ??
    (async (url, body, headers) => {
      const res = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(10_000) });
      return { status: res.status };
    });

  const pending = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: { endpoint: true },
  });

  let sent = 0;
  let failed = 0;
  for (const d of pending) {
    const timestamp = Math.floor((opts.now?.() ?? new Date()).getTime() / 1000);
    const headers = {
      'content-type': 'application/json',
      'apex-signature': signatureHeader(d.endpoint.secret, timestamp, d.payload),
      'apex-event': d.event,
      'apex-delivery': d.id,
    };
    try {
      const { status } = await deliver(d.endpoint.url, d.payload, headers);
      const ok = status >= 200 && status < 300;
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts: { increment: 1 },
          responseCode: status,
          status: ok ? 'delivered' : d.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
          deliveredAt: ok ? new Date() : null,
          error: ok ? null : `HTTP ${status}`,
        },
      });
      await prisma.webhookEndpoint.update({
        where: { id: d.endpointId },
        data: {
          lastAttemptAt: new Date(),
          // a run of failures parks the endpoint; one success clears the count,
          // because an integration that recovers should not stay punished
          failureCount: ok ? 0 : { increment: 1 },
          ...(!ok && d.endpoint.failureCount + 1 >= FAILURE_LIMIT ? { active: false } : {}),
        },
      });
      ok ? sent++ : failed++;
    } catch (e) {
      failed++;
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts: { increment: 1 },
          status: d.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
          error: e instanceof Error ? e.message.slice(0, 300) : 'delivery failed',
        },
      });
    }
  }
  return { sent, failed };
}
