import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  autoAppraise,
  computeAppraisal,
  jvWaterfall,
  sensitivityGrid,
  weightedComparables,
  type AppraisalResult,
} from '@apex/appraisal-engine';
import { zAppraisalInput, zExtraction, type Extraction } from '@apex/types';
import { appraisalRowToEngineInput, P, toPence } from '../mappers.js';
import { internalProcedure, router } from '../trpc.js';

const spendProfileToDb: Record<string, string> = {
  scurve: 'SCURVE', even: 'EVEN', linear: 'EVEN', front: 'FRONT', back: 'BACK',
};

async function assertDeal(ctx: { prisma: any; principal: { orgId: string } }, dealId: string) {
  const deal = await ctx.prisma.deal.findFirst({ where: { id: dealId, orgId: ctx.principal.orgId } });
  if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
  return deal;
}

function fullResult(input: z.infer<typeof zAppraisalInput>) {
  const result = computeAppraisal(input, { withCash: true });
  const jv = input.jv
    ? jvWaterfall(result.equity, result.profit, result.holdYears, {
        gpCoinvestPct: input.jv.gpCoinvestPct,
        prefPct: input.jv.prefPct,
        promotePct: input.jv.promotePct,
      })
    : null;
  return { result, jv };
}

/** persistence payload for appraisal inputs (money £ → pence) */
function inputToRow(input: z.infer<typeof zAppraisalInput>) {
  return {
    efficiency: input.efficiency,
    units: JSON.stringify(input.units),
    trades: JSON.stringify(input.trades),
    otherCosts: JSON.stringify(input.otherCosts.map((o) => ({ label: o.label, amount: Math.round(o.amount * 100) }))),
    profFeePct: input.profFeePct,
    contingencyPct: input.contingencyPct,
    ltcPct: input.finance.ltcPct,
    ratePct: input.finance.ratePct,
    periodMonths: Math.round(input.finance.periodMonths),
    salesMonths: Math.round(input.finance.salesMonths),
    arrangementFeePct: input.finance.arrangementFeePct,
    spendProfile: spendProfileToDb[input.finance.spendProfile ?? 'scurve'],
    siteMode: input.site.mode === 'profit' ? 'PROFIT' : 'RESIDUAL',
    landFixed: toPence(input.site.landFixed),
    acqPct: input.site.acqPct,
    agentPct: input.disposal.agentPct,
    legalPct: input.disposal.legalPct,
    targetProfitOnGdvPct: input.targetProfitOnGdvPct,
    jvGpCoinvestPct: input.jv?.gpCoinvestPct ?? 10,
    jvPrefPct: input.jv?.prefPct ?? 8,
    jvPromotePct: input.jv?.promotePct ?? 20,
    startYear: input.startYear ?? null,
    startMonth: input.startMonth ?? null,
  };
}

export const appraisalRouter = router({
  getCurrent: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    const row = await ctx.prisma.appraisal.findFirst({
      where: { dealId: input, orgId: ctx.principal.orgId, isCurrent: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) return null;
    const engineInput = appraisalRowToEngineInput(row);
    return {
      id: row.id,
      dealId: row.dealId,
      label: row.label,
      source: row.source,
      planningStatus: row.planningStatus,
      input: engineInput,
      ...fullResult({ ...engineInput, jv: engineInput.jv! } as z.infer<typeof zAppraisalInput>),
    };
  }),

  /** PURE — runs the engine for live what-ifs; no persistence. */
  compute: internalProcedure.input(zAppraisalInput).query(({ input }) => fullResult(input)),

  save: internalProcedure
    .input(z.object({ dealId: z.string(), input: zAppraisalInput, source: z.string().default('manual') }))
    .mutation(async ({ ctx, input }) => {
      await assertDeal(ctx, input.dealId);
      const { result, jv } = fullResult(input.input);
      const existing = await ctx.prisma.appraisal.findFirst({
        where: { dealId: input.dealId, orgId: ctx.principal.orgId, isCurrent: true },
      });
      const data = {
        ...inputToRow(input.input),
        source: input.source,
        resultCache: JSON.stringify({ result, jv }),
      };
      const row = existing
        ? await ctx.prisma.appraisal.update({ where: { id: existing.id }, data })
        : await ctx.prisma.appraisal.create({
            data: { ...data, orgId: ctx.principal.orgId, dealId: input.dealId, isCurrent: true },
          });
      // reflect hardened headline figures onto the deal card (derived, engine-owned)
      await ctx.prisma.deal.update({
        where: { id: input.dealId },
        data: {
          gdv: toPence(result.gdv),
          forecastProfit: toPence(result.profit),
          roc: result.poc,
          equityRequired: toPence(result.equity),
          viability: result.poc >= 0.17 ? 'PROCEED' : result.poc >= 0.1 ? 'CAUTION' : 'DECLINE',
        },
      });
      // audit trail on every financial mutation
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: input.dealId,
          actor: ctx.principal.name,
          action: 'saved appraisal',
          target: `GDV £${Math.round(result.gdv).toLocaleString('en-GB')} · profit £${Math.round(result.profit).toLocaleString('en-GB')}`,
        },
      });
      return { id: row.id, result, jv };
    }),

  sensitivity: internalProcedure
    .input(z.object({ input: zAppraisalInput, metric: z.enum(['roc', 'profit', 'residual']) }))
    .query(({ input }) => sensitivityGrid(input.input, input.metric)),
});

// ---------- Auto-Appraisal ----------

const SAMPLE_EXTRACTION: Extraction = {
  scheme: 'Northgate Trade & Industrial Park',
  address: 'Holdenhurst Road, Bournemouth BH8 8EW',
  assetType: 'industrial',
  units: [
    { label: 'Trade counter units', count: 6, area: 2500, value: 290, conf: 'high', source: 'Drawing A-102' },
    { label: 'B8 warehouse', count: 1, area: 18000, value: 195, conf: 'med', source: 'Comparables note' },
    { label: 'Mezzanine offices', count: 1, area: 3200, value: 240, conf: 'med', source: 'Cost plan summary' },
  ],
  efficiency: 90,
  profFee: 11,
  contingency: 5,
  finance: { ltc: 60, rate: 7.5, period: 18, sales: 3, arrFee: 1.5 },
  targetProfit: 20,
  asking: 400000,
  cilPerSqm: 40,
  s106: 150000,
  agent: 1.5,
  legal: 0.5,
  acq: 1.8,
  planningStatus: 'Full consent granted',
  planningRisk: 22,
  planningRiskLabel: 'Low',
  planningNotes:
    'Detailed planning permission granted with standard pre-commencement conditions only. CIL and S106 liabilities quantified. No reserved matters or viability challenge outstanding.',
  recommendation:
    'Proceed. At a £105/ft² build and 20% target profit, the residual land value comfortably exceeds the £400,000 asking, leaving positive headroom. With full consent and low planning risk, this is an actionable acquisition — recommend offering at or slightly above asking to secure the site.',
  confidence: 'High confidence',
};

/**
 * Server-side LLM extraction — inputs only, never money. Falls back to a
 * deterministic parse of the notes when no ANTHROPIC_API_KEY is configured
 * (demo mode, mirroring the prototype's mock()).
 */
async function extractFromNotes(notes: string): Promise<Extraction> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `Extract development-appraisal INPUTS from these scheme notes. Return ONLY strict JSON matching this shape (no prose):\n${JSON.stringify(SAMPLE_EXTRACTION, null, 2)}\n\nRules: extract inputs only — do NOT compute any financial outputs. Areas in sqft, values in £/ft², asking/s106 in £. conf per unit is your extraction confidence; source cites where in the notes it came from.\n\nNOTES:\n${notes}`,
          },
        ],
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { content: Array<{ type: string; text?: string }> };
      const text = body.content.find((c) => c.type === 'text')?.text ?? '';
      const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const parsed = zExtraction.safeParse(JSON.parse(jsonStr));
      if (parsed.success) return parsed.data;
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI extraction returned an unusable shape — try manual entry (no fabricated figures).' });
    }
    // surface the real upstream reason (e.g. "credit balance too low") instead of a mystery failure
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `AI extraction unavailable: ${err?.error?.message ?? `Anthropic API returned ${res.status}`}. Use manual entry, or fix the API key/credits.`,
    });
  }
  // demo fallback: deterministic sample keyed off the notes where possible
  const s106Match = notes.match(/S106[^£]*£([\d,]+)/i);
  const cilMatch = notes.match(/CIL[^£]*£(\d+)\s*per\s*sqm/i);
  const askingMatch = notes.match(/asking[^£]*£([\d,]+)/i);
  const num = (m: RegExpMatchArray | null, dflt: number) => (m ? parseFloat(m[1].replace(/,/g, '')) : dflt);
  return {
    ...SAMPLE_EXTRACTION,
    s106: num(s106Match, SAMPLE_EXTRACTION.s106),
    cilPerSqm: num(cilMatch, SAMPLE_EXTRACTION.cilPerSqm),
    asking: num(askingMatch, SAMPLE_EXTRACTION.asking),
  };
}

const zAutoInputs = z.object({
  extraction: zExtraction,
  buildPerSqft: z.number().positive(),
});

/** extraction + build rate → engine indicative result (deterministic code, never the LLM) */
function indicative(extraction: Extraction, buildPerSqft: number) {
  const r = autoAppraise({
    units: extraction.units.map((u) => ({ label: u.label, count: u.count, area: u.area, cap: u.value, conf: u.conf, source: u.source })),
    efficiency: extraction.efficiency,
    buildPerSqft,
    profFeePct: extraction.profFee,
    contingencyPct: extraction.contingency,
    cilPerSqm: extraction.cilPerSqm,
    s106: extraction.s106,
    agentPct: extraction.agent,
    legalPct: extraction.legal,
    ltcPct: extraction.finance.ltc,
    ratePct: extraction.finance.rate,
    periodMonths: extraction.finance.period,
    salesMonths: extraction.finance.sales,
    arrangementFeePct: extraction.finance.arrFee,
    targetProfitPct: extraction.targetProfit,
    acqPct: extraction.acq,
    asking: extraction.asking,
  });
  const roc = r.rocAtAsking ?? (r.totalCostAtAsking == null && r.gdv > 0 ? r.targetProfit / Math.max(r.gdv - r.targetProfit, 1) : 0);
  const headroom = r.headroom ?? 0;
  let verdict: 'Proceed' | 'Caution' | 'Decline' = 'Caution';
  if ((r.rocAtAsking ?? 0.2) >= 0.17 && (extraction.asking === 0 || headroom >= 0)) verdict = 'Proceed';
  else if ((r.rocAtAsking ?? 0.2) < 0.1 || (extraction.asking > 0 && headroom < -extraction.asking * 0.1)) verdict = 'Decline';
  return { ...r, roc, verdict };
}

export const autoAppraisalRouter = router({
  extract: internalProcedure
    .input(z.object({ notes: z.string().min(10), buildPerSqft: z.number().positive().default(105) }))
    .mutation(async ({ input }) => {
      const extraction = await extractFromNotes(input.notes);
      return { extraction, indicative: indicative(extraction, input.buildPerSqft) };
    }),

  compute: internalProcedure.input(zAutoInputs).query(({ input }) => indicative(input.extraction, input.buildPerSqft)),

  /**
   * What-if chat: NL prompt → input deltas (LLM or local parser) → deterministic recompute.
   * The local parser mirrors the prototype's fallback.
   */
  whatIf: internalProcedure
    .input(z.object({ extraction: zExtraction, buildPerSqft: z.number().positive(), prompt: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const p = input.prompt.toLowerCase();
      const changes: Record<string, number> = {};
      let buildPerSqft = input.buildPerSqft;
      const grab = (re: RegExp) => {
        const m = p.match(re);
        return m ? parseFloat(m[1].replace(/,/g, '')) : null;
      };
      const build = grab(/build[^0-9£]*£?(\d+(?:\.\d+)?)/);
      if (build != null && build > 20 && build < 500) buildPerSqft = build;
      const profitPct = grab(/profit[^0-9]*(\d+(?:\.\d+)?)\s*%/);
      if (profitPct != null) changes.targetProfit = profitPct;
      const rate = grab(/(?:rate|interest)[^0-9]*(\d+(?:\.\d+)?)\s*%/);
      if (rate != null) changes['finance.rate'] = rate;
      const ltc = grab(/ltc[^0-9]*(\d+(?:\.\d+)?)\s*%/);
      if (ltc != null) changes['finance.ltc'] = ltc;
      const asking = grab(/asking[^0-9£]*£?([\d,]+)/);
      if (asking != null && asking > 10000) changes.asking = asking;
      const s106 = grab(/s106[^0-9£]*£?([\d,]+)/);
      if (s106 != null) changes.s106 = s106;

      const next: Extraction = structuredClone(input.extraction);
      if (changes.targetProfit != null) next.targetProfit = changes.targetProfit;
      if (changes['finance.rate'] != null) next.finance.rate = changes['finance.rate'];
      if (changes['finance.ltc'] != null) next.finance.ltc = changes['finance.ltc'];
      if (changes.asking != null) next.asking = changes.asking;
      if (changes.s106 != null) next.s106 = changes.s106;

      const anyChange = Object.keys(changes).length > 0 || buildPerSqft !== input.buildPerSqft;
      const reply = anyChange
        ? 'Applied your change and re-ran the residual — figures updated below.'
        : "I couldn't map that to a model input — try e.g. “build £115”, “profit 17.5%”, “rate 8.5%” or “asking £450,000”.";
      return {
        changes,
        buildPerSqft,
        extraction: next,
        reply,
        indicative: indicative(next, buildPerSqft),
      };
    }),
});

// ---------- Comparables & Scenarios ----------

export const comparablesRouter = router({
  list: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    const comps = await ctx.prisma.comparable.findMany({ where: { dealId: input, orgId: ctx.principal.orgId } });
    const summary = weightedComparables(
      comps.map((c: any) => ({
        address: c.address,
        basePsf: c.basePsf,
        adjustments: { size: c.adjSize, condition: c.adjCondition, date: c.adjDate, location: c.adjLocation },
      })),
    );
    return { comps, summary };
  }),

  upsert: internalProcedure
    .input(
      z.object({
        id: z.string().optional(),
        dealId: z.string(),
        address: z.string(),
        meta: z.string().default(''),
        basePsf: z.number(),
        adjSize: z.number(),
        adjCondition: z.number(),
        adjDate: z.number(),
        adjLocation: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeal(ctx, input.dealId);
      const { id, ...data } = input;
      if (id) return ctx.prisma.comparable.update({ where: { id }, data });
      return ctx.prisma.comparable.create({ data: { ...data, orgId: ctx.principal.orgId } });
    }),

  /** Writes the supported £/ft² onto every unit cap of the current appraisal. */
  applyToAppraisal: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    const comps = await ctx.prisma.comparable.findMany({ where: { dealId: input, orgId: ctx.principal.orgId } });
    if (!comps.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No comparables on this deal' });
    const summary = weightedComparables(
      comps.map((c: any) => ({
        address: c.address,
        basePsf: c.basePsf,
        adjustments: { size: c.adjSize, condition: c.adjCondition, date: c.adjDate, location: c.adjLocation },
      })),
    );
    const appraisal = await ctx.prisma.appraisal.findFirst({
      where: { dealId: input, orgId: ctx.principal.orgId, isCurrent: true },
    });
    if (!appraisal) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No current appraisal to apply to' });
    const supported = Math.round(summary.supportedPsf);
    const units = (JSON.parse(appraisal.units) as any[]).map((u) => ({
      ...u,
      cap: supported,
      conf: 'high',
      source: `Comparables — supported £${supported}/ft²`,
    }));
    await ctx.prisma.appraisal.update({ where: { id: appraisal.id }, data: { units: JSON.stringify(units) } });
    return { supportedPsf: supported };
  }),
});

export const scenariosRouter = router({
  list: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    return ctx.prisma.scenario.findMany({ where: { dealId: input, orgId: ctx.principal.orgId } });
  }),

  upsert: internalProcedure
    .input(
      z.object({
        id: z.string().optional(),
        dealId: z.string(),
        name: z.string(),
        descriptor: z.string().default(''),
        blendedPsf: z.number(),
        buildPsf: z.number(),
        gia: z.number(),
        targetProfitPct: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeal(ctx, input.dealId);
      const { id, ...data } = input;
      if (id) return ctx.prisma.scenario.update({ where: { id }, data });
      return ctx.prisma.scenario.create({ data: { ...data, orgId: ctx.principal.orgId } });
    }),
});
