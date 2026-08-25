import type { PrismaClient } from '@prisma/client';

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
