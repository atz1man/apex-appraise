import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { planHasFeature } from '@apex/types/plan';
import { openFor } from './sealed-fields.js';
import { assertPublicHttpsUrl } from './outbound.js';

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

/**
 * The event names live in @apex/types/api, because the API documentation page
 * lists them and the browser cannot import from this package. Re-exported so
 * every existing import still resolves — and api-docs.test.ts asserts this is
 * the SAME array, not a second one that happens to agree today.
 */
import { WEBHOOK_EVENTS, isWebhookEvent, type WebhookEvent } from '@apex/types/api';
export { WEBHOOK_EVENTS, isWebhookEvent };
export type { WebhookEvent };

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

/**
 * Retry schedule in seconds, indexed by attempt number. Fast twice, then back
 * off — a receiver that is briefly down should not need a human, and one that is
 * properly down should not be hammered.
 *
 * This existed for a long time as a comment attached to an array nothing read.
 * The drain selected every pending row on every pass and ran on a 15-second
 * timer, so all four attempts were spent in about 45 seconds rather than the
 * ~36 minutes described here: a receiver that restarted lost the event outright,
 * and burned four of its twenty failures doing it. `nextAttemptAt` on the
 * delivery is what makes the schedule real.
 */
export const RETRY_DELAYS = [0, 30, 300, 1800];

/** When attempt number `n` becomes due, relative to the failure before it. */
export const retryDelayMs = (attempt: number) => (RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]!) * 1000;
export const MAX_ATTEMPTS = RETRY_DELAYS.length;
/** consecutive failures after which an endpoint is parked */
export const FAILURE_LIMIT = 20;

/**
 * How long a delivery record is kept.
 *
 * The table had no retention at all: every row we ever queued stayed, and the
 * biggest column in it is `payload` — a verbatim copy of what we sent, which
 * for these events means deal figures. Nothing reads that column once the
 * delivery is terminal. The diagnostic view (org.webhookDeliveries) selects
 * event, status, attempts, response code and timestamps, and never the body.
 * So it was a permanent copy of client-confidential numbers kept for nobody.
 *
 * Thirty days is well past useful for "why did my integration stop working",
 * and the view only ever shows the hundred most recent anyway.
 */
export const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drop delivery records that have finished and aged out.
 *
 * Terminal rows only. A row still marked pending is outstanding work however
 * old it looks, and deleting the queue is not a way to tidy the queue.
 *
 * No index for this query on purpose: with the sweep running, the table stays
 * within a month of traffic, and an index maintained on every insert to speed
 * up an hourly delete is the wrong trade.
 */
export async function pruneWebhookDeliveries(
  prisma: PrismaClient,
  olderThanMs = DELIVERY_RETENTION_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.webhookDelivery
    .deleteMany({ where: { status: { in: ['delivered', 'failed'] }, createdAt: { lt: cutoff } } })
    .catch(() => ({ count: 0 }));
  return count;
}

/**
 * How long a claimed delivery is held before anyone may try it again.
 *
 * The drain selects what is due and then posts it, and every API process runs
 * that loop on the same fifteen-second timer. With one process that is fine.
 * With two — a scaled-out deployment, or just the overlap in the middle of a
 * rolling restart — both select the same rows and both post them, and the
 * receiver is charged twice for one approved appraisal.
 *
 * The claim is a compare-and-set on nextAttemptAt: push it into the future in
 * an updateMany that still requires the row to be pending and due, and take the
 * row only if the update matched. Two processes race, one gets a count of 1 and
 * the other gets 0 and moves on. No queue server, no advisory lock, no new
 * column — the row's own due-time is the lease, and the index that makes the
 * drain's query fast is the index that makes the claim fast.
 *
 * A minute, against a ten-second delivery timeout: long enough that no attempt
 * outlives its own claim, short enough that a process killed mid-POST holds the
 * event up for a minute rather than for ever. The recovery path is the ordinary
 * one — the lease runs out and the row is due again, with its attempt count
 * unchanged, so nothing is lost and nothing is double-counted.
 */
export const CLAIM_LEASE_MS = 60_000;

/**
 * The real delivery. Exported so the guard on it can be tested directly rather
 * than through a seam the tests replace — `drainWebhooks` takes an injected
 * `deliver` in every test it has, so a check living only inside the default
 * would be exercised by nothing.
 *
 * Two rules, and the second matters as much as the first:
 *
 * The address is re-checked HERE, not only when the endpoint was created. A
 * hostname is not a constant: one that resolved to a public address last month
 * can resolve inside the network today, and an endpoint added before this guard
 * existed has never been checked at all.
 *
 * Redirects are refused. `fetch` follows them by default, so a perfectly public
 * URL that answers 302 with `Location: https://10.0.0.5/` walks straight past
 * any check made on the URL we were given — the check would be of an address we
 * never actually talk to. A webhook receiver has no business redirecting the
 * delivery of a signed payload anyway; `manual` makes the 3xx an ordinary
 * non-2xx result, which the retry and failure counting already handle.
 */
export async function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number }> {
  await assertPublicHttpsUrl(url);
  const res = await fetch(url, {
    method: 'POST',
    body,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status };
}

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
    /**
     * The plan is re-checked at DELIVERY, not only when the endpoint was added.
     *
     * Endpoints are not deleted by a downgrade — the workspace keeps them, and
     * they resume the moment it is back on a plan that includes them. But a
     * Starter workspace that once subscribed to Enterprise must not keep
     * receiving deal figures on someone else's server; that is the feature it
     * stopped paying for. Nothing is queued, so nothing accumulates to be
     * flushed later either.
     */
    const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { plan: true } });
    if (!planHasFeature(org?.plan ?? '', 'publicApi')) return 0;

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
  const deliver = opts.deliver ?? postWebhook;

  const now = opts.now?.() ?? new Date();

  /**
   * Only what is actually due. Without the nextAttemptAt bound this took every
   * pending row on every pass, which is how a schedule measured in minutes was
   * consumed in seconds.
   */
  const candidates = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: { endpoint: true },
  });

  let sent = 0;
  let failed = 0;
  for (const d of candidates) {
    // Claim it, or leave it to whoever did. See CLAIM_LEASE_MS.
    const { count } = await prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: 'pending', nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
    });
    if (count !== 1) continue;

    const timestamp = Math.floor(now.getTime() / 1000);
    const headers = {
      'content-type': 'application/json',
      'apex-signature': signatureHeader(
        openFor('webhookEndpoint', 'secret', d.orgId, d.endpoint.secret),
        timestamp,
        d.payload,
      ),
      'apex-event': d.event,
      'apex-delivery': d.id,
    };
    try {
      const { status } = await deliver(d.endpoint.url, d.payload, headers);
      const ok = status >= 200 && status < 300;
      const nextAttempt = d.attempts + 1;
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts: { increment: 1 },
          responseCode: status,
          status: ok ? 'delivered' : nextAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
          deliveredAt: ok ? now : null,
          error: ok ? null : `HTTP ${status}`,
          // back off before the next one; harmless on a delivered or failed row
          ...(ok ? {} : { nextAttemptAt: new Date(now.getTime() + retryDelayMs(nextAttempt)) }),
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
      const nextAttempt = d.attempts + 1;
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts: { increment: 1 },
          status: nextAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
          error: e instanceof Error ? e.message.slice(0, 300) : 'delivery failed',
          // a refused connection or a timeout backs off exactly like an HTTP error;
          // it is the likelier failure of the two and was the one still hammering
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(nextAttempt)),
        },
      });
    }
  }
  return { sent, failed };
}
