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
      documentsToSign: docs.map((d) => ({ id: d.id, name: d.name, signed: false })),
      payments: [
        { kind: 'Reservation fee', amount: 2_000, paid: true, date: unit.reservedAt },
        { kind: 'Exchange deposit (10%)', amount: unit.agreedValue != null ? P(unit.agreedValue) * 0.1 : 0, paid: unit.progress >= 5, date: null },
      ],
    };
  }),
});
