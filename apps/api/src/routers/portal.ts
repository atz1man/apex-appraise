import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { signFileUrl } from '../uploads.js';
import { J, P, moneyLabel, toPence } from '../mappers.js';
import { depositSchedule, dpi, weightedIrr } from '@apex/appraisal-engine';
import { randomBytes } from 'node:crypto';
import { adminProcedure, buyerProcedure, internalProcedure, investorProcedure, requiresFeature, router } from '../trpc.js';
import { hashPassword } from '../auth/password.js';
import { initialsOf } from '../names.js';
import { APP_URL, portalInviteEmail, sendMail } from '../email.js';
import { recordAudit } from '../audit.js';
import { assertOwned } from '../auth/owned.js';
import { demoFallbacksAllowed } from '../demo-mode.js';
import { intentFor, intentSucceeded, settlePayment } from '../payments.js';

/** Investor position scaled to their share — no unit-level buyer PII crosses this boundary. */
/**
 * @param viewerUserId whose session signs the file links — the LP's own on the
 *   portal, the internal user's when the register previews a position. The
 *   file route checks the token's user against the file's firm, so a link
 *   signed for one cannot be replayed by the other.
 */
/** the deals this investor holds in — the only deals whose documents they may read */
const holdings_dealIds = (inv: { holdings: Array<{ dealId: string }> }) => inv.holdings.map((h) => h.dealId);

/**
 * The documents shared with investors across the deals held, newest first.
 *
 * Scoped by the FIRM as well as by the deals: a holding row names a deal, and
 * the register refuses a deal of another firm, but a row is a row — the
 * document query does not trust it. The URL is signed for whoever is looking,
 * for the same reason the data room signs its own: a link opened in a new tab
 * sends no bearer header. Metadata-only rows (a document the firm listed but
 * holds no file for) come back with an empty URL, and the portal prints them
 * without a link rather than a link to nothing.
 */
async function sharedDocuments(prisma: any, orgId: string, dealIds: string[], viewerUserId: string) {
  if (dealIds.length === 0) return [];
  const docs: Array<{
    id: string; name: string; ext: string; sizeBytes: bigint; url: string; addedAt: Date; deal: { name: string };
  }> = await prisma.document.findMany({
    where: { orgId, dealId: { in: dealIds }, investorVisible: true },
    select: { id: true, name: true, ext: true, sizeBytes: true, url: true, addedAt: true, deal: { select: { name: true } } },
    orderBy: { addedAt: 'desc' },
  });
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    ext: d.ext,
    dealName: d.deal.name,
    sizeBytes: Number(d.sizeBytes),
    addedAt: d.addedAt,
    url: signFileUrl(d.url, viewerUserId),
  }));
}

async function investorPosition(prisma: any, investorId: string, orgId: string, viewerUserId: string) {
  const inv = await prisma.investor.findFirst({
    where: { id: investorId, orgId },
    include: {
      holdings: { include: { deal: { select: { name: true, address: true, stage: true, assetType: true } } } },
      cashflows: { orderBy: { date: 'desc' } },
    },
  });
  if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
  const sh = inv.sharePct / 100;
  /** an LP's share of a pooled figure, exact to the penny — £900,000 × 0.55 is
   *  495000.00000000006 in binary floating point, and that reaches exports */
  const share = (pounds: number) => Math.round(pounds * sh * 100) / 100;
  const holdings = inv.holdings.map((h: any) => ({
    dealName: h.deal.name,
    dealAddress: h.deal.address,
    stage: h.deal.stage,
    assetType: h.deal.assetType,
    committed: share(P(h.committed)),
    called: share(P(h.called)),
    distributed: share(P(h.distributed)),
    irr: h.irr,
  }));
  const committed = holdings.reduce((a: number, h: any) => a + h.committed, 0);
  const called = holdings.reduce((a: number, h: any) => a + h.called, 0);
  const distributed = holdings.reduce((a: number, h: any) => a + h.distributed, 0);
  /**
   * The two headline figures were CONSTANTS: `netIrr: 0.214, netMoic: 1.42`,
   * shown to every investor of every firm. Measured on the demo workspace, for
   * an LP whose real numbers are the two lines above: called £3,788,400,
   * distributed £2,640,000 — 0.70× back so far, reported as 1.42×.
   *
   * Each is now computed in the engine from that same data, and named for what
   * it is. A "net IRR" is after fees and carry over an LP's full dated cashflow
   * ledger; this product holds no such ledger per investor (the Cashflow rows
   * are a statement list, and on this fixture they account for £1.485m of the
   * £3.788m actually called). So it reports the capital-weighted IRR across the
   * deals that have one recorded, and says so.
   */
  const now = new Date();
  /**
   * An open capital call is a drawdown notice with a due date still ahead.
   *
   * This was hardcoded — "Harbour Reach · Capital call — drawdown 4 · £900,000
   * × your share · due 2026-07-24" — so every investor of every firm saw a
   * demand for money on a scheme they may hold nothing in. Measured on
   * 25 August 2026, that constant due date had passed: an LP was looking at an
   * OVERDUE demand for £495,000 that nobody had issued.
   *
   * A capital call is a legal demand for cash under the LPA. Where there is no
   * outstanding notice on the record, the portal shows nothing.
   */
  const openCall = inv.cashflows.find((c: any) => c.kind === 'call' && c.date > now);
  // Cashflow carries a dealId but no relation, so the name is fetched only when
  // there is a notice to name — no query on the ordinary case
  const openCallDeal = openCall?.dealId
    ? await prisma.deal.findFirst({ where: { id: openCall.dealId, orgId }, select: { name: true } })
    : null;

  return {
    id: inv.id,
    name: inv.name,
    initials: inv.initials,
    contactFirst: inv.contactFirst,
    sharePct: inv.sharePct,
    position: {
      committed,
      called,
      distributed,
      /** capital-weighted across the deals with an IRR recorded; null while none has */
      portfolioIrr: weightedIrr(holdings.map((h: any) => ({ committed: h.committed, irr: h.irr }))),
      /** distributions per pound drawn; null before anything is called */
      dpi: dpi(distributed, called),
    },
    holdings,
    cashflows: inv.cashflows.map((c: any) => ({
      kind: c.kind,
      label: c.label,
      amount: share(P(c.amount)),
      date: c.date,
    })),
    documents: await sharedDocuments(prisma, orgId, holdings_dealIds(inv), viewerUserId),
    openCapitalCall: openCall
      ? {
          deal: openCallDeal?.name ?? null,
          label: openCall.label,
          // calls are held negative from the LP's side; a demand is shown positive
          amount: share(Math.abs(P(openCall.amount))),
          due: openCall.date,
        }
      : null,
  };
}

/**
 * "Buyer + investor portals" is a Growth line on the pricing page.
 *
 * Gated at the PORTAL procedures — the external logins are the thing sold. The
 * firm's own investor register (investors.list / investors.get, internal
 * procedures) is not gated: that is the customer's data about their own funders,
 * and a downgrade must not put a paywall between a firm and its own records.
 *
 * A portal login is never deleted by a downgrade, so nobody has to be re-invited
 * when the plan comes back.
 */
const investorPortalProcedure = investorProcedure.use(requiresFeature('portals'));
const buyerPortalProcedure = buyerProcedure.use(requiresFeature('portals'));

/**
 * The investor register — the firm's own record of who has money in what.
 *
 * Everything below `myPosition` existed and worked: an LP's position page, the
 * cashflow list, the capital-call panel, the invitation that issues the login.
 * What did not exist was any way to put an investor on the record. Outside the
 * demo seed nothing created an Investor, a Holding or a Cashflow row, so on a
 * real workspace `portalAccess.candidates` returned no investors, the picker on
 * the Portal access panel was empty, and "Buyer + investor portals" — a Growth
 * line on the pricing page — could not be given to anyone. Measured on a fresh
 * tenant: `investors.list` is `[]`, and a walk of every resolver in the router
 * finds none that writes `prisma.investor.create`.
 *
 * Shapes follow the rest of the router. `create` / `update` rather than one
 * upsert, because an update is a PATCH — only the keys sent are written, so two
 * people editing different fields both land (the lost-update sweep's rule).
 * Deletes refuse once money has moved: a distribution or a drawdown on the
 * record is a statement the LP has been sent, and removing the investor would
 * remove the only thing it is attached to.
 */
const investorOut = (i: { id: string; name: string; initials: string; sharePct: number; contactFirst: string }) => ({
  id: i.id,
  name: i.name,
  initials: i.initials,
  sharePct: i.sharePct,
  contactFirst: i.contactFirst,
});

const holdingOut = (h: {
  id: string; investorId: string; dealId: string; sharePct: number; committed: bigint; called: bigint; distributed: bigint; irr: number | null;
}) => ({
  id: h.id,
  investorId: h.investorId,
  dealId: h.dealId,
  sharePct: h.sharePct,
  committed: P(h.committed),
  called: P(h.called),
  distributed: P(h.distributed),
  irr: h.irr,
});

const cashflowOut = (c: { id: string; investorId: string; dealId: string | null; kind: string; label: string; amount: bigint; date: Date }) => ({
  id: c.id,
  investorId: c.investorId,
  dealId: c.dealId,
  kind: c.kind as 'dist' | 'call',
  label: c.label,
  amount: P(c.amount),
  date: c.date,
});

const INVESTOR_LABELS: Record<string, string> = { name: 'name', contactFirst: 'contact', sharePct: 'share' };
const HOLDING_LABELS: Record<string, string> = {
  sharePct: 'share', committed: 'committed', called: 'called', distributed: 'distributed', irr: 'recorded IRR',
};

/** money on a holding means a statement has gone out; the row is then a record, not a draft */
const moneyMoved = (h: { called: bigint; distributed: bigint }) => h.called > 0n || h.distributed > 0n;

export const investorsRouter = router({
  /**
   * Internal team: the register, with each investor's position in one line.
   * Figures are scaled to the investor's share, as the portal scales them, so
   * the firm reads the same number the LP reads.
   */
  list: internalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.investor.findMany({
      where: { orgId: ctx.principal.orgId },
      include: { holdings: true, _count: { select: { cashflows: true } } },
      orderBy: { name: 'asc' },
    });
    const logins = await ctx.prisma.user.groupBy({
      by: ['investorId'],
      where: { orgId: ctx.principal.orgId, principalType: 'investor', investorId: { not: null } },
      _count: { _all: true },
    });
    const loginCount = new Map(logins.map((l) => [l.investorId, l._count._all]));
    return rows.map((i) => {
      const sh = i.sharePct / 100;
      const share = (pence: bigint) => Math.round(P(pence) * sh * 100) / 100;
      return {
        ...investorOut(i),
        holdings: i.holdings.length,
        cashflows: i._count.cashflows,
        committed: i.holdings.reduce((a, h) => a + share(h.committed), 0),
        called: i.holdings.reduce((a, h) => a + share(h.called), 0),
        distributed: i.holdings.reduce((a, h) => a + share(h.distributed), 0),
        logins: loginCount.get(i.id) ?? 0,
      };
    });
  }),
  get: internalProcedure.input(z.string()).query(({ ctx, input }) => investorPosition(ctx.prisma, input, ctx.principal.orgId, ctx.principal.userId)),

  /** The investor's own rows, unscaled and with ids, for the register's editors. */
  record: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const inv = await ctx.prisma.investor.findFirst({
      where: { id: input, orgId: ctx.principal.orgId },
      include: {
        holdings: { include: { deal: { select: { name: true } } }, orderBy: { dealId: 'asc' } },
        cashflows: { orderBy: { date: 'desc' } },
      },
    });
    if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
    return {
      ...investorOut(inv),
      holdings: inv.holdings.map((h) => ({ ...holdingOut(h), dealName: h.deal.name, moneyMoved: moneyMoved(h) })),
      cashflows: inv.cashflows.map(cashflowOut),
    };
  }),

  create: internalProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(120),
        contactFirst: z.string().trim().max(60).default(''),
        /** of the LP base — every pooled figure is scaled by this before the LP sees it */
        sharePct: z.number().min(0).max(100).default(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.investor.create({
        data: {
          orgId: ctx.principal.orgId,
          name: input.name,
          initials: initialsOf(input.name),
          contactFirst: input.contactFirst,
          sharePct: input.sharePct,
        },
      });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'added an investor', target: `${row.name} · ${row.sharePct}% of the LP base`, ip: ctx.ip,
      });
      return investorOut(row);
    }),

  update: internalProcedure
    .input(
      z.object({
        id: z.string(),
        patch: z.object({
          name: z.string().trim().min(2).max(120).optional(),
          contactFirst: z.string().trim().max(60).optional(),
          sharePct: z.number().min(0).max(100).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await assertOwned(ctx.prisma.investor, input.id, ctx.principal.orgId);
      const data: Record<string, unknown> = { ...input.patch };
      // the initials follow the name; they are derived, never held
      if (input.patch.name !== undefined) data.initials = initialsOf(input.patch.name);
      const row = await ctx.prisma.investor.update({ where: { id: existing.id }, data });
      const changed = Object.entries(INVESTOR_LABELS)
        .filter(([k]) => String((existing as Record<string, unknown>)[k] ?? '') !== String((row as Record<string, unknown>)[k] ?? ''))
        .map(([, label]) => label);
      if (changed.length) {
        await recordAudit(ctx.prisma, {
          orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
          action: `updated investor — ${changed.join(', ')}`, target: `${row.name} · ${row.sharePct}%`, ip: ctx.ip,
        });
      }
      return investorOut(row);
    }),

  /**
   * Refused once anything has been called or distributed, or a statement line
   * exists. Portal logins pointing at the investor go with it — a login whose
   * every page answers NOT_FOUND is worse than none — and the count is returned
   * so the screen can say so, as `sales.deleteUnit` does for a buyer.
   */
  delete: internalProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const inv = await ctx.prisma.investor.findFirst({
      where: { id: input.id, orgId: ctx.principal.orgId },
      include: { holdings: true, _count: { select: { cashflows: true } } },
    });
    if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
    if (inv.holdings.some(moneyMoved) || inv._count.cashflows > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `“${inv.name}” cannot be removed — money has been called or distributed on their account. Remove the cashflow lines and clear the holdings first if this record really is wrong.`,
      });
    }
    await ctx.prisma.holding.deleteMany({ where: { investorId: inv.id } });
    const { count: portalLogins } = await ctx.prisma.user.deleteMany({
      where: { investorId: inv.id, orgId: ctx.principal.orgId, principalType: 'investor' },
    });
    await ctx.prisma.investor.delete({ where: { id: inv.id } });
    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: 'removed an investor',
      target: `${inv.name}${portalLogins ? ` · ${portalLogins} portal login${portalLogins === 1 ? '' : 's'} revoked` : ''}`,
      ip: ctx.ip,
    });
    return { ok: true, portalLogins };
  }),

  /**
   * An investor's position in one deal. One row per (investor, deal) — the
   * schema holds that unique, because `investorPosition` sums holdings and a
   * second row for the same deal would double the committed figure.
   *
   * A PATCH on an existing row: every figure is optional and only what is sent
   * is written, so recording the deal's IRR when it closes does not re-send a
   * committed figure the caller was merely holding. On a new row `committed` is
   * required, and the share defaults to the investor's own.
   *
   * `irr` is the deal's REALISED return as the firm records it from the closing
   * account — typed, not derived. Null clears it; undefined leaves it alone.
   */
  setHolding: internalProcedure
    .input(
      z.object({
        investorId: z.string(),
        dealId: z.string(),
        sharePct: z.number().min(0).max(100).optional(),
        committed: z.number().min(0).optional(), // £, 100% LP basis
        called: z.number().min(0).optional(),
        distributed: z.number().min(0).optional(),
        irr: z.number().min(-1).max(10).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // the investor and the deal are two independent inputs; each is checked
      const investor = await assertOwned(ctx.prisma.investor, input.investorId, ctx.principal.orgId);
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });

      const existing = await ctx.prisma.holding.findUnique({
        where: { investorId_dealId: { investorId: investor.id, dealId: deal.id } },
      });
      const patch: Record<string, unknown> = {};
      if (input.sharePct !== undefined) patch.sharePct = input.sharePct;
      if (input.committed !== undefined) patch.committed = toPence(input.committed);
      if (input.called !== undefined) patch.called = toPence(input.called);
      if (input.distributed !== undefined) patch.distributed = toPence(input.distributed);
      if (input.irr !== undefined) patch.irr = input.irr;

      let row: Parameters<typeof holdingOut>[0];
      if (existing) {
        row = await ctx.prisma.holding.update({ where: { id: existing.id }, data: patch });
        const changed = Object.entries(HOLDING_LABELS)
          .filter(([k]) => String((existing as Record<string, unknown>)[k] ?? '') !== String((row as Record<string, unknown>)[k] ?? ''))
          .map(([, label]) => label);
        if (changed.length) {
          await recordAudit(ctx.prisma, {
            orgId: ctx.principal.orgId, dealId: deal.id, userId: ctx.principal.userId, actor: ctx.principal.name,
            action: `updated holding — ${changed.join(', ')}`,
            target: `${investor.name} in ${deal.name} · committed ${moneyLabel(row.committed)}`, ip: ctx.ip,
          });
        }
      } else {
        if (input.committed === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'A new holding needs a committed amount.' });
        }
        row = await ctx.prisma.holding.create({
          data: {
            investorId: investor.id,
            dealId: deal.id,
            sharePct: input.sharePct ?? investor.sharePct,
            committed: toPence(input.committed),
            called: toPence(input.called ?? 0),
            distributed: toPence(input.distributed ?? 0),
            irr: input.irr ?? null,
          },
        });
        await recordAudit(ctx.prisma, {
          orgId: ctx.principal.orgId, dealId: deal.id, userId: ctx.principal.userId, actor: ctx.principal.name,
          action: 'added a holding', target: `${investor.name} in ${deal.name} · committed ${moneyLabel(row.committed)}`, ip: ctx.ip,
        });
      }
      return holdingOut(row);
    }),

  removeHolding: internalProcedure
    .input(z.object({ investorId: z.string(), dealId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const investor = await assertOwned(ctx.prisma.investor, input.investorId, ctx.principal.orgId);
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const row = await ctx.prisma.holding.findUnique({ where: { investorId_dealId: { investorId: investor.id, dealId: deal.id } } });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const lines = await ctx.prisma.cashflow.count({ where: { investorId: investor.id, dealId: deal.id } });
      if (moneyMoved(row) || lines > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${investor.name}'s holding in ${deal.name} cannot be removed — money has been called or distributed on it.`,
        });
      }
      await ctx.prisma.holding.delete({ where: { id: row.id } });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, dealId: deal.id, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'removed a holding', target: `${investor.name} in ${deal.name}`, ip: ctx.ip,
      });
      return { ok: true };
    }),

  /**
   * A statement line: a distribution paid, or a capital call issued.
   *
   * Held on the 100% basis with the LP's side of the sign — a call is negative,
   * as the seed and `investorPosition` already read it — so the caller types a
   * positive amount and says which it is. A call whose date is still ahead is
   * an OPEN notice and the portal shows it as a demand; that is a legal demand
   * for cash under the LPA, which is why this records who issued it.
   *
   * Recording a line does not move the holding's `called` / `distributed`
   * figures. Those are the drawn-to-date totals the firm maintains, and the
   * statement list has never been a full ledger they reconcile to (lp.ts says
   * so, and on the demo fixture the lines account for £1.485m of £3.788m
   * called). Deriving one from the other is a ledger this product does not
   * yet keep, and quietly summing lines into the total would present a
   * partial list as a complete one.
   */
  recordCashflow: internalProcedure
    .input(
      z.object({
        investorId: z.string(),
        dealId: z.string().nullable(),
        kind: z.enum(['dist', 'call']),
        label: z.string().trim().min(1).max(120),
        amount: z.number().positive(), // £, 100% basis, sign applied from kind
        date: z.coerce.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const investor = await assertOwned(ctx.prisma.investor, input.investorId, ctx.principal.orgId);
      const deal = input.dealId
        ? await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } })
        : null;
      if (input.dealId && !deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const pence = toPence(input.amount);
      const row = await ctx.prisma.cashflow.create({
        data: {
          investorId: investor.id,
          dealId: deal?.id ?? null,
          kind: input.kind,
          label: input.label,
          amount: input.kind === 'call' ? -pence : pence,
          date: input.date,
        },
      });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, dealId: deal?.id, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: input.kind === 'call' ? 'issued a capital call' : 'recorded a distribution',
        target: `${investor.name}${deal ? ` · ${deal.name}` : ''} · ${input.label} · ${moneyLabel(pence)} · ${input.date.toISOString().slice(0, 10)}`,
        ip: ctx.ip,
      });
      return cashflowOut(row);
    }),

  deleteCashflow: internalProcedure.input(z.object({ cashflowId: z.string() })).mutation(async ({ ctx, input }) => {
    // Cashflow carries no orgId of its own; it belongs to whoever its investor belongs to
    const row = await ctx.prisma.cashflow.findFirst({
      where: { id: input.cashflowId, investor: { orgId: ctx.principal.orgId } },
      include: { investor: { select: { name: true } } },
    });
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    await ctx.prisma.cashflow.delete({ where: { id: row.id } });
    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId, dealId: row.dealId ?? undefined, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: row.kind === 'call' ? 'withdrew a capital call' : 'deleted a distribution line',
      target: `${row.investor.name} · ${row.label} · ${moneyLabel(row.amount < 0n ? -row.amount : row.amount)}`,
      ip: ctx.ip,
    });
    return { ok: true };
  }),

  /** Investor portal: strictly the logged-in investor's own position. */
  myPosition: investorPortalProcedure.query(({ ctx }) => {
    if (!ctx.principal.investorId) throw new TRPCError({ code: 'FORBIDDEN' });
    return investorPosition(ctx.prisma, ctx.principal.investorId, ctx.principal.orgId, ctx.principal.userId);
  }),

  /**
   * Who to contact at the managing firm.
   *
   * The portal used to print "Arthur O. · Brookfield Developments" with a mailto
   * to a demo address, to every investor of every firm. An LP writing to that
   * address reaches nobody, and the firm never learns they tried.
   */
  myContact: investorPortalProcedure.query(async ({ ctx }) => {
    const [org, admin] = await Promise.all([
      ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId }, select: { name: true } }),
      ctx.prisma.user.findFirst({
        where: { orgId: ctx.principal.orgId, principalType: 'internal', role: 'ADMIN' },
        select: { name: true, email: true, initials: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    // no administrator on the account is a real state, and better said than faked
    if (!admin) return { firm: org?.name ?? '', manager: null };
    return { firm: org?.name ?? '', manager: { name: admin.name, email: admin.email, initials: admin.initials } };
  }),
});

/**
 * The buyer's payment schedule, kept in step with the plot.
 *
 * Three things were wrong here and each was visible on the buyer's own screen.
 *
 * The amounts came from a formula written only in this file — a £2,000
 * reservation fee where the firm's side used £5,000, and ten per cent of the
 * agreed value or **£0** where there was none, printed beside a Pay button. It
 * now comes from the one schedule in the engine, so the developer's "Deposit
 * held" and the buyer's receipts are the same money.
 *
 * The rows were written once, on the buyer's first visit, and never touched
 * again — so a price renegotiated after that first login left the deposit at
 * the old figure for good. An unpaid row now follows the plot.
 *
 * And a row was marked PAID with `paidAt: new Date()`, so a GET wrote a receipt
 * date. Measured: a plot reserved on 12 January 2026 and long since completed
 * carried an exchange deposit "received" at 17:50 on the day the portal was
 * first opened. The date now comes from the milestone that recorded the event,
 * and where there is no such record the row carries no date rather than a
 * plausible one.
 */
async function ensurePayments(
  prisma: any,
  orgId: string,
  unit: {
    id: string;
    reservedAt: Date | null;
    agreedValue: bigint | null;
    appraisedValue: bigint;
    progress: number;
    milestones?: Array<{ index: number; date: Date | null }>;
  },
) {
  const schedule = depositSchedule({
    agreedValue: unit.agreedValue != null ? P(unit.agreedValue) : null,
    appraisedValue: P(unit.appraisedValue),
  });
  /** when the plot actually reached a milestone, or null — never "now" */
  const reachedAt = (index: number) =>
    unit.milestones?.find((m) => m.index === index)?.date ?? (index <= 1 ? unit.reservedAt : null);

  const existing: Array<{ id: string; kind: string; amount: bigint; status: string; paidAt: Date | null }> =
    await prisma.payment.findMany({ where: { unitId: unit.id, orgId } });

  for (const row of schedule) {
    const due = unit.progress >= row.dueAtProgress;
    const found = existing.find((p) => p.kind === row.kind);
    if (!found) {
      await prisma.payment.create({
        data: {
          orgId,
          unitId: unit.id,
          kind: row.kind,
          amount: toPence(row.amount),
          status: due ? 'PAID' : 'PENDING',
          paidAt: due ? reachedAt(row.dueAtProgress) : null,
        },
      });
      continue;
    }
    // a settled payment is a receipt: the amount and the date are what happened,
    // and nothing derived from the plot's current state may rewrite them
    if (found.status === 'PAID') continue;
    /**
     * The plot has passed the milestone this row falls due at — a plot cannot
     * exchange without its deposit — so the row is settled, dated from the
     * milestone that recorded it. Without this the firm's figure said £41,200
     * held while the buyer's own schedule still showed the exchange deposit
     * outstanding: the same disagreement, in the other direction.
     */
    if (due) {
      await prisma.payment.update({
        where: { id: found.id },
        data: { amount: toPence(row.amount), status: 'PAID', paidAt: reachedAt(row.dueAtProgress) },
      });
      continue;
    }
    if (P(found.amount) !== row.amount) {
      await prisma.payment.update({ where: { id: found.id }, data: { amount: toPence(row.amount) } });
    }
  }
  return prisma.payment.findMany({ where: { unitId: unit.id, orgId }, orderBy: { createdAt: 'asc' } });
}

export const buyerRouter = router({
  /** Buyer sees only their own unit, its milestones, buyer-visible documents and payments. */
  myUnit: buyerPortalProcedure.query(async ({ ctx }) => {
    if (!ctx.principal.buyerUnitId) throw new TRPCError({ code: 'FORBIDDEN' });
    const unit = await ctx.prisma.unit.findFirst({
      where: { id: ctx.principal.buyerUnitId, orgId: ctx.principal.orgId },
      include: {
        milestones: { orderBy: { index: 'asc' } },
        deal: { select: { name: true, address: true } },
      },
    });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
    /**
     * THIS buyer's documents, not the development's.
     *
     * This was `dealId`, so every buyer-visible document on the scheme appeared
     * in every buyer's portal. On the demo workspace those are "Reservation pack
     * — Plot 1.pdf" and "Contract of sale — Plot 1 (engrossment).pdf", on a deal
     * with ten plots: plot 2's buyer would have read another private
     * individual's contract of sale. Latent only because nothing in the product
     * could set `buyerVisible` at all until `documents.shareWithBuyer` — which
     * is why that procedure takes a unit rather than a flag.
     */
    const docs = await ctx.prisma.document.findMany({
      where: { unitId: unit.id, orgId: ctx.principal.orgId, buyerVisible: true },
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
      /**
       * With the file behind it. The panel offered "Review & sign" on a document
       * the buyer had no way to open — a signature on an unread contract is the
       * one thing an e-sign flow exists to prevent. Signed for this buyer, like
       * the data room's own links; empty where the firm holds no file.
       */
      documentsToSign: docs.map((d) => ({
        id: d.id,
        name: d.name,
        signed: d.signedAt != null,
        signedAt: d.signedAt,
        url: signFileUrl(d.url, ctx.principal.userId),
      })),
      payments: payments.map((p: any): { id: string; kind: string; amount: number; paid: boolean; date: Date | null } => ({
        id: p.id,
        kind: p.kind,
        amount: P(p.amount),
        paid: p.status === 'PAID',
        date: p.paidAt,
      })),
      // three states, not two: live, demo settlement, and configured-for-neither
      stripeMode: process.env.STRIPE_SECRET_KEY ? 'live' : demoFallbacksAllowed() ? 'demo' : 'unavailable',
    };
  }),

  /**
   * Take a payment. With STRIPE_SECRET_KEY set this creates a real PaymentIntent
   * (card capture completes client-side with Stripe.js + the publishable key, and the
   * /webhooks/stripe callback marks it paid). Without keys it settles instantly in
   * demo mode — clearly labelled in the UI. Never fabricates a "live" result.
   */
  pay: buyerPortalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    if (!ctx.principal.buyerUnitId) throw new TRPCError({ code: 'FORBIDDEN' });
    const payment = await ctx.prisma.payment.findFirst({
      where: { id: input, orgId: ctx.principal.orgId, unitId: ctx.principal.buyerUnitId },
    });
    if (!payment) throw new TRPCError({ code: 'NOT_FOUND' });
    if (payment.status === 'PAID') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already paid' });
    const unit = await ctx.prisma.unit.findFirst({ where: { id: payment.unitId } });

    if (process.env.STRIPE_SECRET_KEY) {
      // the intent logic, and the reasons for it, live in src/payments.ts behind
      // a transport seam so they can be exercised rather than only reviewed
      const { clientSecret } = await intentFor(ctx.prisma, payment, `${payment.kind} — ${unit?.name ?? 'unit'}`);
      return { mode: 'live' as const, clientSecret };
    }

    if (!demoFallbacksAllowed()) {
      // A buyer reads this, so it says what to do rather than what is missing.
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Card payments are not available on this development yet. Please contact the developer to arrange your payment.',
      });
    }

    // demo mode — settle instantly and audit it, once
    /**
     * `settled: false` means another call got there first — a double-click, or
     * the webhook. Both are reported as success, and deliberately: the buyer's
     * payment DID complete, and an error on the screen where it just succeeded
     * is a support call. What must not happen twice is the receipt, and that is
     * settlePayment's job rather than this caller's.
     *
     * The check at the top of this procedure is a different question — a buyer
     * opening a payment that was settled some time ago is told so instead of
     * being shown a pay button that quietly does nothing.
     */
    await settlePayment(ctx.prisma, payment.id, { actor: ctx.principal.name, action: 'paid (demo mode)' });
    const paid = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { mode: 'demo' as const, paidAt: paid.paidAt };
  }),

  /**
   * After the card is confirmed client-side, verify the PaymentIntent with
   * Stripe server-side and settle the ledger — works without webhooks (the
   * webhook route stays as belt-and-braces for production).
   */
  confirmPayment: buyerPortalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    if (!ctx.principal.buyerUnitId) throw new TRPCError({ code: 'FORBIDDEN' });
    const payment = await ctx.prisma.payment.findFirst({
      where: { id: input, orgId: ctx.principal.orgId, unitId: ctx.principal.buyerUnitId },
    });
    if (!payment?.stripeIntentId) throw new TRPCError({ code: 'NOT_FOUND' });
    if (payment.status === 'PAID') return { paid: true };
    const { succeeded, status } = await intentSucceeded(payment.stripeIntentId);
    if (!succeeded) return { paid: false, stripeStatus: status };
    /**
     * The webhook may be settling this same intent right now — that is what
     * "belt-and-braces" above means. Whichever arrives second writes nothing.
     */
    await settlePayment(ctx.prisma, payment.id, { actor: 'Stripe', action: 'card payment received' });
    return { paid: true };
  }),

  /** Buyer signs a buyer-visible document on their own development (DocuSign in prod). */
  sign: buyerPortalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    if (!ctx.principal.buyerUnitId) throw new TRPCError({ code: 'FORBIDDEN' });
    const unit = await ctx.prisma.unit.findFirst({ where: { id: ctx.principal.buyerUnitId, orgId: ctx.principal.orgId } });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
    /**
     * Scoped the same way as the list, and separately rather than by trusting
     * it: `signedAt` is ONE column, so a buyer signing a document shared with
     * the whole development would have marked it signed in every other buyer's
     * portal too — a signature attributed to people who never gave one.
     */
    const doc = await ctx.prisma.document.findFirst({
      where: { id: input, unitId: unit.id, orgId: ctx.principal.orgId, buyerVisible: true },
    });
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });
    const signed = await ctx.prisma.document.update({ where: { id: doc.id }, data: { signedAt: new Date() } });
    await ctx.prisma.activityEvent.create({
      data: { orgId: ctx.principal.orgId, dealId: unit.dealId, actor: ctx.principal.name, action: 'signed', target: doc.name },
    });
    return { id: signed.id, signedAt: signed.signedAt };
  }),
});

/* ---------------------------- portal access ----------------------------- */

/**
 * Who from outside the firm can sign in, and to see what.
 *
 * The portals themselves have worked for a long time — an LP's position, a
 * buyer's reservation and conveyancing, deposits, signing. Nothing could create
 * a login for either. Outside the demo seed the only ways a User row came into
 * existence were org.register and org.invite, both of which write
 * principalType: 'internal'. So "Buyer + investor portals" sat on the Growth
 * column of the pricing page and a firm that paid for it had no way to let a
 * single buyer or investor in.
 *
 * Creating a login is gated on the plan. Listing and REVOKING are not, for the
 * same reason revoking an API key is not: a workspace that downgrades still has
 * outsiders holding credentials to its deal figures, and the one thing it must
 * always be able to do is take them back.
 */
const portalInviteProcedure = adminProcedure.use(requiresFeature('portals'));

/** A temporary password, shown once to the admin and mailed to the recipient. */
const tempPassword = () => randomBytes(6).toString('base64url');

async function refuseIfTaken(prisma: any, email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists' });
}

export const portalAccessRouter = router({
  /**
   * Every outside login this workspace has issued.
   *
   * internalProcedure, not admin: an analyst looking at a deal has a legitimate
   * reason to know whether the buyer can see it. Issuing and revoking are the
   * admin-only parts.
   */
  list: internalProcedure.query(async ({ ctx }) => {
    const users = await ctx.prisma.user.findMany({
      where: { orgId: ctx.principal.orgId, principalType: { in: ['investor', 'buyer'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, initials: true, principalType: true, investorId: true, buyerUnitId: true, createdAt: true },
    });
    // resolve what each one is attached to, so the screen can say "Plot 14"
    // rather than a cuid nobody can act on
    const [investors, units] = await Promise.all([
      ctx.prisma.investor.findMany({ where: { orgId: ctx.principal.orgId }, select: { id: true, name: true } }),
      ctx.prisma.unit.findMany({ where: { orgId: ctx.principal.orgId }, select: { id: true, name: true, deal: { select: { name: true } } } }),
    ]);
    const investorName = new Map(investors.map((i) => [i.id, i.name]));
    const unitName = new Map(units.map((u) => [u.id, `${u.name} · ${u.deal.name}`]));
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      kind: u.principalType as 'investor' | 'buyer',
      /** null when the row it pointed at is gone — said, not hidden */
      sees:
        u.principalType === 'investor'
          ? (u.investorId ? investorName.get(u.investorId) ?? null : null)
          : (u.buyerUnitId ? unitName.get(u.buyerUnitId) ?? null : null),
      createdAt: u.createdAt,
    }));
  }),

  /** Who a login could be issued against, for the pickers. */
  candidates: internalProcedure.query(async ({ ctx }) => {
    const [investors, units] = await Promise.all([
      ctx.prisma.investor.findMany({
        where: { orgId: ctx.principal.orgId },
        select: { id: true, name: true, contactFirst: true },
        orderBy: { name: 'asc' },
      }),
      ctx.prisma.unit.findMany({
        where: { orgId: ctx.principal.orgId },
        select: { id: true, name: true, buyerName: true, status: true, deal: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      investors,
      // a buyer portal is about a reservation, so an unsold unit has nobody to
      // invite; offering them all would just make the list long and wrong
      units: units
        .filter((u) => u.status !== 'AVAILABLE')
        .map((u) => ({ id: u.id, label: `${u.name} · ${u.deal.name}`, buyerName: u.buyerName, status: u.status })),
    };
  }),

  inviteInvestor: portalInviteProcedure
    .input(z.object({ investorId: z.string(), name: z.string().min(2).max(80), email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const investor = await ctx.prisma.investor.findFirst({
        where: { id: input.investorId, orgId: ctx.principal.orgId },
      });
      if (!investor) throw new TRPCError({ code: 'NOT_FOUND' });
      const email = input.email.toLowerCase();
      await refuseIfTaken(ctx.prisma, email);

      /**
       * No seat check. assertCanAddMember counts principalType 'internal' only,
       * and charging a firm a team seat for its own investor's read-only login
       * would be indefensible — the comment in entitlements.ts says so, and this
       * is the procedure that has to honour it.
       */
      const password = tempPassword();
      await ctx.prisma.user.create({
        data: {
          orgId: ctx.principal.orgId,
          email,
          password: hashPassword(password),
          name: input.name,
          role: 'VIEWER',
          principalType: 'investor',
          investorId: investor.id,
          initials: initialsOf(input.name),
        },
      });

      const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
      const mail = portalInviteEmail(input.name, org?.name ?? 'A firm', email, password, APP_URL(), `your position in ${investor.name}`);
      const { emailed } = await sendMail(ctx.principal.orgId, email, mail.subject, mail.text);
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'gave an investor portal access', target: `${input.name} <${email}> · ${investor.name}`, ip: ctx.ip,
      });
      return { tempPassword: password, emailed };
    }),

  inviteBuyer: portalInviteProcedure
    .input(z.object({ unitId: z.string(), name: z.string().min(2).max(80), email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const unit = await ctx.prisma.unit.findFirst({
        where: { id: input.unitId, orgId: ctx.principal.orgId },
        include: { deal: { select: { name: true } } },
      });
      if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
      const email = input.email.toLowerCase();
      await refuseIfTaken(ctx.prisma, email);

      const password = tempPassword();
      await ctx.prisma.user.create({
        data: {
          orgId: ctx.principal.orgId,
          email,
          password: hashPassword(password),
          name: input.name,
          role: 'VIEWER',
          principalType: 'buyer',
          buyerUnitId: unit.id,
          initials: initialsOf(input.name),
        },
      });

      const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
      const what = `your reservation at ${unit.name}, ${unit.deal.name}`;
      const mail = portalInviteEmail(input.name, org?.name ?? 'A firm', email, password, APP_URL(), what);
      const { emailed } = await sendMail(ctx.principal.orgId, email, mail.subject, mail.text);
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'gave a buyer portal access', target: `${input.name} <${email}> · ${unit.name}`, ip: ctx.ip,
      });
      return { tempPassword: password, emailed };
    }),

  /**
   * Take access away. NOT gated on the plan — see the note above.
   *
   * A hard delete, like removeMember: the login is the only thing being removed,
   * and the investor, the unit, the payments and the audit trail all belong to
   * the workspace rather than to the person who could read them. Scoped to
   * portal types so this can never be turned on a colleague.
   */
  revoke: adminProcedure.input(z.object({ userId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = await ctx.prisma.user.findFirst({
      where: { id: input.userId, orgId: ctx.principal.orgId, principalType: { in: ['investor', 'buyer'] } },
    });
    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
    await ctx.prisma.user.delete({ where: { id: user.id } });
    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: 'revoked portal access', target: `${user.name} <${user.email}>`, ip: ctx.ip,
    });
    return { ok: true };
  }),
});
