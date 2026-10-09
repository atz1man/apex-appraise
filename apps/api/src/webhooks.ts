import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './context.js';
import { reconcileSubscription } from './billing.js';
import { settlePayment } from './payments.js';
import { stripeConfigured } from './stripe.js';

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
  'invoice.paid', 'invoice.payment_failed',
]);

/**
 * Stripe webhook: settles buyer payments and reconciles subscription access.
 * Requires STRIPE_WEBHOOK_SECRET; requests with a missing/invalid signature are
 * rejected. (Set the endpoint to POST {API_URL}/webhooks/stripe in the Stripe
 * dashboard.)
 */
export function registerWebhooks(app: FastifyInstance, prisma: PrismaClient = defaultPrisma) {
  // Stripe signs the RAW body — capture it inside an encapsulated scope so the
  // custom parser never touches tRPC or upload routes.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      try {
        done(null, { raw: body as string, json: JSON.parse(body as string) });
      } catch (e) {
        done(e as Error);
      }
    });

    scope.post('/webhooks/stripe', async (req, reply) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return reply.code(501).send({ error: 'Stripe webhooks not configured' });

    const sigHeader = req.headers['stripe-signature'];
    const payload = req.body as { raw: string; json: any };
    if (typeof sigHeader !== 'string' || !payload?.raw) return reply.code(400).send({ error: 'Bad signature' });

    const parts = Object.fromEntries(sigHeader.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return reply.code(400).send({ error: 'Bad signature' });
    // reject replays older than 5 minutes
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return reply.code(400).send({ error: 'Stale signature' });
    const expected = createHmac('sha256', secret).update(`${t}.${payload.raw}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(v1, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return reply.code(400).send({ error: 'Bad signature' });

    const event = payload.json as {
      type: string;
      data: { object: { id: string; customer?: string | { id: string }; metadata?: { paymentId?: string } } };
    };
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const customer = event.data?.object?.customer;
      const customerId = typeof customer === 'string' ? customer : customer?.id;
      if (typeof customerId !== 'string' || !customerId) {
        return reply.code(400).send({ error: 'Subscription event has no customer' });
      }
      // The stored Stripe customer is the tenant boundary. Event metadata is
      // not permission to choose a workspace; ambiguous mappings change none.
      const orgs = await prisma.organisation.findMany({
        where: { stripeCustomerId: customerId }, select: { id: true },
        orderBy: { id: 'asc' }, take: 2,
      });
      if (orgs.length > 1) return reply.code(409).send({ error: 'Stripe customer belongs to multiple workspaces' });
      if (orgs[0]) {
        if (!stripeConfigured()) return reply.code(503).send({ error: 'Stripe API is not configured' });
        // Delivery can be duplicated or out of order. Read Stripe's CURRENT
        // state through the same rule Settings uses, never replay event data.
        // A failed fetch must propagate so Stripe retries instead of losing it.
        await reconcileSubscription(prisma, orgs[0].id);
      }
    }
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const payment = await prisma.payment.findFirst({
        where: intent.metadata?.paymentId ? { id: intent.metadata.paymentId } : { stripeIntentId: intent.id },
      });
      /**
       * Stripe retries a webhook until it is acknowledged, and confirmPayment
       * may be settling the same intent from the browser at this moment. Both
       * are expected; two receipts on the deal are not.
       */
      if (payment) await settlePayment(prisma, payment.id, { actor: 'Stripe', action: 'payment received' });
      }
      return { received: true };
    });
  });
}
