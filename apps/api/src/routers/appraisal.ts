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
import { appraisalRowToEngineInput, J, P, toPence } from '../mappers.js';
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
    absorptionUnitsPerMonth: input.finance.absorptionUnitsPerMonth ?? null,
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
      narrative: J<NarrativePayload | null>(row.narrative, null),
      ...fullResult({ ...engineInput, jv: engineInput.jv! } as z.infer<typeof zAppraisalInput>),
    };
  }),

  /** PURE — runs the engine for live what-ifs; no persistence. */
  compute: internalProcedure.input(zAppraisalInput).query(({ input }) => fullResult(input)),

  save: internalProcedure
    .input(
      z.object({
        dealId: z.string(),
        input: zAppraisalInput,
        source: z.string().default('manual'),
        // versioning: asNewVersion snapshots the current row into history and
        // creates a fresh current version under the given label
        asNewVersion: z.boolean().default(false),
        label: z.string().max(60).optional(),
      }),
    )
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
      let row;
      if (existing && input.asNewVersion) {
        await ctx.prisma.appraisal.update({ where: { id: existing.id }, data: { isCurrent: false } });
        row = await ctx.prisma.appraisal.create({
          data: {
            ...data,
            orgId: ctx.principal.orgId,
            dealId: input.dealId,
            isCurrent: true,
            label: input.label?.trim() || `v${(await ctx.prisma.appraisal.count({ where: { dealId: input.dealId, orgId: ctx.principal.orgId } })) + 1}`,
          },
        });
      } else if (existing) {
        row = await ctx.prisma.appraisal.update({ where: { id: existing.id }, data });
      } else {
        row = await ctx.prisma.appraisal.create({
          data: { ...data, orgId: ctx.principal.orgId, dealId: input.dealId, isCurrent: true, label: input.label?.trim() || 'Base' },
        });
      }
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
          action: input.asNewVersion ? `saved appraisal version “${row.label}”` : 'saved appraisal',
          target: `GDV £${Math.round(result.gdv).toLocaleString('en-GB')} · profit £${Math.round(result.profit).toLocaleString('en-GB')}`,
        },
      });
      return { id: row.id, result, jv };
    }),

  /** Version history with headline figures for comparison (newest first). */
  versions: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    const rows = await ctx.prisma.appraisal.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, label: true, source: true, isCurrent: true, createdAt: true, updatedAt: true, resultCache: true },
    });
    return rows.map((r) => {
      let headline: { gdv: number; residualNet: number; profit: number; poc: number } | null = null;
      try {
        const cached = r.resultCache ? (JSON.parse(r.resultCache) as { result: { gdv: number; residualNet: number; profit: number; poc: number } }) : null;
        if (cached?.result) {
          headline = { gdv: cached.result.gdv, residualNet: cached.result.residualNet, profit: cached.result.profit, poc: cached.result.poc };
        }
      } catch {
        headline = null;
      }
      return { id: r.id, label: r.label, source: r.source, isCurrent: r.isCurrent, createdAt: r.createdAt, updatedAt: r.updatedAt, headline };
    });
  }),

  /**
   * Restore an old version: its inputs become a NEW current version, so history
   * is never rewritten — every figure stays traceable.
   */
  restore: internalProcedure.input(z.object({ dealId: z.string(), versionId: z.string() })).mutation(async ({ ctx, input }) => {
    await assertDeal(ctx, input.dealId);
    const version = await ctx.prisma.appraisal.findFirst({
      where: { id: input.versionId, dealId: input.dealId, orgId: ctx.principal.orgId },
    });
    if (!version) throw new TRPCError({ code: 'NOT_FOUND' });
    await ctx.prisma.appraisal.updateMany({
      where: { dealId: input.dealId, orgId: ctx.principal.orgId, isCurrent: true },
      data: { isCurrent: false },
    });
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = version;
    const restored = await ctx.prisma.appraisal.create({
      data: { ...copy, isCurrent: true, label: `${version.label} (restored)` },
    });
    await ctx.prisma.activityEvent.create({
      data: {
        orgId: ctx.principal.orgId,
        dealId: input.dealId,
        actor: ctx.principal.name,
        action: 'restored appraisal version',
        target: version.label,
      },
    });
    return { id: restored.id };
  }),

  sensitivity: internalProcedure
    .input(z.object({ input: zAppraisalInput, metric: z.enum(['roc', 'profit', 'residual']) }))
    .query(({ input }) => sensitivityGrid(input.input, input.metric)),

  /**
   * AI-drafted Red Book narrative — market commentary, valuation rationale and
   * risk commentary. Every figure comes from the deterministic engine; the LLM
   * only writes prose around them. Persisted onto the current appraisal so the
   * report renders the same narrative until it is redrafted.
   */
  draftNarrative: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const deal = await assertDeal(ctx, input);
    const row = await ctx.prisma.appraisal.findFirst({
      where: { dealId: input, orgId: ctx.principal.orgId, isCurrent: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No current appraisal to draft a narrative from — save an appraisal first.' });
    const engineInput = appraisalRowToEngineInput(row);
    const { result } = fullResult({ ...engineInput, jv: engineInput.jv! } as z.infer<typeof zAppraisalInput>);
    const comps = await ctx.prisma.comparable.findMany({ where: { dealId: input, orgId: ctx.principal.orgId } });
    const summary = comps.length
      ? weightedComparables(
          comps.map((c: any) => ({
            address: c.address,
            basePsf: c.basePsf,
            adjustments: { size: c.adjSize, condition: c.adjCondition, date: c.adjDate, location: c.adjLocation },
          })),
        )
      : null;
    const sections = await draftNarrativeSections({
      subject: deal.name,
      address: deal.address ?? '',
      assetType: deal.assetType ?? 'RESIDENTIAL',
      gdv: result.gdv,
      nia: result.nia,
      profit: result.profit,
      poc: result.poc,
      planningStatus: row.planningStatus,
      compCount: comps.length,
      supportedPsf: summary ? Math.round(summary.supportedPsf) : null,
      compAddresses: comps.map((c: any) => c.address),
    });
    const payload: NarrativePayload = {
      ...sections,
      generatedAt: new Date().toISOString(),
      model: process.env.ANTHROPIC_API_KEY ? NARRATIVE_MODEL : 'demo',
    };
    await ctx.prisma.appraisal.update({ where: { id: row.id }, data: { narrative: JSON.stringify(payload) } });
    await ctx.prisma.activityEvent.create({
      data: {
        orgId: ctx.principal.orgId,
        dealId: input,
        actor: 'AI Development Director',
        action: 'drafted Red Book narrative for',
        target: deal.name,
      },
    });
    return payload;
  }),
});

// ---------- Red Book narrative (AI-drafted, figures from the engine) ----------

const NARRATIVE_MODEL = 'claude-sonnet-5';

type NarrativeSections = { marketCommentary: string; valuationRationale: string; riskCommentary: string };
type NarrativePayload = NarrativeSections & { generatedAt: string; model: string };

const zNarrativeSections = z.object({
  marketCommentary: z.string().min(1),
  valuationRationale: z.string().min(1),
  riskCommentary: z.string().min(1),
});

/** JSON Schema for the forced tool call — three plain-prose report sections. */
const NARRATIVE_TOOL = {
  name: 'record_narrative',
  description:
    'Record the three narrative sections for a RICS Red Book valuation report. Plain prose only — no markdown, no headings, no bullet points.',
  input_schema: {
    type: 'object',
    properties: {
      marketCommentary: { type: 'string', description: '90-140 words on local market conditions and the comparable evidence base' },
      valuationRationale: { type: 'string', description: '90-140 words on method and reconciliation, ending with the Market Value opinion' },
      riskCommentary: { type: 'string', description: '90-140 words on planning, market and lending risks material to the valuation' },
    },
    required: ['marketCommentary', 'valuationRationale', 'riskCommentary'],
  },
} as const;

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/**
 * Draft the three report sections. The LLM is FORCED through a tool call so
 * output is schema-valid JSON by construction, and every number it may cite is
 * supplied (engine-computed) — it authors register, never arithmetic. Falls
 * back to deterministic templates when no ANTHROPIC_API_KEY (demo mode).
 */
async function draftNarrativeSections(facts: {
  subject: string;
  address: string;
  assetType: string;
  gdv: number;
  nia: number;
  profit: number;
  poc: number;
  planningStatus: string | null;
  compCount: number;
  supportedPsf: number | null;
  compAddresses: string[];
}): Promise<NarrativeSections> {
  const mv = Math.round(facts.gdv / 1000) * 1000; // Market Value — GDV to the nearest £1,000, as reported
  const psf = facts.nia > 0 ? Math.round(mv / facts.nia) : 0;
  const compLine = facts.compCount
    ? `${facts.compCount} adjusted comparable${facts.compCount === 1 ? '' : 's'} (${facts.compAddresses.join('; ')}) supporting ${facts.supportedPsf != null ? `£${facts.supportedPsf}/ft²` : 'the adopted rate'}`
    : 'no comparables logged — appraisal-led evidence only';
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    const instruction = `Write the three narrative sections of a RICS Red Book valuation report via record_narrative.

FACTS (use these figures verbatim — do not invent or recompute any number):
- Subject: ${facts.subject}, ${facts.address} (${facts.assetType.toLowerCase().replace('_', ' ')})
- Market Value opinion: ${gbp(mv)} (GDV ${gbp(facts.gdv)}; analysed rate £${psf}/ft² on ${Math.round(facts.nia).toLocaleString('en-GB')} ft² NIA)
- Forecast developer's profit: ${gbp(facts.profit)} (${(facts.poc * 100).toFixed(1)}% on cost)
- Planning status: ${facts.planningStatus ?? 'not assessed'}
- Comparable evidence: ${compLine}

RULES: each section 90-140 words; UK valuation-report register; third person ("the valuer", "the subject property") — no first person; plain prose, no markdown; each section MUST reference the deal's actual figures above (Market Value/GDV, supported £/ft², comparable count as relevant); valuationRationale MUST end with the Market Value opinion of ${gbp(mv)}.`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: NARRATIVE_MODEL,
        max_tokens: 2000,
        tools: [NARRATIVE_TOOL],
        tool_choice: { type: 'tool', name: 'record_narrative' },
        messages: [{ role: 'user', content: instruction }],
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { content: Array<{ type: string; input?: unknown }> };
      const toolUse = body.content.find((c) => c.type === 'tool_use');
      const parsed = zNarrativeSections.safeParse(toolUse?.input);
      if (parsed.success) return parsed.data;
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI narrative drafting returned an unusable response — try again.' });
    }
    // surface the real upstream reason (e.g. "credit balance too low") instead of a mystery failure
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `AI narrative drafting unavailable: ${err?.error?.message ?? `Anthropic API returned ${res.status}`}. Fix the API key/credits and try again.`,
    });
  }
  // demo fallback: deterministic templates interpolating the same engine figures
  const evidence = facts.compCount
    ? `${facts.compCount} adjusted comparable transaction${facts.compCount === 1 ? '' : 's'}, which support${facts.compCount === 1 ? 's' : ''} a rate of £${facts.supportedPsf}/ft²`
    : 'the current development appraisal, pending comparable evidence';
  return {
    marketCommentary:
      `The market for ${facts.assetType.toLowerCase().replace('_', ' ')} property in the locality of ${facts.subject} remains active, with steady occupier and investor demand and a limited supply of directly comparable stock. Pricing evidence is drawn from ${evidence}. Transaction volumes over the preceding twelve months have been stable and marketing periods for well-presented accommodation are typically six to eight weeks. Against a gross development value of ${gbp(facts.gdv)}${psf ? ` and an analysed rate of £${psf}/ft²` : ''}, the valuer considers current conditions to provide a reasonable evidential basis, and no material valuation uncertainty is reported as at the valuation date.`,
    valuationRationale:
      `Primary reliance is placed on the comparable method, cross-checked against the depreciated replacement cost and investment approaches. ${facts.compCount ? `The ${facts.compCount} comparable${facts.compCount === 1 ? '' : 's'} analysed support${facts.compCount === 1 ? 's' : ''} £${facts.supportedPsf}/ft², which applied to ${Math.round(facts.nia).toLocaleString('en-GB')} ft² of net internal area corroborates the appraisal-derived figure.` : 'In the absence of logged comparables, greatest weight is afforded to the residual development appraisal.'} The appraisal indicates a gross development value of ${gbp(facts.gdv)} and a forecast developer's profit of ${gbp(facts.profit)} (${(facts.poc * 100).toFixed(1)}% on cost), consistent with market-standard return requirements. Reconciling the approaches, the valuer's opinion of Market Value is ${gbp(mv)}.`,
    riskCommentary:
      `Planning status is recorded as ${(facts.planningStatus ?? 'not assessed').toLowerCase()}, and the valuation assumes all stated consents remain in effect. The principal risks to the reported figure of ${gbp(mv)} are movement in local sales rates${facts.supportedPsf ? ` away from the supported £${facts.supportedPsf}/ft²` : ''}, build-cost inflation compressing the ${(facts.poc * 100).toFixed(1)}% profit on cost, and any extension of the sales period. The evidence base of ${facts.compCount || 'no'} comparable${facts.compCount === 1 ? '' : 's'} is ${facts.compCount ? 'considered adequate for the class' : 'limited, and the figure should be read accordingly'}. No special assumptions have been made and no material valuation uncertainty is declared.`,
  };
}

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

const nullable = (t: string) => ({ type: [t, 'null'] });

/** JSON Schema for the forced tool call — mirrors zExtraction (nulls = "not stated"). */
const EXTRACTION_TOOL = {
  name: 'record_extraction',
  description: 'Record the development-appraisal inputs extracted from the documents. Use null for any value the documents do not state — never invent figures.',
  input_schema: {
    type: 'object',
    properties: {
      scheme: nullable('string'),
      address: nullable('string'),
      assetType: { type: ['string', 'null'], enum: ['industrial', 'residential', 'commercial', 'mixed', null] },
      units: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            count: { type: 'number' },
            area: { type: 'number', description: 'sqft per unit — midpoint of any range' },
            value: { type: 'number', description: '£ per sqft — midpoint of any range' },
            conf: { type: ['string', 'null'], enum: ['high', 'med', 'low', null], description: 'high = stated exactly; med = midpoint/inferred; low = weak evidence' },
            source: nullable('string'),
          },
          required: ['label', 'count', 'area', 'value'],
        },
      },
      efficiency: nullable('number'),
      profFee: nullable('number'),
      contingency: nullable('number'),
      finance: {
        type: 'object',
        properties: { ltc: nullable('number'), rate: nullable('number'), period: nullable('number'), sales: nullable('number'), arrFee: nullable('number') },
      },
      targetProfit: nullable('number'),
      asking: nullable('number'),
      cilPerSqm: nullable('number'),
      s106: nullable('number'),
      agent: nullable('number'),
      legal: nullable('number'),
      acq: nullable('number'),
      planningStatus: nullable('string'),
      planningRisk: { type: ['number', 'null'], minimum: 0, maximum: 100 },
      planningRiskLabel: nullable('string'),
      planningNotes: nullable('string'),
      recommendation: { type: ['string', 'null'], description: '2-3 sentence written view of the extraction/planning position (no computed money)' },
      confidence: nullable('string'),
    },
    required: ['units'],
  },
} as const;

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } };

/** Load data-room documents as Anthropic content blocks (PDFs + images, capped). */
async function documentBlocks(
  prisma: any,
  orgId: string,
  documentIds: string[],
): Promise<{ blocks: ContentBlock[]; used: Array<{ id: string; name: string; dealId: string }> }> {
  const { uploadPathFor } = await import('../uploads.js');
  const { readFile } = await import('node:fs/promises');
  const docs = await prisma.document.findMany({ where: { id: { in: documentIds }, orgId } });
  const blocks: ContentBlock[] = [];
  const used: Array<{ id: string; name: string; dealId: string }> = [];
  let totalBytes = 0;
  for (const doc of docs.slice(0, 4)) {
    const filePath = doc.url ? uploadPathFor(doc.url) : null;
    if (!filePath) continue;
    const ext = doc.ext.toLowerCase();
    const mediaType =
      ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : null;
    if (!mediaType) continue;
    let data: Buffer;
    try {
      data = await readFile(filePath);
    } catch {
      continue; // file missing on disk — skip, don't fail the whole extraction
    }
    if (totalBytes + data.length > 20 * 1024 * 1024) break; // 20MB request budget
    totalBytes += data.length;
    if (mediaType === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } });
    } else {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: data.toString('base64') } });
    }
    used.push({ id: doc.id, name: doc.name, dealId: doc.dealId });
  }
  return { blocks, used };
}

/**
 * Server-side LLM extraction — inputs only, never money. Reads the actual
 * uploaded documents (PDF drawings, cost plans, planning decisions) alongside
 * any typed notes. The model is FORCED through a tool call so its output is
 * schema-valid JSON by construction. Falls back to a deterministic parse of
 * the notes when no ANTHROPIC_API_KEY is configured (demo mode).
 */
async function extractFromNotes(notes: string, docBlocks: ContentBlock[] = [], docNames: string[] = []): Promise<Extraction> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    const instruction = `Extract the development-appraisal INPUTS via record_extraction from the attached documents${docNames.length ? ` (${docNames.join('; ')})` : ''}${notes.trim() ? ' and the notes below' : ''}. Extract inputs only — do NOT compute any financial outputs. Areas in sqft, values in £/ft², asking/s106 in absolute £. Every unit needs numeric count/area/value (midpoint of any range, conf reflecting how it was stated; source cites the document/page or note it came from). Anything the documents do not state: null.${notes.trim() ? `\n\nNOTES:\n${notes}` : ''}`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 6000,
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: 'tool', name: 'record_extraction' },
        messages: [
          {
            role: 'user',
            content: [...docBlocks, { type: 'text', text: instruction }],
          },
        ],
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { content: Array<{ type: string; input?: unknown }> };
      const toolUse = body.content.find((c) => c.type === 'tool_use');
      const parsed = zExtraction.safeParse(toolUse?.input);
      if (parsed.success && parsed.data.units.length > 0) return parsed.data;
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI extraction found no usable unit schedule in the notes — add unit counts/areas/values or use manual entry.' });
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
    .input(
      z
        .object({
          notes: z.string().default(''),
          documentIds: z.array(z.string()).max(4).default([]),
          buildPerSqft: z.number().positive().default(105),
        })
        .refine((v) => v.notes.trim().length >= 10 || v.documentIds.length > 0, {
          message: 'Provide scheme notes or select documents to read',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      let blocks: Awaited<ReturnType<typeof documentBlocks>> = { blocks: [], used: [] };
      if (input.documentIds.length > 0) {
        if (!process.env.ANTHROPIC_API_KEY) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reading documents needs the AI configured (ANTHROPIC_API_KEY) — paste the text as notes instead.' });
        }
        blocks = await documentBlocks(ctx.prisma, ctx.principal.orgId, input.documentIds);
        if (blocks.blocks.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'None of the selected documents are readable PDFs/images with a stored file.' });
        }
      }
      const extraction = await extractFromNotes(input.notes, blocks.blocks, blocks.used.map((d) => d.name));
      // successful read hardens the data-room status + audit trail
      for (const doc of blocks.used) {
        await ctx.prisma.document.update({ where: { id: doc.id }, data: { extraction: 'EXTRACTED' } });
        await ctx.prisma.activityEvent.create({
          data: { orgId: ctx.principal.orgId, dealId: doc.dealId, actor: 'AI Development Director', action: 'extracted scheme from', target: doc.name },
        });
      }
      return {
        extraction,
        indicative: indicative(extraction, input.buildPerSqft),
        documentsRead: blocks.used.map((d) => d.name),
      };
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
