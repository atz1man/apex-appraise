import { TRPCError } from '@trpc/server';
import type { PrismaClient, Payment } from '@prisma/client';

/**
 * Settling a buyer's payment, exactly once.
 *
 * Three paths settle: buyer.pay in demo mode, buyer.confirmPayment after the
 * card clears client-side, and the Stripe webhook. Each of them read the status,
 * saw it was not PAID, and then wrote — and confirmPayment and the webhook are
 * not a hypothetical pair. The comment above confirmPayment calls the webhook
 * "belt-and-braces", which is to say they are MEANT to overlap. Both settled,
 * both wrote a receipt into the deal's activity trail, and a developer
 * reconciling against a bank statement saw one payment received twice.
 *
 * The compare-and-set is the whole mechanism: the update only matches a row that
 * is still unpaid, so exactly one caller gets count === 1 and only that one
 * writes the receipt. Same technique as the webhook claim lease and the
 * appraisal version flip.
 *
 * paidAt is set by the winner and never touched again. A later write moving it
 * forward would misdate a receipt on a document somebody reconciles against a
 * statement.
 */
export async function settlePayment(
  prisma: PrismaClient,
  paymentId: string,
  receipt: { actor: string; action: string },
): Promise<{ settled: boolean }> {
  const { count } = await prisma.payment.updateMany({
    where: { id: paymentId, status: { not: 'PAID' } },
    data: { status: 'PAID', paidAt: new Date() },
  });
  // somebody else settled it first — not an error, and not a second receipt
  if (count !== 1) return { settled: false };

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { settled: true };
  const unit = await prisma.unit.findFirst({ where: { id: payment.unitId } });
  if (unit) {
    await prisma.activityEvent.create({
      data: {
        orgId: payment.orgId,
        dealId: unit.dealId,
        actor: receipt.actor,
        action: receipt.action,
        target: `${payment.kind} · ${unit.name}`,
      },
    });
  }
  return { settled: true };
}


/* --------------------------- taking the money --------------------------- */

/**
 * The Stripe calls this module makes, behind a seam.
 *
 * Same shape as XeroTransport and BankTransport, and here for the same reason
 * they exist: without it nothing can exercise the branch that CREATES CHARGES.
 * That was the state of things — the two connectors that read a ledger were
 * injectable and the one that takes a buyer's money called fetch inline, so the
 * intent handling below could only ever be reviewed, never tested.
 */
export interface StripeTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number;
    json: () => Promise<unknown>;
  }>;
}

const realStripe: StripeTransport = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};

const STRIPE = 'https://api.stripe.com/v1';

interface Intent {
  id: string;
  client_secret: string;
  status: string;
}

/**
 * One PaymentIntent per payment, ever.
 *
 * This used to create a new intent on every call. A buyer who double-clicks, or
 * reloads the page and tries again, produced a second intent for the same money;
 * the row kept only the newest id, so the first was orphaned at Stripe while
 * still being chargeable by a browser holding its client_secret. Two intents for
 * one deposit is a buyer charged twice and a ledger showing one.
 *
 * Two defences, because they fail differently. Reusing a stored intent covers
 * the sequential case — a reload, a retry after a declined card, which is what a
 * PaymentIntent is designed to survive. Stripe's own Idempotency-Key covers the
 * concurrent one, where both calls read the row before either wrote to it: the
 * second POST returns the FIRST intent rather than making another.
 */
export async function intentFor(
  prisma: PrismaClient,
  payment: Payment,
  description: string,
  transport: StripeTransport = realStripe,
): Promise<{ clientSecret: string; created: boolean }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Stripe is not configured on this server' });
  const auth = { authorization: `Bearer ${key}` };

  if (payment.stripeIntentId) {
    const got = await transport(`${STRIPE}/payment_intents/${payment.stripeIntentId}`, {
      method: 'GET',
      headers: auth,
    }).catch(() => null);
    const existing = got && got.status < 400 ? ((await got.json()) as Intent) : null;
    // a usable intent is reused; one Stripe has since cancelled is not, and
    // falls through to a fresh one below
    if (existing && existing.status !== 'canceled') {
      return { clientSecret: existing.client_secret, created: false };
    }
  }

  const res = await transport(`${STRIPE}/payment_intents`, {
    method: 'POST',
    headers: {
      ...auth,
      'content-type': 'application/x-www-form-urlencoded',
      // keyed on the payment, so two calls racing return one intent
      'idempotency-key': `apex-intent-${payment.id}`,
    },
    body: new URLSearchParams({
      amount: String(payment.amount),
      currency: 'gbp',
      description,
      'metadata[paymentId]': payment.id,
      'automatic_payment_methods[enabled]': 'true',
    }).toString(),
  });
  if (res.status >= 400) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new TRPCError({ code: 'BAD_REQUEST', message: err?.error?.message ?? 'Stripe rejected the payment intent' });
  }
  const intent = (await res.json()) as Intent;
  await prisma.payment.update({ where: { id: payment.id }, data: { stripeIntentId: intent.id } });
  return { clientSecret: intent.client_secret, created: true };
}

/** Has Stripe actually taken the money? Asked server-side, never trusted from the browser. */
export async function intentSucceeded(
  intentId: string,
  transport: StripeTransport = realStripe,
): Promise<{ succeeded: boolean; status: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Stripe is not configured on this server' });
  const res = await transport(`${STRIPE}/payment_intents/${intentId}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}` },
  });
  if (res.status >= 400) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Could not read the payment from Stripe' });
  const intent = (await res.json()) as Intent;
  return { succeeded: intent.status === 'succeeded', status: intent.status };
}
