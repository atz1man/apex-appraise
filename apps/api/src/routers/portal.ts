import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { J, P } from '../mappers.js';
import { buyerProcedure, internalProcedure, investorProcedure, router } from '../trpc.js';

/** Investor position scaled to their share — no unit-level buyer PII crosses this boundary. */
async function investorPosition(prisma: any, investorId: string, orgId: string) {
  const inv = await prisma.investor.findFirst({
    where: { id: investorId, orgId },
    include: {
      holdings: { include: { deal: { select: { name: true, address: true, stage: true, assetType: true } } } },
      cashflows: { orderBy: { date: 'desc' } },
    },
  });
  if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
  const sh = inv.sharePct / 100;
  const holdings = inv.holdings.map((h: any) => ({
    dealName: h.deal.name,
    dealAddress: h.deal.address,
    stage: h.deal.stage,
    assetType: h.deal.assetType,
    committed: P(h.committed) * sh,
    called: P(h.called) * sh,
    distributed: P(h.distributed) * sh,
    irr: h.irr,
  }));
  const committed = holdings.reduce((a: number, h: any) => a + h.committed, 0);
  const called = holdings.reduce((a: number, h: any) => a + h.called, 0);
  const distributed = holdings.reduce((a: number, h: any) => a + h.distributed, 0);
  return {
    id: inv.id,
    name: inv.name,
    initials: inv.initials,
    contactFirst: inv.contactFirst,
    sharePct: inv.sharePct,
    position: { committed, called, distributed, netIrr: 0.214, netMoic: 1.42 },
    holdings,
    cashflows: inv.cashflows.map((c: any) => ({
      kind: c.kind,
      label: c.label,
      amount: P(c.amount) * sh,
      date: c.date,
    })),
    documents: J<Array<{ name: string; date: string; size: string }>>(inv.documents, []),
    openCapitalCall: {
      deal: 'Harbour Reach',
      label: 'Capital call — drawdown 4',
      amount: 900_000 * sh,
      due: '2026-07-24',
    },
  };
}

export const investorsRouter = router({
  /** Internal team: list + inspect any investor. */
  list: internalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.investor.findMany({ where: { orgId: ctx.principal.orgId } });
    return rows.map((i) => ({ id: i.id, name: i.name, initials: i.initials, sharePct: i.sharePct, contactFirst: i.contactFirst }));
  }),
  get: internalProcedure.input(z.string()).query(({ ctx, input }) => investorPosition(ctx.prisma, input, ctx.principal.orgId)),

  /** Investor portal: strictly the logged-in investor's own position. */
  myPosition: investorProcedure.query(({ ctx }) => {
    if (!ctx.principal.investorId) throw new TRPCError({ code: 'FORBIDDEN' });
    return investorPosition(ctx.prisma, ctx.principal.investorId, ctx.principal.orgId);
  }),
});

/** First visit bootstraps the buyer's payment schedule from the unit's state. */
async function ensurePayments(prisma: any, orgId: string, unit: { id: string; reservedAt: Date | null; agreedValue: bigint | null; progress: number }) {
  const existing = await prisma.payment.findMany({ where: { unitId: unit.id, orgId } });
  if (existing.length) return existing;
  const rows = [
    {
      orgId,
      unitId: unit.id,
      kind: 'Reservation fee',
      amount: 200_000n, // £2,000
      status: unit.reservedAt ? 'PAID' : 'PENDING',
      paidAt: unit.reservedAt,
    },
    {
      orgId,
      unitId: unit.id,
      kind: 'Exchange deposit (10%)',
      amount: unit.agreedValue != null ? BigInt(Math.round(Number(unit.agreedValue) * 0.1)) : 0n,
      status: unit.progress >= 5 ? 'PAID' : 'PENDING',
      paidAt: unit.progress >= 5 ? new Date() : null,
    },
  ];
  for (const r of rows) await prisma.payment.create({ data: r });
  return prisma.payment.findMany({ where: { unitId: unit.id, orgId } });
}

export const buyerRouter = router({
  /** Buyer sees only their own unit, its milestones, buyer-visible documents and payments. */
  myUnit: buyerProcedure.query(async ({ ctx }) => {
    if (!ctx.principal.buyerUnitId) throw new TRPCError({ code: 'FORBIDDEN' });
    const unit = await ctx.prisma.unit.findFirst({
      where: { id: ctx.principal.buyerUnitId, orgId: ctx.principal.orgId },
      include: {
        milestones: { orderBy: { index: 'asc' } },
        deal: { select: { name: true, address: true } },
      },
    });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
    const docs = await ctx.prisma.document.findMany({
      where: { dealId: unit.dealId, orgId: ctx.principal.orgId, buyerVisible: true },
    });
    const payments: Array<{ id: string; kind: string; amount: bigint; status: string; paidAt: Date | null }> =
      await ensurePayments(ctx.prisma, ctx.principal.orgId, unit);
    return {
      unit: {
        name: unit.name,
        spec: unit.spec,
        agreedValue: unit.agreedValue != null ? P(unit.agreedValue) : null,
        status: unit.status,
        progress: unit.progress,
        reservedAt: unit.reservedAt,
        incentive: unit.incentive,
        depositHeld: unit.depositHeld != null ? P(unit.depositHeld) : null,
      },
      development: { name: unit.deal.name, address: unit.deal.address },
      milestones: unit.milestones.map((m) => ({ name: m.name, index: m.index, done: m.done, date: m.date })),
      documentsToSign: docs.map((d) => ({ id: d.id, name: d.name, signed: d.signedAt != null, signedAt: d.signedAt })),
      payments: payments.map((p: any): { id: string; kind: string; amount: number; paid: boolean; date: Date | null } => ({
        id: p.id,
        kind: p.kind,
        amount: P(p.amount),
        paid: p.status === 'PAID',
        date: p.paidAt,
      })),
      stripeMode: process.env.STRIPE_SECRET_KEY ? 'live' : 'demo',
    };
  }),

  /**
   * Take a payment. With STRIPE_SECRET_KEY set this creates a real PaymentIntent
   * (card capture completes client-side with Stripe.js + the publishable key, and the
   * /webhooks/stripe callback marks it paid). Without keys it settles instantly in
   * demo mode — clearly labelled in the UI. Never fabricates a "live" result.
   */
  pay: buyerProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    if (!ctx.principal.buyerUnitId) throw new TRPCError({ code: 'FORBIDDEN' });
    const payment = await ctx.prisma.payment.findFirst({
      where: { id: input, orgId: ctx.principal.orgId, unitId: ctx.principal.buyerUnitId },
    });
    if (!payment) throw new TRPCError({ code: 'NOT_FOUND' });
    if (payment.status === 'PAID') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already paid' });
    const unit = await ctx.prisma.unit.findFirst({ where: { id: payment.unitId } });

    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      const body = new URLSearchParams({
        amount: String(payment.amount),
        currency: 'gbp',
        description: `${payment.kind} — ${unit?.name ?? 'unit'}`,
        'metadata[paymentId]': payment.id,
        'automatic_payment_methods[enabled]': 'true',
      });
      const res = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new TRPCError({ code: 'BAD_REQUEST', message: err?.error?.message ?? 'Stripe rejected the payment intent' });
      }
      const intent = (await res.json()) as { id: string; client_secret: string };
      await ctx.prisma.payment.update({ where: { id: payment.id }, data: { stripeIntentId: intent.id } });
      return { mode: 'live' as const, clientSecret: intent.client_secret };
    }

    // demo mode — settle instantly and audit it
    const paid = await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (unit) {
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: unit.dealId,
          actor: ctx.principal.name,
          action: 'paid (demo mode)',
          target: `${payment.kind} · ${unit.name}`,
        },
      });
    }
    return { mode: 'demo' as const, paidAt: paid.paidAt };
  }),

  /** Buyer signs a buyer-visible document on their own development (DocuSign in prod). */
  sign: buyerProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    if (!ctx.principal.buyerUnitId) throw new TRPCError({ code: 'FORBIDDEN' });
    const unit = await ctx.prisma.unit.findFirst({ where: { id: ctx.principal.buyerUnitId, orgId: ctx.principal.orgId } });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
    const doc = await ctx.prisma.document.findFirst({
      where: { id: input, dealId: unit.dealId, orgId: ctx.principal.orgId, buyerVisible: true },
    });
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });
    const signed = await ctx.prisma.document.update({ where: { id: doc.id }, data: { signedAt: new Date() } });
    await ctx.prisma.activityEvent.create({
      data: { orgId: ctx.principal.orgId, dealId: unit.dealId, actor: ctx.principal.name, action: 'signed', target: doc.name },
    });
    return { id: signed.id, signedAt: signed.signedAt };
  }),
});
