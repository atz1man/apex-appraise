import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { J, P, toPence } from '../mappers.js';
import { AI_ACTOR } from '../ai-disclosure.js';
import { adminProcedure, internalProcedure, router } from '../trpc.js';
import { documentBlocks } from './appraisal.js';
import { SELF_SERVE_PROVIDERS, type SelfServeProvider } from '../integration-creds.js';
import { fetchEpc } from '../opendata.js';
import { searchCompanies } from '../companieshouse.js';
import { assertOwned } from '../auth/owned.js';
import { signFileUrl } from '../uploads.js';
import {
  XERO_SCOPES,
  accessTokenFor,
  authorizeUrl,
  exchangeCode,
  fetchTrackingCategories,
  listConnections,
  syncXero,
  xeroConfigured,
} from '../xero.js';
import { APP_URL } from '../email.js';
import { recordAudit } from '../audit.js';
import {
  CONSENT_DAYS,
  authorizeUrl as bankAuthorizeUrl,
  bankConfigured,
  exchangeCode as bankExchangeCode,
  fetchAccounts,
  newState,
  syncBank,
} from '../open-banking.js';

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
    /**
     * Every query below is already org-scoped, so nothing leaked — but this was
     * the one deal-scoped read that answered a foreign deal id with an empty
     * envelope instead of NOT_FOUND. Its siblings all refuse, and a reader of the
     * isolation sweep should not have to work out which shape means "no".
     */
    const deal = await ctx.prisma.deal.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
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
      if (id) await assertOwned(ctx.prisma.costPackage, id, ctx.principal.orgId);
      const row = id
        ? await ctx.prisma.costPackage.update({ where: { id }, data })
        : await ctx.prisma.costPackage.create({ data: { ...data, orgId: ctx.principal.orgId, dealId } });
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId,
          actor: ctx.principal.name,
          action: id ? 'updated cost package' : 'created cost package',
          target: `${input.name} — forecast £${Math.round(forecast).toLocaleString('en-GB')}`,
        },
      });
      return row;
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
    const deal = await ctx.prisma.deal.findFirst({ where: { id: input, orgId: ctx.principal.orgId } });
    if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
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
      url: signFileUrl(ph.url, ctx.principal.userId),
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
        /**
         * URLs come back SIGNED. An <img> or a link in a new tab cannot send a
         * bearer header, so the file's own short-lived token rides in the URL —
         * scoped to that one file, for half an hour. Files with no stored URL
         * (metadata-only rows) are left alone.
         */
        documents: docs.map((d) => ({
          ...d,
          sizeBytes: Number(d.sizeBytes),
          url: signFileUrl(d.url, ctx.principal.userId),
        })),
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

  /**
   * "Ask the workfile" — AI Q&A over the deal's readable documents. The model
   * reads the actual uploaded PDFs/images and answers ONLY from them; without
   * an ANTHROPIC_API_KEY it returns a deterministic demo answer instead.
   */
  ask: internalProcedure
    .input(z.object({ dealId: z.string(), question: z.string().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      // readable = a stored file the AI can actually open (mirrors Auto-Appraisal)
      const docs = await ctx.prisma.document.findMany({
        where: { dealId: input.dealId, orgId: ctx.principal.orgId },
        orderBy: { addedAt: 'desc' },
      });
      const readable = docs
        .filter((d) => d.url?.startsWith('/uploads/files/') && ['pdf', 'png', 'jpg', 'jpeg'].includes(d.ext.toLowerCase()))
        .slice(0, 4);
      if (readable.length === 0) return { status: 'no-docs' as const };
      const audit = () =>
        ctx.prisma.activityEvent.create({
          data: {
            orgId: ctx.principal.orgId,
            dealId: input.dealId,
            actor: AI_ACTOR,
            action: 'asked the workfile about',
            target: input.question.length > 80 ? `${input.question.slice(0, 79)}…` : input.question,
          },
        });
      if (!process.env.ANTHROPIC_API_KEY) {
        await audit();
        return {
          status: 'demo' as const,
          answer: `The workfile holds ${readable.length} readable document${readable.length === 1 ? '' : 's'} (${readable.map((d) => d.name).join('; ')}). Configure ANTHROPIC_API_KEY and the AI will answer questions directly from their contents.`,
          sources: [] as string[],
          documentsRead: readable.map((d) => d.name),
        };
      }
      const blocks = await documentBlocks(ctx.prisma, ctx.principal.orgId, readable.map((d) => d.id));
      if (blocks.blocks.length === 0) return { status: 'no-docs' as const }; // files missing on disk
      const names = blocks.used.map((d) => d.name);
      const { answer, sources } = await answerFromWorkfile(input.question, blocks.blocks, names);
      await audit();
      return { status: 'ok' as const, answer, sources, documentsRead: names };
    }),
});

const zWorkfileAnswer = z.object({ answer: z.string().min(1), sources: z.array(z.string()) });

/** JSON Schema for the forced tool call — answer plus the documents it draws on. */
const ANSWER_TOOL = {
  name: 'record_answer',
  description:
    'Record the answer to a question about the attached workfile documents. Plain prose only — no markdown, no headings, no bullet points.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'At most 200 words of plain prose answering the question from the attached documents alone' },
      sources: { type: 'array', items: { type: 'string' }, description: 'Names of the attached documents the answer draws on — a subset of the document names provided, empty if none were useful' },
    },
    required: ['answer', 'sources'],
  },
} as const;

/**
 * Ask the LLM a question about the attached documents. FORCED through a tool
 * call so output is schema-valid JSON by construction, and instructed to answer
 * only from the documents — never from general knowledge.
 */
async function answerFromWorkfile(
  question: string,
  docBlocks: Awaited<ReturnType<typeof documentBlocks>>['blocks'],
  docNames: string[],
): Promise<{ answer: string; sources: string[] }> {
  const instruction = `Answer the question below via record_answer, using ONLY the attached documents (${docNames.join('; ')}). If the documents do not contain the answer, say so plainly — never guess or draw on outside knowledge. UK property-professional register; at most 200 words of plain prose. sources lists only the attached document names the answer actually draws on.

QUESTION:
${question}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      tools: [ANSWER_TOOL],
      tool_choice: { type: 'tool', name: 'record_answer' },
      messages: [{ role: 'user', content: [...docBlocks, { type: 'text', text: instruction }] }],
    }),
  });
  if (res.ok) {
    const body = (await res.json()) as { content: Array<{ type: string; input?: unknown }> };
    const toolUse = body.content.find((c) => c.type === 'tool_use');
    const parsed = zWorkfileAnswer.safeParse(toolUse?.input);
    if (parsed.success) {
      return { answer: parsed.data.answer, sources: parsed.data.sources.filter((s) => docNames.includes(s)) };
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The AI returned an unusable answer — try again.' });
  }
  // surface the real upstream reason (e.g. "credit balance too low") instead of a mystery failure
  const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Ask the workfile unavailable: ${err?.error?.message ?? `Anthropic API returned ${res.status}`}. Fix the API key/credits and try again.`,
  });
}

// ---------- Integrations & org ----------

/**
 * Pending OAuth states, in memory. Short-lived by nature (fifteen minutes), and
 * losing them on restart costs an admin one retry — a table would be more
 * machinery than the problem deserves.
 */
const xeroStates = new Map<string, { orgId: string; userId: string; at: number }>();

export const bankRouter = router({
  status: adminProcedure.query(async ({ ctx }) => {
    const conn = await ctx.prisma.bankConnection.findUnique({
      where: { orgId: ctx.principal.orgId },
      include: { accounts: true },
    });
    const unclassified = conn
      ? await ctx.prisma.bankTransaction.count({ where: { orgId: ctx.principal.orgId, classification: 'unclassified', amount: { gt: 0 } } })
      : 0;
    return {
      configured: bankConfigured(),
      connected: !!conn,
      institution: conn?.institution ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastSyncError: conn?.lastSyncError ?? null,
      consentExpiresAt: conn?.consentExpiresAt ?? null,
      // days remaining, so a screen can warn BEFORE the feed goes quiet
      consentDaysLeft: conn ? Math.ceil((conn.consentExpiresAt.getTime() - Date.now()) / 86_400_000) : null,
      accounts: (conn?.accounts ?? []).map((a) => ({ id: a.id, name: a.name, last4: a.last4, dealId: a.dealId })),
      unclassifiedIn: unclassified,
    };
  }),

  connect: adminProcedure.mutation(async ({ ctx }) => {
    if (!bankConfigured()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Open banking is not configured on this server.' });
    }
    const state = newState();
    bankStates.set(state, { orgId: ctx.principal.orgId, userId: ctx.principal.userId, at: Date.now() });
    return { url: bankAuthorizeUrl(`${APP_URL()}/settings?bank=1`, state) };
  }),

  complete: adminProcedure
    .input(z.object({ code: z.string().min(1), state: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const pending = bankStates.get(input.state);
      bankStates.delete(input.state);
      if (!pending || pending.orgId !== ctx.principal.orgId || Date.now() - pending.at > 10 * 60_000) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That connection attempt has expired — start again.' });
      }
      const tokens = await bankExchangeCode(input.code, `${APP_URL()}/settings?bank=1`);
      const accounts = await fetchAccounts(tokens.accessToken);
      const consentExpiresAt = new Date(Date.now() + CONSENT_DAYS * 86_400_000);

      const conn = await ctx.prisma.bankConnection.upsert({
        where: { orgId: ctx.principal.orgId },
        create: {
          orgId: ctx.principal.orgId,
          institution: accounts[0]?.name ?? 'Bank',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          consentExpiresAt,
          createdById: ctx.principal.userId,
        },
        update: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          // reconnecting renews the consent clock — that is the whole point of
          // doing it, and leaving the old date would keep the warning showing
          consentExpiresAt,
          lastSyncError: null,
        },
      });

      for (const a of accounts) {
        await ctx.prisma.bankAccount.upsert({
          where: { connectionId_externalId: { connectionId: conn.id, externalId: a.externalId } },
          create: { orgId: ctx.principal.orgId, connectionId: conn.id, externalId: a.externalId, name: a.name, last4: a.last4, currency: a.currency },
          // a re-connect must not drop which deal an account was mapped to
          update: { name: a.name, last4: a.last4 },
        });
      }
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'connected a bank feed', target: `${accounts.length} account(s)`, ip: ctx.ip,
      });
      return { accounts: accounts.length, consentExpiresAt };
    }),

  mapAccount: adminProcedure
    .input(z.object({ accountId: z.string(), dealId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const account = await assertOwned(ctx.prisma.bankAccount, input.accountId, ctx.principal.orgId);
      if (input.dealId) {
        const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
        if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await ctx.prisma.bankAccount.update({ where: { id: account.id }, data: { dealId: input.dealId } });
      return { ok: true };
    }),

  sync: adminProcedure.mutation(({ ctx }) => syncBank(ctx.prisma, ctx.principal.orgId)),

  /** Money in, awaiting a human saying what it is. */
  unclassified: internalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.bankTransaction.findMany({
      where: { orgId: ctx.principal.orgId, classification: 'unclassified', amount: { gt: 0 } },
      orderBy: { bookedAt: 'desc' },
      take: 50,
      include: { account: { select: { name: true, dealId: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      bookedAt: t.bookedAt,
      amount: Number(t.amount) / 100,
      description: t.description,
      account: t.account.name,
      dealId: t.account.dealId,
    }));
  }),

  classify: internalProcedure
    .input(z.object({ id: z.string(), classification: z.enum(['drawdown', 'equity', 'receipt', 'cost']) }))
    .mutation(async ({ ctx, input }) => {
      const tx = await assertOwned(ctx.prisma.bankTransaction, input.id, ctx.principal.orgId);
      await ctx.prisma.bankTransaction.update({
        where: { id: tx.id },
        // who said so: a drawdown figure in a lender pack should be attributable
        data: { classification: input.classification, classifiedById: ctx.principal.userId },
      });
      return { ok: true };
    }),

  disconnect: adminProcedure.mutation(async ({ ctx }) => {
    const conn = await ctx.prisma.bankConnection.findUnique({ where: { orgId: ctx.principal.orgId } });
    if (!conn) return { ok: true };
    // transactions already imported are kept: they are this firm's record of what
    // happened, not the provider's to take away
    await ctx.prisma.bankConnection.delete({ where: { id: conn.id } });
    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: 'disconnected the bank feed', target: conn.institution, ip: ctx.ip,
    });
    return { ok: true };
  }),
});

const bankStates = new Map<string, { orgId: string; userId: string; at: number }>();

export const xeroRouter = router({
  /** What this workspace's Xero link looks like right now. */
  status: internalProcedure.query(async ({ ctx }) => {
    const conn = await ctx.prisma.xeroConnection.findUnique({ where: { orgId: ctx.principal.orgId } });
    const maps = conn
      ? await ctx.prisma.xeroDealMap.findMany({ where: { orgId: ctx.principal.orgId } })
      : [];
    return {
      // configured is about THIS SERVER having Xero credentials; connected is
      // about this workspace having linked an organisation. A screen that
      // conflates them tells an admin to reconnect when the fault is ours.
      configured: xeroConfigured(),
      connected: !!conn,
      tenantName: conn?.tenantName ?? null,
      trackingCategoryName: conn?.trackingCategoryName ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastSyncError: conn?.lastSyncError ?? null,
      mappedDeals: maps.length,
    };
  }),

  /** Begin consent. Returns where to send the admin. */
  connect: adminProcedure.mutation(({ ctx }) => {
    if (!xeroConfigured()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Xero is not configured on this server — set XERO_CLIENT_ID and XERO_CLIENT_SECRET.',
      });
    }
    const { url, state } = authorizeUrl(`${APP_URL()}/integrations/xero/callback`);
    // the state is checked on return; it is tied to the admin who started it
    xeroStates.set(state, { orgId: ctx.principal.orgId, userId: ctx.principal.userId, at: Date.now() });
    return { url };
  }),

  /** Finish consent. */
  complete: adminProcedure
    .input(z.object({ code: z.string().min(1), state: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const pending = xeroStates.get(input.state);
      xeroStates.delete(input.state);
      // an unknown or stale state is a cross-site attempt or a very slow human;
      // either way it is not a consent we can trust
      if (!pending || pending.orgId !== ctx.principal.orgId || Date.now() - pending.at > 15 * 60_000) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That Xero sign-in has expired — start again.' });
      }
      const tokens = await exchangeCode(input.code, `${APP_URL()}/integrations/xero/callback`);
      const tenants = await listConnections(tokens.access_token);
      if (!tenants.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No Xero organisation was granted.' });

      const data = {
        tenantId: tenants[0]!.tenantId,
        tenantName: tenants[0]!.tenantName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope ?? XERO_SCOPES,
        connectedById: ctx.principal.userId,
      };
      await ctx.prisma.xeroConnection.upsert({
        where: { orgId: ctx.principal.orgId },
        create: { orgId: ctx.principal.orgId, ...data },
        update: data,
      });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'connected Xero', target: tenants[0]!.tenantName, ip: ctx.ip,
      });
      return { tenantName: tenants[0]!.tenantName };
    }),

  /**
   * The tracking categories this Xero organisation actually has, with their
   * options. Fetched live rather than typed: a category id copied by hand is a
   * silent misconfiguration that reads every bill against the wrong dimension.
   */
  categories: adminProcedure.query(async ({ ctx }) => {
    const conn = await ctx.prisma.xeroConnection.findUnique({ where: { orgId: ctx.principal.orgId } });
    if (!conn) return { categories: [] as Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }> };
    const token = await accessTokenFor(ctx.prisma, ctx.principal.orgId);
    const cats = await fetchTrackingCategories(token, conn.tenantId);
    return { categories: cats };
  }),

  setCategory: adminProcedure
    .input(z.object({ id: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.xeroConnection.update({
        where: { orgId: ctx.principal.orgId },
        data: { trackingCategoryId: input.id, trackingCategoryName: input.name },
      });
      return { ok: true };
    }),

  mapDeal: adminProcedure
    .input(z.object({ dealId: z.string(), trackingOptionId: z.string(), trackingOptionName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.xeroDealMap.upsert({
        where: { orgId_trackingOptionId: { orgId: ctx.principal.orgId, trackingOptionId: input.trackingOptionId } },
        create: { orgId: ctx.principal.orgId, dealId: input.dealId, trackingOptionId: input.trackingOptionId, trackingOptionName: input.trackingOptionName },
        update: { dealId: input.dealId, trackingOptionName: input.trackingOptionName },
      });
      return { ok: true };
    }),

  sync: adminProcedure.mutation(async ({ ctx }) => {
    try {
      const out = await syncXero(ctx.prisma, ctx.principal.orgId);
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'synced costs from Xero', target: `${out.packages} package(s), ${out.deals} deal(s)`, ip: ctx.ip,
      });
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sync failed';
      // recorded so the screen can show WHY without the admin opening a ticket
      await ctx.prisma.xeroConnection
        .update({ where: { orgId: ctx.principal.orgId }, data: { lastSyncError: message.slice(0, 300) } })
        .catch(() => {});
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    }
  }),

  disconnect: adminProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.xeroDealMap.deleteMany({ where: { orgId: ctx.principal.orgId } });
    await ctx.prisma.xeroConnection.deleteMany({ where: { orgId: ctx.principal.orgId } });
    // packages already pulled are LEFT: they are the firm's cost record now, and
    // deleting a month of monitoring because someone unlinked an account would be
    // the integration doing damage on its way out
    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: 'disconnected Xero', target: 'accounting', ip: ctx.ip,
    });
    return { ok: true };
  }),
});

export const integrationsRouter = router({
  list: internalProcedure.query(async ({ ctx }) => {
    // Backfill any providers added since this org registered (e.g. Companies House)
    const existing = await ctx.prisma.integrationConnection.findMany({ where: { orgId: ctx.principal.orgId } });
    const missing = Object.keys(SELF_SERVE_PROVIDERS).filter((p) => !existing.some((e) => e.provider === p));
    for (const provider of missing) {
      await ctx.prisma.integrationConnection.create({ data: { orgId: ctx.principal.orgId, provider } });
    }
    const rows = missing.length
      ? await ctx.prisma.integrationConnection.findMany({ where: { orgId: ctx.principal.orgId }, orderBy: { provider: 'asc' } })
      : existing.sort((a, b) => a.provider.localeCompare(b.provider));
    // config (credentials) never leaves the server — expose only whether keys are set
    return rows.map(({ config, ...row }) => ({
      ...row,
      hasCredentials: config !== '{}' && config !== '',
      selfServe: row.provider in SELF_SERVE_PROVIDERS ? SELF_SERVE_PROVIDERS[row.provider as SelfServeProvider] : null,
    }));
  }),

  /**
   * Save a workspace's own API key for a self-serve provider. The key is
   * validated against the live upstream before it's accepted, stored
   * server-side only, and the connection flips to CONNECTED.
   */
  saveCredentials: internalProcedure
    .input(
      z.object({
        provider: z.enum(['EPC Register', 'Companies House']),
        fields: z.record(z.string().min(1).max(300)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.principal.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      const spec = SELF_SERVE_PROVIDERS[input.provider];
      for (const f of spec.fields) {
        if (!input.fields[f.key]?.trim()) throw new TRPCError({ code: 'BAD_REQUEST', message: `${f.label} is required` });
      }
      // live validation — never store a key the provider rejects
      if (input.provider === 'EPC Register') {
        const probe = await fetchEpc('SW1A 1AA', { key: input.fields.key });
        if (probe.status !== 'ok') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'The EPC service rejected this token — check it and try again.' });
        }
      } else {
        try {
          await searchCompanies('test', input.fields.key);
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Companies House rejected this key — check it and try again.' });
        }
      }
      const existing = await ctx.prisma.integrationConnection.findFirst({
        where: { orgId: ctx.principal.orgId, provider: input.provider },
      });
      const data = { status: 'CONNECTED', lastSync: new Date(), config: JSON.stringify(input.fields) };
      const row = existing
        ? await ctx.prisma.integrationConnection.update({ where: { id: existing.id }, data })
        : await ctx.prisma.integrationConnection.create({ data: { orgId: ctx.principal.orgId, provider: input.provider, ...data } });
      return { id: row.id, provider: row.provider, status: row.status };
    }),

  /** Remove a self-serve provider's stored key and mark it not connected. */
  disconnect: internalProcedure
    .input(z.enum(['EPC Register', 'Companies House']))
    .mutation(async ({ ctx, input }) => {
      if (ctx.principal.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      const conn = await ctx.prisma.integrationConnection.findFirst({ where: { orgId: ctx.principal.orgId, provider: input } });
      if (!conn) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.integrationConnection.update({
        where: { id: conn.id },
        data: { status: 'NOT_CONNECTED', config: '{}' },
      });
      return { disconnected: true };
    }),

  connect: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const conn = await ctx.prisma.integrationConnection.findFirst({ where: { orgId: ctx.principal.orgId, provider: input } });
    if (!conn) throw new TRPCError({ code: 'NOT_FOUND' });
    return ctx.prisma.integrationConnection.update({
      where: { id: conn.id },
      data: { status: 'CONNECTED', lastSync: new Date() },
    });
  }),

  /**
   * Pull provider data onto a deal. Providers run in demo/mock mode without
   * credentials (same pattern as production connectors behind an interface):
   * Land Registry → sold-price-paid comparables; EPC → certificate document;
   * PriceHubble → AVM cross-check comparable. Every sync is audit-logged.
   */
  sync: internalProcedure
    .input(z.object({ provider: z.string(), dealId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.prisma.integrationConnection.findFirst({
        where: { orgId: ctx.principal.orgId, provider: input.provider },
      });
      if (!conn) throw new TRPCError({ code: 'NOT_FOUND' });
      if (conn.status !== 'CONNECTED') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Connect this provider first' });
      const deal = await ctx.prisma.deal.findFirst({ where: { id: input.dealId, orgId: ctx.principal.orgId } });
      if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });

      let created = '';
      if (input.provider === 'HM Land Registry') {
        // REAL sold-price data from the open PPD API when the deal has a postcode
        let live = 0;
        if (deal.postcode) {
          try {
            const { fetchSoldPrices } = await import('../opendata.js');
            const sold = (await fetchSoldPrices(deal.postcode)).slice(0, 3);
            for (const s of sold) {
              await ctx.prisma.comparable.create({
                data: {
                  orgId: ctx.principal.orgId,
                  dealId: deal.id,
                  address: s.address,
                  meta: `Sold ${s.date} · £${Math.round(s.price).toLocaleString('en-GB')} · ${s.propertyType} · HM Land Registry PPD`,
                  basePsf: 0, // analyst sets £/ft² (or use the Site pack's EPC match)
                },
              });
              live++;
            }
          } catch {
            live = 0;
          }
        }
        if (live > 0) {
          created = `${live} real sold-price comparables (HM Land Registry PPD, ${deal.postcode})`;
        } else {
          const rows = [
            { address: 'Unit 4, Roundways Trade Park', meta: 'PPD Feb 2026 · freehold · 21,300 ft² · demo', basePsf: 221, adjSize: 2, adjCondition: 1, adjDate: 4, adjLocation: -2 },
            { address: '19 Cobham Gate Industrial', meta: 'PPD Dec 2025 · freehold · 19,750 ft² · demo', basePsf: 214, adjSize: 3, adjCondition: -2, adjDate: 6, adjLocation: 0 },
          ];
          for (const r of rows) {
            await ctx.prisma.comparable.create({ data: { ...r, orgId: ctx.principal.orgId, dealId: deal.id } });
          }
          created = `${rows.length} demo comparables (no postcode on deal / PPD unreachable)`;
        }
      } else if (input.provider === 'EPC Register') {
        await ctx.prisma.document.create({
          data: {
            orgId: ctx.principal.orgId,
            dealId: deal.id,
            name: `EPC certificate — ${deal.address.split(',')[0]}.pdf`,
            category: 'Planning',
            ext: 'pdf',
            sizeBytes: 180_000n,
            extraction: 'LINKED',
            addedById: ctx.principal.userId,
          },
        });
        created = 'EPC certificate (linked)';
      } else if (input.provider === 'PriceHubble AVM') {
        await ctx.prisma.comparable.create({
          data: {
            orgId: ctx.principal.orgId,
            dealId: deal.id,
            address: 'PriceHubble AVM estimate',
            meta: 'Automated valuation cross-check · 80% confidence band',
            basePsf: 212,
            adjSize: 0, adjCondition: 0, adjDate: 0, adjLocation: 0,
          },
        });
        created = 'AVM cross-check comparable';
      } else {
        created = 'sync acknowledged (no demo dataset for this provider yet)';
      }
      await ctx.prisma.activityEvent.create({
        data: { orgId: ctx.principal.orgId, dealId: deal.id, actor: input.provider, action: 'synced', target: created },
      });
      await ctx.prisma.integrationConnection.update({ where: { id: conn.id }, data: { lastSync: new Date() } });
      return { created };
    }),
});

