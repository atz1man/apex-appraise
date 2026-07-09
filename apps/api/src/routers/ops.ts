import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { J, P, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';

// ---------- Construction cost monitoring ----------

const pkgOut = (pk: any) => ({
  id: pk.id,
  name: pk.name,
  budget: P(pk.budget),
  committed: P(pk.committed),
  spent: P(pk.spent),
  forecast: P(pk.forecast),
  retentionPct: pk.retentionPct,
  certificates: pk.certificates,
  progressPct: pk.progressPct,
  contractorId: pk.contractorId,
  contractor: pk.contractor ? { id: pk.contractor.id, name: pk.contractor.name, trade: pk.contractor.trade } : null,
});

export const costRouter = router({
  packages: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const packages = await ctx.prisma.costPackage.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      include: { contractor: true },
    });
    const appraisal = await ctx.prisma.appraisal.findFirst({
      where: { dealId: input, orgId: ctx.principal.orgId, isCurrent: true },
    });
    const out = packages.map(pkgOut);
    const appraised = out.reduce((a, r) => a + r.budget, 0);
    const committed = out.reduce((a, r) => a + r.committed, 0);
    const spent = out.reduce((a, r) => a + r.spent, 0);
    const forecast = out.reduce((a, r) => a + r.forecast, 0);
    return {
      packages: out,
      rollup: {
        appraised,
        committed,
        spent,
        forecast,
        variance: forecast - appraised, // + = over budget
        profitImpact: appraised - forecast, // mirrors variance onto profit
      },
      hasAppraisal: !!appraisal,
    };
  }),

  upsertPackage: internalProcedure
    .input(
      z.object({
        id: z.string().optional(),
        dealId: z.string(),
        name: z.string().min(1),
        budget: z.number().min(0),
        committed: z.number().min(0).default(0),
        spent: z.number().min(0).default(0),
        forecast: z.number().min(0),
        progressPct: z.number().int().min(0).max(100).default(0),
        contractorId: z.string().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const { id, dealId, budget, committed, spent, forecast, ...rest } = input;
      const data = {
        ...rest,
        budget: toPence(budget),
        committed: toPence(committed),
        spent: toPence(spent),
        forecast: toPence(forecast),
      };
      if (id) return ctx.prisma.costPackage.update({ where: { id }, data });
      return ctx.prisma.costPackage.create({ data: { ...data, orgId: ctx.principal.orgId, dealId } });
    }),

  contractors: internalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.contractor.findMany({
      where: { orgId: ctx.principal.orgId },
      include: { packages: true },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      trade: c.trade,
      status: c.status,
      rating: c.rating,
      nextCert: c.nextCert,
      retentionRelease: c.retentionRelease,
      timesheetRate: c.timesheetRate != null ? P(c.timesheetRate) : null,
      operatives: c.operatives,
      weeks: J<number[]>(c.weeks, []),
      contractValue: c.packages.reduce((a, pk) => a + P(pk.committed), 0),
      retention: c.packages.reduce((a, pk) => a + P(pk.committed) * (pk.retentionPct / 100), 0),
      certificates: c.packages.reduce((a, pk) => a + pk.certificates, 0),
    }));
  }),

  logTimesheetWeek: internalProcedure
    .input(z.object({ contractorId: z.string(), hours: z.number().min(0).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.contractor.findFirst({ where: { id: input.contractorId, orgId: ctx.principal.orgId } });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const weeks = [...J<number[]>(c.weeks, []), input.hours];
      return ctx.prisma.contractor.update({ where: { id: c.id }, data: { weeks: JSON.stringify(weeks) } });
    }),
});

// ---------- Site photo log ----------

export const photosRouter = router({
  list: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const photos = await ctx.prisma.sitePhoto.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      include: { contractor: { select: { name: true } } },
      orderBy: { takenAt: 'desc' },
    });
    return photos.map((ph) => ({
      id: ph.id,
      caption: ph.caption,
      contractor: ph.contractor?.name ?? null,
      contractorId: ph.contractorId,
      url: ph.url,
      takenAt: ph.takenAt,
      weekCommencing: ph.weekCommencing,
    }));
  }),

  add: internalProcedure
    .input(z.object({ dealId: z.string(), caption: z.string().min(1), contractorId: z.string().nullable(), takenAt: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const taken = new Date(input.takenAt + 'T00:00:00Z');
      const wc = new Date(taken);
      wc.setUTCDate(wc.getUTCDate() - ((wc.getUTCDay() + 6) % 7));
      return ctx.prisma.sitePhoto.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: input.dealId,
          caption: input.caption,
          contractorId: input.contractorId,
          takenAt: taken,
          weekCommencing: wc,
        },
      });
    }),
});

// ---------- Tasks ----------

export const tasksRouter = router({
  list: internalProcedure
    .input(z.object({ dealId: z.string().optional(), aspect: z.string().optional() }))
    .query(({ ctx, input }) =>
      ctx.prisma.task.findMany({
        where: {
          orgId: ctx.principal.orgId,
          ...(input.dealId ? { dealId: input.dealId } : {}),
          ...(input.aspect ? { aspect: input.aspect } : {}),
        },
        orderBy: [{ done: 'asc' }, { due: 'asc' }],
        include: { deal: { select: { name: true } } },
      }),
    ),

  create: internalProcedure
    .input(z.object({ dealId: z.string(), title: z.string().min(1), aspect: z.string(), assignee: z.string().default('AO'), due: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.prisma.task.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: input.dealId,
          title: input.title,
          aspect: input.aspect,
          assignee: input.assignee,
          due: input.due ? new Date(input.due) : new Date(Date.now() + 7 * 86400e3),
        },
      });
    }),

  toggle: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const t = await ctx.prisma.task.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
    return ctx.prisma.task.update({ where: { id: t.id }, data: { done: !t.done } });
  }),
});

// ---------- Documents / data room ----------

export const documentsRouter = router({
  list: internalProcedure
    .input(z.object({ dealId: z.string(), category: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const docs = await ctx.prisma.document.findMany({
        where: { dealId: input.dealId, orgId: ctx.principal.orgId, ...(input.category ? { category: input.category } : {}) },
        orderBy: { addedAt: 'desc' },
      });
      const all = await ctx.prisma.document.findMany({ where: { dealId: input.dealId, orgId: ctx.principal.orgId }, select: { category: true, sizeBytes: true } });
      const byCategory: Record<string, number> = {};
      let totalBytes = 0;
      for (const d of all) {
        byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
        totalBytes += Number(d.sizeBytes);
      }
      return {
        documents: docs.map((d) => ({ ...d, sizeBytes: Number(d.sizeBytes) })),
        counts: { all: all.length, byCategory },
        totalBytes,
      };
    }),

  add: internalProcedure
    .input(z.object({ dealId: z.string(), name: z.string().min(1), category: z.string(), sizeBytes: z.number().default(0) }))
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      const ext = input.name.includes('.') ? input.name.split('.').pop()! : 'pdf';
      const doc = await ctx.prisma.document.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: input.dealId,
          name: input.name,
          category: input.category,
          ext,
          sizeBytes: BigInt(Math.round(input.sizeBytes)),
          extraction: 'STORED',
          addedById: ctx.principal.userId,
        },
      });
      await ctx.prisma.activityEvent.create({
        data: { orgId: ctx.principal.orgId, dealId: input.dealId, actor: ctx.principal.name, action: 'uploaded', target: input.name },
      });
      return doc;
    }),

  setExtraction: internalProcedure
    .input(z.object({ id: z.string(), status: z.enum(['EXTRACTED', 'LINKED', 'STORED']) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.prisma.document.findFirst({ where: { id: input.id, orgId: ctx.principal.orgId } });
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.prisma.document.update({ where: { id: doc.id }, data: { extraction: input.status } });
    }),

  activity: internalProcedure.input(z.string()).query(({ ctx, input }) =>
    ctx.prisma.activityEvent.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      orderBy: { at: 'desc' },
      take: 20,
    }),
  ),
});

// ---------- Integrations & org ----------

export const integrationsRouter = router({
  list: internalProcedure.query(({ ctx }) =>
    ctx.prisma.integrationConnection.findMany({ where: { orgId: ctx.principal.orgId }, orderBy: { provider: 'asc' } }),
  ),
  connect: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const conn = await ctx.prisma.integrationConnection.findFirst({ where: { orgId: ctx.principal.orgId, provider: input } });
    if (!conn) throw new TRPCError({ code: 'NOT_FOUND' });
    return ctx.prisma.integrationConnection.update({
      where: { id: conn.id },
      data: { status: 'CONNECTED', lastSync: new Date() },
    });
  }),
});

export const orgRouter = router({
  members: internalProcedure.query(({ ctx }) =>
    ctx.prisma.user.findMany({
      where: { orgId: ctx.principal.orgId, principalType: 'internal' },
      select: { id: true, name: true, initials: true, role: true },
    }),
  ),
});
