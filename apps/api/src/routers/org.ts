import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { computeAppraisal, jvWaterfall, type AppraisalInput } from '@apex/appraisal-engine';
import { JWT_SECRET } from '../context.js';
import { checkLockout, hashPassword, recordFailure } from '../auth/password.js';
import { APP_URL, inviteEmail, sendMail, welcomeEmail } from '../email.js';
import { internalProcedure, publicProcedure, router } from '../trpc.js';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('') || 'AA';

/** Admin-only guard on top of internal. */
const adminProcedure = internalProcedure.use(({ ctx, next }) => {
  if (ctx.principal.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  return next({ ctx });
});

const DEFAULT_INTEGRATIONS = [
  'HM Land Registry',
  'EPC Register',
  'Companies House',
  'PriceHubble AVM',
  'Planning Portal',
  'Ordnance Survey',
  'Environment Agency',
  'BCIS',
  'Xero',
  'DocuSign',
];

export const orgRouter = router({
  /** Self-serve tenant onboarding: new organisation + its first (admin) user. */
  register: publicProcedure
    .input(
      z.object({
        orgName: z.string().min(2).max(80),
        name: z.string().min(2).max(80),
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      // reuse the login throttle so registration can't be hammered either
      const lock = checkLockout(`register:${email}`);
      if (lock.locked) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts — try again later' });
      const existing = await ctx.prisma.user.findUnique({ where: { email } });
      if (existing) {
        recordFailure(`register:${email}`);
        throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists' });
      }
      const org = await ctx.prisma.organisation.create({ data: { name: input.orgName } });
      const user = await ctx.prisma.user.create({
        data: {
          orgId: org.id,
          email,
          password: hashPassword(input.password),
          name: input.name,
          role: 'ADMIN',
          principalType: 'internal',
          initials: initialsOf(input.name),
        },
      });
      // every workspace starts with the connector catalogue available
      for (const provider of DEFAULT_INTEGRATIONS) {
        await ctx.prisma.integrationConnection.create({ data: { orgId: org.id, provider, status: 'NOT_CONNECTED' } });
      }
      const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' });
      const welcome = welcomeEmail(user.name, org.name, APP_URL());
      void sendMail(email, welcome.subject, welcome.text);
      return {
        token,
        principal: {
          userId: user.id,
          name: user.name,
          initials: user.initials,
          role: user.role,
          principalType: user.principalType,
        },
      };
    }),

  get: internalProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
    if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
    const [deals, users, investors] = await Promise.all([
      ctx.prisma.deal.count({ where: { orgId: org.id } }),
      ctx.prisma.user.count({ where: { orgId: org.id, principalType: 'internal' } }),
      ctx.prisma.investor.count({ where: { orgId: org.id } }),
    ]);
    return { id: org.id, name: org.name, createdAt: org.createdAt, counts: { deals, users, investors } };
  }),

  /** Activation checklist — real completion state for the Hub's getting-started card. */
  onboarding: internalProcedure.query(async ({ ctx }) => {
    const orgId = ctx.principal.orgId;
    const [deals, appraisals, documents, comparables, members] = await Promise.all([
      ctx.prisma.deal.count({ where: { orgId } }),
      ctx.prisma.appraisal.count({ where: { orgId } }),
      ctx.prisma.document.count({ where: { orgId } }),
      ctx.prisma.comparable.count({ where: { orgId } }),
      ctx.prisma.user.count({ where: { orgId, principalType: 'internal' } }),
    ]);
    return {
      hasDeal: deals > 0,
      hasAppraisal: appraisals > 0,
      hasDocument: documents > 0,
      hasComparable: comparables > 0,
      hasTeammate: members > 1,
    };
  }),

  update: adminProcedure
    .input(z.object({ name: z.string().min(2).max(80) }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.organisation.update({ where: { id: ctx.principal.orgId }, data: { name: input.name } }),
    ),

  members: internalProcedure.query(({ ctx }) =>
    ctx.prisma.user.findMany({
      where: { orgId: ctx.principal.orgId, principalType: 'internal' },
      select: { id: true, name: true, email: true, initials: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ),

  /**
   * Invite a teammate: creates the account with a one-time temporary password,
   * returned exactly once for the admin to hand over. (Email delivery slots in here
   * in production.)
   */
  invite: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(80),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'ANALYST', 'SURVEYOR', 'VIEWER']).default('ANALYST'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const existing = await ctx.prisma.user.findUnique({ where: { email } });
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists' });
      const tempPassword = randomBytes(6).toString('base64url');
      await ctx.prisma.user.create({
        data: {
          orgId: ctx.principal.orgId,
          email,
          password: hashPassword(tempPassword),
          name: input.name,
          role: input.role,
          principalType: 'internal',
          initials: initialsOf(input.name),
        },
      });
      const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
      const mail = inviteEmail(input.name, org?.name ?? 'your team', email, tempPassword, APP_URL());
      const { emailed } = await sendMail(email, mail.subject, mail.text);
      return { tempPassword, emailed };
    }),

  /**
   * One-click onboarding: drops a fully-worked sample deal into the caller's
   * workspace — appraisal (engine-computed), comparables, scenarios, cost
   * packages, sales units, documents and tasks — so every screen demonstrates
   * itself before the user has typed a thing. Clearly named "Sample —".
   */
  loadSampleDeal: internalProcedure.mutation(async ({ ctx }) => {
    const orgId = ctx.principal.orgId;
    const p = (pounds: number) => BigInt(Math.round(pounds * 100));

    const input: AppraisalInput = {
      units: [
        { label: 'One-bed apartments', count: 8, area: 560, cap: 585, conf: 'high', source: 'Sample scheme' },
        { label: 'Two-bed apartments', count: 6, area: 810, cap: 545, conf: 'high', source: 'Sample scheme' },
        { label: 'Ground-floor commercial', count: 1, area: 2100, cap: 265, conf: 'med', source: 'Sample scheme' },
      ],
      efficiency: 88,
      trades: [
        { label: 'Substructure & frame', rate: 62 },
        { label: 'Envelope', rate: 38 },
        { label: 'M&E', rate: 34 },
        { label: 'Fit-out & finishes', rate: 41 },
        { label: 'Externals & prelims', rate: 15 },
      ],
      profFeePct: 10,
      contingencyPct: 5,
      otherCosts: [
        { label: 'Planning & S106', amount: 120000 },
        { label: 'Surveys & site investigation', amount: 28000 },
      ],
      finance: { ltcPct: 62, ratePct: 7.9, periodMonths: 16, salesMonths: 5, arrangementFeePct: 1.25, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 18,
      jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
      startYear: new Date().getFullYear(),
      startMonth: new Date().getMonth(),
    };
    const result = computeAppraisal(input, { withCash: true });
    const jv = jvWaterfall(result.equity, result.profit, result.holdYears, input.jv!);

    const deal = await ctx.prisma.deal.create({
      data: {
        orgId,
        name: 'Sample — Kingfisher Wharf',
        address: 'Quayside, Bristol',
        postcode: 'BS1 6XN',
        assetType: 'MIXED_USE',
        stage: 'APPRAISAL',
        figureStatus: 'ESTIMATE',
        probability: 60,
        gdv: p(result.gdv),
        forecastProfit: p(result.profit),
        roc: result.poc,
        equityRequired: p(result.equity),
        viability: result.poc >= 0.17 ? 'PROCEED' : result.poc >= 0.1 ? 'CAUTION' : 'DECLINE',
        nextMilestone: 'Explore the workfile',
        ownerId: ctx.principal.userId,
      },
    });

    await ctx.prisma.appraisal.create({
      data: {
        orgId,
        dealId: deal.id,
        isCurrent: true,
        label: 'Base',
        source: 'manual',
        efficiency: input.efficiency,
        units: JSON.stringify(input.units),
        trades: JSON.stringify(input.trades),
        otherCosts: JSON.stringify(input.otherCosts.map((o) => ({ label: o.label, amount: Math.round(o.amount * 100) }))),
        profFeePct: input.profFeePct,
        contingencyPct: input.contingencyPct,
        ltcPct: input.finance.ltcPct,
        ratePct: input.finance.ratePct,
        periodMonths: input.finance.periodMonths,
        salesMonths: input.finance.salesMonths,
        arrangementFeePct: input.finance.arrangementFeePct,
        spendProfile: 'SCURVE',
        siteMode: 'RESIDUAL',
        landFixed: 0n,
        acqPct: input.site.acqPct,
        agentPct: input.disposal.agentPct,
        legalPct: input.disposal.legalPct,
        targetProfitOnGdvPct: input.targetProfitOnGdvPct,
        planningStatus: 'Full consent granted — sample data',
        startYear: input.startYear ?? null,
        startMonth: input.startMonth ?? null,
        resultCache: JSON.stringify({ result, jv }),
      },
    });

    const comps: Array<[string, string, number, number, number, number, number]> = [
      ['The Malthouse, Wapping Road', 'Sold 3 months ago · 0.2 mi · new-build resi', 566, 2, 1, 2, 0],
      ['Harbourside Point', 'Sold 5 months ago · 0.4 mi', 592, -3, 0, 3, -4],
      ['Anchor Yard', 'Sold 8 months ago · 0.3 mi', 548, 3, 2, 5, -1],
      ['Merchant Quay commercial', 'Sold 4 months ago · 0.5 mi · Use Class E', 271, -2, -1, 3, 2],
    ];
    for (const [address, meta, basePsf, adjSize, adjCondition, adjDate, adjLocation] of comps) {
      await ctx.prisma.comparable.create({ data: { orgId, dealId: deal.id, address, meta, basePsf, adjSize, adjCondition, adjDate, adjLocation } });
    }

    const scenarios: Array<[string, string, number, number, number, number]> = [
      ['Option A — consented scheme', '14 apartments + commercial as consented', 545, 190, 12800, 18],
      ['Option B — add penthouse floor', 'Two additional penthouses, taller core', 560, 204, 14400, 18],
    ];
    for (const [name, descriptor, blendedPsf, buildPsf, gia, targetProfitPct] of scenarios) {
      await ctx.prisma.scenario.create({ data: { orgId, dealId: deal.id, name, descriptor, blendedPsf, buildPsf, gia, targetProfitPct } });
    }

    const contractor = await ctx.prisma.contractor.create({
      data: { orgId, name: 'Sample Construction Ltd', trade: 'Main contractor', status: 'On site', rating: '4.5', nextCert: 'Cert 03', timesheetRate: p(340), operatives: 6, weeks: JSON.stringify([36, 42, 40]) },
    });
    const packages: Array<[string, number, number, number, number, number]> = [
      ['Groundworks & substructure', 640000, 640000, 610000, 640000, 96],
      ['Frame & envelope', 1480000, 1510000, 820000, 1525000, 55],
      ['Fit-out & M&E', 1210000, 380000, 90000, 1210000, 8],
    ];
    for (const [name, budget, committed, spent, forecast, progressPct] of packages) {
      await ctx.prisma.costPackage.create({
        data: { orgId, dealId: deal.id, name, contractorId: contractor.id, budget: p(budget), committed: p(committed), spent: p(spent), forecast: p(forecast), progressPct, certificates: Math.round(progressPct / 20) },
      });
    }

    const milestoneNames = ['Reserved', 'Memorandum of sale', 'Searches ordered', 'Enquiries raised', 'Mortgage offer', 'Exchanged', 'Completed', 'Handover & snagging'];
    const units: Array<[string, string, number, number, number, string]> = [
      ['Plot 1', '1-bed · 560 ft²', 328000, 331000, 6, 'E. Harmon'],
      ['Plot 2', '1-bed · 560 ft²', 328000, 328000, 3, 'T. Osei'],
      ['Plot 3', '2-bed · 810 ft²', 441000, 445000, 5, 'The Novaks'],
      ['Plot 4', '2-bed · 810 ft²', 441000, 0, 0, ''],
      ['Plot 5', '1-bed · 560 ft²', 328000, 0, 0, ''],
      ['Plot 6', '2-bed · 810 ft²', 441000, 0, 0, ''],
    ];
    for (let i = 0; i < units.length; i++) {
      const [name, spec, appr, agreed, prog, buyer] = units[i];
      await ctx.prisma.unit.create({
        data: {
          orgId,
          dealId: deal.id,
          name,
          spec,
          level: Math.floor(i / 3),
          appraisedValue: p(appr),
          agreedValue: agreed ? p(agreed) : null,
          status: prog >= 6 ? 'COMPLETED' : prog >= 5 ? 'EXCHANGED' : prog >= 1 ? 'RESERVED' : 'AVAILABLE',
          buyerName: buyer || null,
          progress: prog,
          depositHeld: prog > 0 ? p(prog >= 5 ? agreed * 0.1 : 5000) : null,
          reservedAt: prog > 0 ? new Date() : null,
          milestones: { create: milestoneNames.map((m, idx) => ({ name: m, index: idx, done: idx < prog })) },
        },
      });
    }

    const docs: Array<[string, string, string, number]> = [
      ['Planning decision notice.pdf', 'Planning', 'pdf', 940_000],
      ['Cost plan v2.xlsx', 'Cost plans', 'xlsx', 310_000],
      ['Title register.pdf', 'Legal', 'pdf', 280_000],
    ];
    for (const [name, category, ext, sizeBytes] of docs) {
      await ctx.prisma.document.create({ data: { orgId, dealId: deal.id, name, category, ext, sizeBytes: BigInt(sizeBytes), extraction: 'STORED', addedById: ctx.principal.userId } });
    }

    await ctx.prisma.task.create({ data: { orgId, dealId: deal.id, title: 'Review the sample appraisal assumptions', aspect: 'Finance', assignee: ctx.principal.initials, due: new Date(Date.now() + 3 * 86400e3) } });
    await ctx.prisma.task.create({ data: { orgId, dealId: deal.id, title: 'Pull the live site pack for your own postcode', aspect: 'Site visit', assignee: ctx.principal.initials, due: new Date(Date.now() + 5 * 86400e3) } });
    await ctx.prisma.activityEvent.create({ data: { orgId, dealId: deal.id, actor: ctx.principal.name, action: 'loaded', target: 'sample deal (Kingfisher Wharf)' } });

    return { dealId: deal.id };
  }),

  setRole: adminProcedure
    .input(z.object({ userId: z.string(), role: z.enum(['ADMIN', 'ANALYST', 'SURVEYOR', 'VIEWER']) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findFirst({
        where: { id: input.userId, orgId: ctx.principal.orgId, principalType: 'internal' },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
      if (user.id === ctx.principal.userId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot change your own role' });
      return ctx.prisma.user.update({
        where: { id: user.id },
        data: { role: input.role },
        select: { id: true, role: true },
      });
    }),

  /**
   * Workspace audit trail — every recorded action across the org's deals,
   * newest first. Admin-only; feeds the Settings audit-log panel.
   */
  auditLog: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).default({}))
    .query(async ({ ctx, input }) => {
      const events = await ctx.prisma.activityEvent.findMany({
        where: { orgId: ctx.principal.orgId },
        orderBy: { at: 'desc' },
        take: input.limit,
      });
      const dealIds = [...new Set(events.map((e) => e.dealId))];
      const deals = await ctx.prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, name: true } });
      const nameOf = new Map(deals.map((d) => [d.id, d.name]));
      return events.map((e) => ({ ...e, dealName: nameOf.get(e.dealId) ?? null }));
    }),

  /**
   * GDPR data portability: one JSON file with everything the workspace owns.
   * Secrets (password hashes, integration credentials) are excluded; BigInt
   * pence values become plain numbers so the file is portable JSON.
   */
  exportData: adminProcedure.query(async ({ ctx }) => {
    const orgId = ctx.principal.orgId;
    const p = ctx.prisma;
    const [org, users, deals, appraisals, comparables, scenarios, inspections, units, milestones, tenancies, contractors, packages, photos, documents, tasks, activity, investors, holdings, cashflows, payments, benchmarks, integrations] =
      await Promise.all([
        p.organisation.findUnique({ where: { id: orgId } }),
        p.user.findMany({ where: { orgId }, select: { id: true, name: true, email: true, initials: true, role: true, principalType: true, createdAt: true } }),
        p.deal.findMany({ where: { orgId } }),
        p.appraisal.findMany({ where: { orgId } }),
        p.comparable.findMany({ where: { orgId } }),
        p.scenario.findMany({ where: { orgId } }),
        p.inspection.findMany({ where: { orgId } }),
        p.unit.findMany({ where: { orgId } }),
        p.salesMilestone.findMany({ where: { unit: { orgId } } }),
        p.tenancy.findMany({ where: { orgId } }),
        p.contractor.findMany({ where: { orgId } }),
        p.costPackage.findMany({ where: { orgId } }),
        p.sitePhoto.findMany({ where: { orgId } }),
        p.document.findMany({ where: { orgId } }),
        p.task.findMany({ where: { orgId } }),
        p.activityEvent.findMany({ where: { orgId } }),
        p.investor.findMany({ where: { orgId } }),
        p.holding.findMany({ where: { investor: { orgId } } }),
        p.cashflow.findMany({ where: { investor: { orgId } } }),
        p.payment.findMany({ where: { orgId } }),
        p.benchmarkPoint.findMany({ where: { orgId, isOwn: true } }),
        p.integrationConnection.findMany({ where: { orgId }, select: { id: true, provider: true, status: true, lastSync: true } }),
      ]);
    // Deep-convert BigInt (pence) → Number for a portable plain-JSON file
    const jsonSafe = (v: unknown): unknown => {
      if (typeof v === 'bigint') return Number(v);
      if (Array.isArray(v)) return v.map(jsonSafe);
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, jsonSafe(x)]));
      }
      return v;
    };
    await p.activityEvent.create({
      data: { orgId, dealId: deals[0]?.id ?? '', actor: ctx.principal.name, action: 'exported workspace data', target: `${deals.length} deals` },
    });
    return jsonSafe({
      exportedAt: new Date().toISOString(),
      exportedBy: ctx.principal.name,
      organisation: org ? { id: org.id, name: org.name, plan: org.plan, createdAt: org.createdAt } : null,
      users, deals, appraisals, comparables, scenarios, inspections, units,
      salesMilestones: milestones, tenancies, contractors, costPackages: packages,
      sitePhotos: photos, documents, tasks, activity, investors, holdings,
      cashflows, payments, benchmarkPoints: benchmarks, integrations,
    }) as Record<string, unknown>;
  }),

  /**
   * GDPR right to erasure: permanently delete the workspace and everything in
   * it. Admin-only, and the caller must type the organisation's exact name.
   */
  deleteWorkspace: adminProcedure
    .input(z.object({ confirmName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.principal.orgId;
      const org = await ctx.prisma.organisation.findUnique({ where: { id: orgId } });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.confirmName.trim() !== org.name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Type the workspace name exactly to confirm deletion' });
      }
      // Children first (no orgId of their own), then org-scoped rows, then the org
      await ctx.prisma.$transaction([
        ctx.prisma.salesMilestone.deleteMany({ where: { unit: { orgId } } }),
        ctx.prisma.holding.deleteMany({ where: { investor: { orgId } } }),
        ctx.prisma.cashflow.deleteMany({ where: { investor: { orgId } } }),
        ctx.prisma.unit.deleteMany({ where: { orgId } }),
        ctx.prisma.tenancy.deleteMany({ where: { orgId } }),
        ctx.prisma.investor.deleteMany({ where: { orgId } }),
        ctx.prisma.payment.deleteMany({ where: { orgId } }),
        ctx.prisma.appraisal.deleteMany({ where: { orgId } }),
        ctx.prisma.comparable.deleteMany({ where: { orgId } }),
        ctx.prisma.scenario.deleteMany({ where: { orgId } }),
        ctx.prisma.inspection.deleteMany({ where: { orgId } }),
        ctx.prisma.contractor.deleteMany({ where: { orgId } }),
        ctx.prisma.costPackage.deleteMany({ where: { orgId } }),
        ctx.prisma.sitePhoto.deleteMany({ where: { orgId } }),
        ctx.prisma.document.deleteMany({ where: { orgId } }),
        ctx.prisma.task.deleteMany({ where: { orgId } }),
        ctx.prisma.activityEvent.deleteMany({ where: { orgId } }),
        ctx.prisma.benchmarkPoint.deleteMany({ where: { orgId } }),
        ctx.prisma.integrationConnection.deleteMany({ where: { orgId } }),
        ctx.prisma.deal.deleteMany({ where: { orgId } }),
        ctx.prisma.user.deleteMany({ where: { orgId } }),
        ctx.prisma.organisation.delete({ where: { id: orgId } }),
      ]);
      return { deleted: true };
    }),
});
