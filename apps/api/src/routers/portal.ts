import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { J, P, toPence } from '../mappers.js';
import { depositSchedule } from '@apex/appraisal-engine';
import { randomBytes } from 'node:crypto';
import { adminProcedure, buyerProcedure, internalProcedure, investorProcedure, requiresFeature, router } from '../trpc.js';
import { hashPassword } from '../auth/password.js';
import { initialsOf } from '../names.js';
import { APP_URL, portalInviteEmail, sendMail } from '../email.js';
import { recordAudit } from '../audit.js';
import { demoFallbacksAllowed } from '../demo-mode.js';
import { intentFor, intentSucceeded, settlePayment } from '../payments.js';

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

export const investorsRouter = router({
  /** Internal team: list + inspect any investor. */
  list: internalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.investor.findMany({ where: { orgId: ctx.principal.orgId } });
    return rows.map((i) => ({ id: i.id, name: i.name, initials: i.initials, sharePct: i.sharePct, contactFirst: i.contactFirst }));
  }),
  get: internalProcedure.input(z.string()).query(({ ctx, input }) => investorPosition(ctx.prisma, input, ctx.principal.orgId)),

  /** Investor portal: strictly the logged-in investor's own position. */
  myPosition: investorPortalProcedure.query(({ ctx }) => {
    if (!ctx.principal.investorId) throw new TRPCError({ code: 'FORBIDDEN' });
    return investorPosition(ctx.prisma, ctx.principal.investorId, ctx.principal.orgId);
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
