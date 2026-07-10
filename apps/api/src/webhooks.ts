import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from './context.js';

/**
 * Stripe webhook: marks buyer payments PAID when the PaymentIntent succeeds.
 * Requires STRIPE_WEBHOOK_SECRET; requests with a missing/invalid signature are
 * rejected. (Set the endpoint to POST {API_URL}/webhooks/stripe in the Stripe
 * dashboard.)
 */
export function registerWebhooks(app: FastifyInstance) {
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

    const event = payload.json as { type: string; data: { object: { id: string; metadata?: { paymentId?: string } } } };
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const payment = await prisma.payment.findFirst({
        where: intent.metadata?.paymentId ? { id: intent.metadata.paymentId } : { stripeIntentId: intent.id },
      });
      if (payment && payment.status !== 'PAID') {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PAID', paidAt: new Date() } });
        const unit = await prisma.unit.findFirst({ where: { id: payment.unitId } });
        if (unit) {
          await prisma.activityEvent.create({
            data: { orgId: payment.orgId, dealId: unit.dealId, actor: 'Stripe', action: 'payment received', target: `${payment.kind} · ${unit.name}` },
          });
        }
      }
      }
      return { received: true };
    });
  });
}
