import { TRPCError } from '@trpc/server';
import { unsupportedClaims, unsupportedFigures } from '../narrative-guard.js';
import { demoFallbacksAllowed } from '../demo-mode.js';
import { z } from 'zod';
import {
  autoAppraise,
  compareAppraisals,
  computeAppraisal,
  testCovenants,
  jvWaterfall,
  sensitivityGrid,
  weightedComparables,
  type AppraisalResult,
} from '@apex/appraisal-engine';
import { zAppraisalInput, zExtraction, type Extraction } from '@apex/types';
import { appraisalRowToEngineInput, J, P, toPence } from '../mappers.js';
import { AI_ACTOR, AI_NONE_STATEMENT, AI_STANDING_STATEMENT, AI_TOUCHPOINTS } from '../ai-disclosure.js';
import { adminProcedure, internalProcedure, requiresFeature, router } from '../trpc.js';
import { assertOwned } from '../auth/owned.js';
import { locate } from '../opendata-cache.js';
import { recordAudit } from '../audit.js';
import { SHARE_DEFAULT_DAYS, SHARE_MAX_DAYS, newShareToken, shareRefusal } from '../share.js';
import { signDownloadToken } from '../download-token.js';
import { emitWebhook } from '../webhook-delivery.js';
import { assertUnchanged } from '../optimistic.js';
import { SCENARIO_ASSUMPTIONS, scenarioMetrics } from '@apex/appraisal-engine';

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

/**
 * The deal card's headline figures, which are the CURRENT appraisal's.
 *
 * The pipeline board, the Hub and the deal card all read these columns rather
 * than running the engine, so anything that changes which version is current
 * has to write them. `save` did. `restore` did not — so restoring a prudent
 * appraisal to undo an optimistic one left the whole firm's pipeline showing
 * the version that had just been replaced, until somebody happened to save
 * again. Measured: current appraisal GDV £3,150,000, deal card £4,500,000, and
 * `deals.exposure` — which recomputes from the appraisal row — disagreeing with
 * the board about the same deal.
 *
 * One function, because a rule written in two places is one place away from
 * being written in one.
 */
async function syncDealHeadline(prisma: any, dealId: string, result: { gdv: number; profit: number; poc: number; equity: number }) {
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      gdv: toPence(result.gdv),
      forecastProfit: toPence(result.profit),
      roc: result.poc,
      equityRequired: toPence(result.equity),
      viability: result.poc >= 0.17 ? 'PROCEED' : result.poc >= 0.1 ? 'CAUTION' : 'DECLINE',
    },
  });
}

/** persistence payload for appraisal inputs (money £ → pence) */
function inputToRow(input: z.infer<typeof zAppraisalInput>) {
  return {
    efficiency: input.efficiency,
    units: JSON.stringify(input.units),
    trades: JSON.stringify(input.trades),
    // amounts persist in pence; timing rides along untouched
    otherCosts: JSON.stringify(input.otherCosts.map((o) => ({ label: o.label, amount: Math.round(o.amount * 100), timing: o.timing }))),
    profFeePct: input.profFeePct,
    contingencyPct: input.contingencyPct,
    ltcPct: input.finance.ltcPct,
    ratePct: input.finance.ratePct,
    /**
     * The mezzanine tranche. These columns existed and were written only by the
     * seed — the appraisal page held the terms in component state, so changing
     * the mezzanine rate did not even mark the appraisal dirty.
     */
    mezzToPct: input.finance.mezz?.toPct ?? null,
    mezzRatePct: input.finance.mezz?.ratePct ?? null,
    drawFactorPct: input.finance.mezz?.drawFactorPct ?? 55,
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
    phases: input.phases?.length ? JSON.stringify(input.phases) : null,
    income: input.income ? JSON.stringify(input.income) : null,
    dcf: input.dcf ? JSON.stringify(input.dcf) : null,
    jvGpCoinvestPct: input.jv?.gpCoinvestPct ?? 10,
    jvPrefPct: input.jv?.prefPct ?? 8,
    jvPromotePct: input.jv?.promotePct ?? 20,
    startYear: input.startYear ?? null,
    startMonth: input.startMonth ?? null,
  };
}

/**
 * The AI Development Director — every language-model touchpoint in this file.
 *
 * Growth and above. Starter buys "Appraisal engine + reports" and the landing
 * page says so in as many words: "or do it all by hand. Your call." The engine,
 * the reports and every deterministic figure stay open on every plan; what a
 * Starter subscriber does not get is the model reading the documents for them.
 */
const aiProcedure = internalProcedure.use(requiresFeature('aiDirector'));

/**
 * The rule that gives approval its meaning.
 *
 * Editing an approved version in place would change what somebody signed off
 * without anyone signing off on the change — and the version history would show
 * no trace of it. The way forward is a new version, which starts as a draft and
 * has to be approved on its own merits.
 *
 * This lived inside `save`, which is where the defect had been found rather than
 * where the rule belongs, and `save` is not the only procedure that writes an
 * appraisal row. `comparables.applyToAppraisal` sets every unit cap on the
 * current version, and `draftNarrative` replaces the Red Book prose and its
 * AI-use disclosure; neither asked. Measured on one approved valuation:
 *
 *     reviewStatus       approved  (unchanged)
 *     GDV      £3,150,000  ->  £5,250,000
 *     profit     £630,000  ->  £1,050,000
 *     residual £1,197,577  ->  £2,731,285
 *     versions           1  (no new version, no trace)
 *
 * The residual is what a developer bids on a site with. It more than doubled on
 * a valuation a named valuer had signed, and the version still read approved.
 *
 * `approved-immutable.test.ts` walks the router for any OTHER mutation that
 * writes an appraisal row, so the next one cannot arrive without answering this.
 */
function assertNotApproved(row: { reviewStatus: string | null; label: string }) {
  if (row.reviewStatus === 'approved') {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `“${row.label}” has been approved and cannot be edited. Save your changes as a new version.`,
    });
  }
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
      /** the token an in-place save has to hand back — see save.expectedUpdatedAt */
      updatedAt: row.updatedAt,
      /**
       * When this version was signed off, and whether it was.
       *
       * A printed report needs a date of its own or it dates itself from the
       * reader's clock — which is what both documents did, so a valuation
       * re-dated itself every time anybody opened it. An approved version has a
       * real signing date; a draft has only the moment it was last saved.
       */
      reviewStatus: row.reviewStatus,
      reviewedAt: row.reviewedAt,
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
        /** why this version exists — the half of a review a diff cannot supply */
        note: z.string().max(500).optional(),
        /**
         * The updatedAt of the version the caller was looking at.
         *
         * Required for an in-place edit of an existing version, and checked
         * before the write. Without it two analysts on one deal — which is the
         * collaboration a ten-seat plan sells — silently overwrite each other:
         * the second save carries EVERY field from a copy loaded before the
         * first, so the first person's work disappears with no version, no
         * conflict and no audit event. On a valuation workfile whose version
         * history is the evidence trail, a change that leaves no trace is the
         * exact thing the approved-version rule further down exists to prevent.
         */
        expectedUpdatedAt: z.coerce.date().optional(),
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
        /**
         * Stand down the old version and raise the new one together.
         *
         * These were two statements. Two callers branching at once both read the
         * same current row, both flipped it, and both created — leaving TWO rows
         * marked current, after which "the current appraisal" is whichever
         * findFirst happened to return. Measured: it produced exactly that.
         *
         * The transaction is not what fixes it. The compare-and-set is: the flip
         * only counts if this call is the one that found it current, which is the
         * same technique the webhook claim lease uses. The transaction is so a
         * failure between the two cannot leave a deal with no current version at
         * all.
         */
        row = await ctx.prisma.$transaction(async (tx) => {
          const { count } = await tx.appraisal.updateMany({
            where: { id: existing.id, isCurrent: true },
            data: { isCurrent: false },
          });
          if (count !== 1) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Somebody else saved a new version a moment ago. Reload to see it, then branch from there.',
            });
          }
          return tx.appraisal.create({
            data: {
              ...data,
              orgId: ctx.principal.orgId,
              dealId: input.dealId,
              isCurrent: true,
              label: input.label?.trim() || `v${(await tx.appraisal.count({ where: { dealId: input.dealId, orgId: ctx.principal.orgId } })) + 1}`,
              note: input.note?.trim() || null,
            },
          });
        });
      } else if (existing) {
        assertNotApproved(existing);
        /**
         * Editing a version that is out for review takes it back off the reviewer's
         * desk. Left in review it would be approved in a state nobody read — the
         * reviewer opened one set of figures and signed a different one.
         *
         * Withdrawn rather than refused: the analyst is mid-thought, and blocking
         * the save would only teach them to stop submitting until they are certain.
         */
        /**
         * Whose copy is this?
         *
         * Demanded rather than merely checked when present: a caller that forgets
         * gets a clear refusal, where an optional token silently reopens the hole
         * for whoever forgets next. Not needed to CREATE a version or to branch a
         * new one — only to edit a row somebody else may be holding.
         *
         * Compared to the millisecond, which is what @updatedAt records. Two
         * saves inside the same millisecond would still race; that is a window
         * far shorter than a person, and the consequence is only the behaviour
         * this replaces.
         */
        await assertUnchanged({
          what: `version “${existing.label}”`,
          current: existing.updatedAt,
          expected: input.expectedUpdatedAt,
          lastActor: async () =>
            existing.submittedById
              ? (await ctx.prisma.user.findUnique({ where: { id: existing.submittedById }, select: { name: true } }))?.name
              : null,
          advice: 'Reload to see the current figures, then reapply your changes — or save yours as a new version.',
        });

        const withdrawn = existing.reviewStatus === 'in_review';
        row = await ctx.prisma.appraisal.update({
          where: { id: existing.id },
          data: withdrawn
            ? { ...data, reviewStatus: 'draft', submittedById: null, submittedAt: null }
            : data,
        });
        if (withdrawn) {
          await recordAudit(ctx.prisma, {
            orgId: ctx.principal.orgId, dealId: input.dealId, userId: ctx.principal.userId, actor: ctx.principal.name,
            action: 'edited a version that was in review, withdrawing it', target: existing.label, ip: ctx.ip,
          });
        }
      } else {
        row = await ctx.prisma.appraisal.create({
          data: { ...data, orgId: ctx.principal.orgId, dealId: input.dealId, isCurrent: true, label: input.label?.trim() || 'Base' },
        });
      }
      await syncDealHeadline(ctx.prisma, input.dealId, result);
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
      // updatedAt so a client can save again without waiting for a refetch to
      // tell it what the stamp is now
      return { id: row.id, updatedAt: row.updatedAt, result, jv };
    }),

  /** Version history with headline figures for comparison (newest first). */
  versions: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    const rows = await ctx.prisma.appraisal.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, label: true, note: true, source: true, isCurrent: true, createdAt: true, updatedAt: true, resultCache: true,
        reviewStatus: true, submittedById: true, submittedAt: true, reviewedById: true, reviewedAt: true, reviewNote: true,
      },
    });
    // one lookup for every actor on the list, so a version row never has to say
    // "user cmxyz…" to a reader
    const actorIds = [...new Set(rows.flatMap((r) => [r.submittedById, r.reviewedById]).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await ctx.prisma.user.findMany({ where: { id: { in: actorIds }, orgId: ctx.principal.orgId }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(actors.map((u) => [u.id, u.name]));

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
      return {
        id: r.id, label: r.label, note: r.note, source: r.source, isCurrent: r.isCurrent,
        createdAt: r.createdAt, updatedAt: r.updatedAt, headline,
        review: {
          status: r.reviewStatus,
          submittedBy: r.submittedById ? (nameOf.get(r.submittedById) ?? 'A former colleague') : null,
          submittedAt: r.submittedAt,
          reviewedBy: r.reviewedById ? (nameOf.get(r.reviewedById) ?? 'A former colleague') : null,
          reviewedAt: r.reviewedAt,
          note: r.reviewNote,
          // stated rather than left to be inferred from two names being equal:
          // a sole practitioner approving their own work is legitimate, and the
          // record should say so plainly rather than hide it
          selfApproved: !!r.reviewedById && r.reviewedById === r.submittedById,
        },
      };
    });
  }),

  /**
   * What is waiting — across every deal.
   *
   * The workflow is worthless if you have to open a deal to discover something
   * needs you. Two lists, because they are two different jobs: work waiting on
   * YOUR decision, and your own work that came back.
   *
   * The review list is empty for non-admins rather than hidden, because only
   * admins can decide — showing an analyst a queue they cannot act on would be
   * noise dressed as a task.
   */
  reviewQueue: internalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.appraisal.findMany({
      where: {
        orgId: ctx.principal.orgId,
        OR: [
          { reviewStatus: 'in_review' },
          { reviewStatus: 'changes_requested', submittedById: ctx.principal.userId },
        ],
      },
      orderBy: { submittedAt: 'asc' }, // oldest first: a queue is a queue
      select: {
        id: true, dealId: true, label: true, note: true, reviewStatus: true,
        submittedById: true, submittedAt: true, reviewNote: true, resultCache: true,
      },
      take: 100,
    });
    if (!rows.length) return { awaitingReview: [], returnedToMe: [] };

    const [deals, actors] = await Promise.all([
      ctx.prisma.deal.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.dealId))] }, orgId: ctx.principal.orgId },
        select: { id: true, name: true },
      }),
      ctx.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.submittedById).filter((x): x is string => !!x))] }, orgId: ctx.principal.orgId },
        select: { id: true, name: true },
      }),
    ]);
    const dealName = new Map(deals.map((d) => [d.id, d.name]));
    const actorName = new Map(actors.map((u) => [u.id, u.name]));

    const shape = (r: (typeof rows)[number]) => {
      let headline: { gdv: number; profit: number; poc: number } | null = null;
      try {
        const c = r.resultCache ? (JSON.parse(r.resultCache) as { result: { gdv: number; profit: number; poc: number } }) : null;
        if (c?.result) headline = { gdv: c.result.gdv, profit: c.result.profit, poc: c.result.poc };
      } catch {
        headline = null;
      }
      return {
        id: r.id,
        dealId: r.dealId,
        dealName: dealName.get(r.dealId) ?? 'Unknown deal',
        label: r.label,
        note: r.note,
        reviewNote: r.reviewNote,
        submittedBy: r.submittedById ? (actorName.get(r.submittedById) ?? 'A former colleague') : null,
        submittedAt: r.submittedAt,
        headline,
      };
    };

    return {
      awaitingReview: ctx.principal.role === 'ADMIN' ? rows.filter((r) => r.reviewStatus === 'in_review').map(shape) : [],
      returnedToMe: rows.filter((r) => r.reviewStatus === 'changes_requested').map(shape),
    };
  }),

  /**
   * A token for one document, for two minutes — see src/download-token.ts.
   *
   * The browser cannot set a header when it opens a PDF in a new tab, so the
   * credential travels in the URL. It used to be the user's session token.
   */
  downloadToken: internalProcedure
    .input(
      z.object({
        kind: z.enum(['appraisal', 'redbook', 'engagement', 'portfolio']),
        dealId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // a portfolio document covers the whole org; everything else is one deal,
      // and ownership is checked here rather than trusted from the token later
      if (input.kind !== 'portfolio') {
        if (!input.dealId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'dealId required' });
        await assertDeal(ctx, input.dealId);
      }
      return {
        token: signDownloadToken({ sub: ctx.principal.userId, kind: input.kind, dealId: input.dealId }),
      };
    }),

  /**
   * A read-only link to this deal's report, for someone with no account.
   *
   * Returns the raw token ONCE, here, at creation. It is stored hashed, so this
   * is the only moment it can be shown — which is the point: the server cannot
   * later hand out a working link to anyone who asks nicely.
   */
  createShare: internalProcedure
    .input(
      z.object({
        dealId: z.string(),
        kind: z.enum(['appraisal', 'redbook']),
        days: z.number().int().min(1).max(SHARE_MAX_DAYS).default(SHARE_DEFAULT_DAYS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await assertDeal(ctx, input.dealId);
      const { token, tokenHash } = newShareToken();
      const expiresAt = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);
      const share = await ctx.prisma.reportShare.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: input.dealId,
          kind: input.kind,
          tokenHash,
          expiresAt,
          createdById: ctx.principal.userId,
        },
      });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, dealId: input.dealId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'shared a report by link', target: `${deal.name} — ${input.kind}`, ip: ctx.ip,
      });
      // never the token: a webhook payload is a copy of the link, and the link IS
      // the credential — anyone holding the delivery would hold the report
      await emitWebhook(ctx.prisma, ctx.principal.orgId, 'report.shared', {
        dealId: input.dealId,
        dealName: deal.name,
        shareId: share.id,
        kind: input.kind,
        sharedBy: ctx.principal.name,
        expiresAt,
      });
      return { id: share.id, token, expiresAt };
    }),

  shares: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    const rows = await ctx.prisma.reportShare.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    // no tokenHash in the response: it is not the token, but it is also not
    // anything a screen needs, and hashes have a way of being treated as secrets
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
      viewCount: r.viewCount,
      lastViewedAt: r.lastViewedAt,
      state: shareRefusal(r) ?? 'live',
    }));
  }),

  revokeShare: internalProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const share = await assertOwned(ctx.prisma.reportShare, input.id, ctx.principal.orgId);
    // idempotent: withdrawing an already-withdrawn link is not an error, and a
    // second click in a panicked moment should not show a failure
    if (!share.revokedAt) {
      await ctx.prisma.reportShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, dealId: share.dealId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'revoked a shared report link', target: share.kind, ip: ctx.ip,
      });
    }
    return { ok: true };
  }),

  /**
   * Send a version to be reviewed.
   *
   * Any internal member may submit — drafting is the analyst's job and asking for
   * a second pair of eyes should never need permission.
   */
  submitForReview: internalProcedure
    .input(z.object({ versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const v = await assertOwned(ctx.prisma.appraisal, input.versionId, ctx.principal.orgId);
      if (v.reviewStatus === 'approved') {
        throw new TRPCError({ code: 'CONFLICT', message: 'That version is already approved.' });
      }
      const row = await ctx.prisma.appraisal.update({
        where: { id: v.id },
        data: {
          reviewStatus: 'in_review',
          submittedById: ctx.principal.userId,
          submittedAt: new Date(),
          // a resubmission clears the previous decision: the note referred to a
          // version that no longer exists in that form
          reviewedById: null,
          reviewedAt: null,
          reviewNote: null,
        },
      });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, dealId: v.dealId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: 'submitted an appraisal version for review', target: v.label, ip: ctx.ip,
      });
      const submittedDeal = await ctx.prisma.deal.findUnique({ where: { id: v.dealId }, select: { name: true } });
      await emitWebhook(ctx.prisma, ctx.principal.orgId, 'appraisal.submitted', {
        dealId: v.dealId,
        dealName: submittedDeal?.name ?? null,
        appraisalId: row.id,
        label: row.label,
        submittedBy: ctx.principal.name,
        submittedAt: row.submittedAt,
      });
      return { id: row.id, status: row.reviewStatus };
    }),

  /**
   * Approve a version, or send it back.
   *
   * ADMIN only. In a valuation firm the sign-off carries professional
   * responsibility, so it is deliberately not something every seat can do.
   *
   * Self-approval is ALLOWED and RECORDED. A sole practitioner is a real customer
   * and blocking them would make the feature unusable for the smallest firms; the
   * honest answer is to let it happen and say so on the record, so a reader can
   * see that one person did both.
   */
  review: adminProcedure
    .input(
      z.object({
        versionId: z.string(),
        decision: z.enum(['approve', 'request_changes']),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const v = await assertOwned(ctx.prisma.appraisal, input.versionId, ctx.principal.orgId);
      if (v.reviewStatus !== 'in_review') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `“${v.label}” is ${v.reviewStatus.replace('_', ' ')} — only a version in review can be decided on.`,
        });
      }
      // sending work back without saying why wastes the next round trip
      if (input.decision === 'request_changes' && !input.note?.trim()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Say what needs changing.' });
      }
      const status = input.decision === 'approve' ? 'approved' : 'changes_requested';
      const row = await ctx.prisma.appraisal.update({
        where: { id: v.id },
        data: { reviewStatus: status, reviewedById: ctx.principal.userId, reviewedAt: new Date(), reviewNote: input.note?.trim() || null },
      });
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, dealId: v.dealId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: input.decision === 'approve' ? 'approved an appraisal version' : 'requested changes to an appraisal version',
        target: v.label, ip: ctx.ip,
      });
      /**
       * Tell anyone who asked. Queued, not delivered here: approving a valuation
       * must not wait on someone else's server, nor fail because it is down.
       */
      if (input.decision === 'approve') {
        const deal = await ctx.prisma.deal.findUnique({ where: { id: v.dealId }, select: { name: true } });
        const result = computeAppraisal(appraisalRowToEngineInput(row));
        await emitWebhook(ctx.prisma, ctx.principal.orgId, 'appraisal.approved', {
          dealId: v.dealId,
          dealName: deal?.name ?? null,
          appraisalId: row.id,
          label: row.label,
          approvedBy: ctx.principal.name,
          approvedAt: row.reviewedAt,
          gdv: Math.round(result.gdv * 100) / 100,
          profit: Math.round(result.profit * 100) / 100,
          profitOnCost: result.poc,
        });

        /**
         * And separately, if the figures just approved break one of the firm's
         * own facility covenants.
         *
         * Emitted at APPROVAL rather than on every save, because approval is the
         * firm's committed position and that is what a lender's covenant applies
         * to — a draft that dips under a limit for an afternoon is not a breach,
         * and reporting it as one would train everybody to ignore the alert.
         * Approval is also discrete, so this needs no stored previous state to
         * avoid re-sending the same breach.
         *
         * The alert nobody was getting: this event has been offered to
         * integrators since outbound webhooks shipped — an endpoint could
         * subscribe, and org.createWebhook would accept it — and nothing has ever
         * emitted it. A lender's system watching for a breach heard silence, and
         * silence from a covenant monitor reads as "no breaches".
         */
        const policy = await ctx.prisma.orgPolicy.findUnique({ where: { orgId: ctx.principal.orgId } });
        const covenants = testCovenants(
          { facility: result.facility, totalCost: result.totalCost, gdv: result.gdv, profit: result.profit },
          {
            ltgdvMaxPct: policy?.covLtgdvMaxPct ?? null,
            ltcMaxPct: policy?.covLtcMaxPct ?? null,
            minProfitOnCostPct: policy?.covMinProfitOnCostPct ?? null,
          },
        );
        if (covenants.breaches.length > 0) {
          await emitWebhook(ctx.prisma, ctx.principal.orgId, 'covenant.breached', {
            dealId: v.dealId,
            dealName: deal?.name ?? null,
            appraisalId: row.id,
            label: row.label,
            approvedBy: ctx.principal.name,
            approvedAt: row.reviewedAt,
            breaches: covenants.breaches.map((b) => ({
              key: b.key,
              label: b.label,
              actualPct: Math.round(b.actualPct * 100) / 100,
              limitPct: b.limitPct,
              direction: b.direction,
              headroomPts: Math.round(b.headroomPts * 100) / 100,
            })),
          });
        }
      }
      return { id: row.id, status: row.reviewStatus };
    }),

  /**
   * What changed between two versions, and what it did to the answer.
   *
   * The impact figures are RE-COMPUTED from both versions' inputs rather than
   * read from each row's stored resultCache. A cache records what the engine said
   * on the day it was written, so comparing two caches can show a difference that
   * is really an engine change between the two saves — which is exactly the sort
   * of phantom a reviewer must never be shown.
   */
  compare: internalProcedure
    .input(z.object({ fromId: z.string(), toId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [from, to] = await Promise.all([
        ctx.prisma.appraisal.findFirst({ where: { id: input.fromId, orgId: ctx.principal.orgId } }),
        ctx.prisma.appraisal.findFirst({ where: { id: input.toId, orgId: ctx.principal.orgId } }),
      ]);
      if (!from || !to) throw new TRPCError({ code: 'NOT_FOUND' });
      if (from.dealId !== to.dealId) {
        // comparing versions across deals would produce a diff that looks
        // authoritative and means nothing
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Those versions belong to different deals' });
      }

      const beforeInput = appraisalRowToEngineInput(from);
      const afterInput = appraisalRowToEngineInput(to);
      const b = computeAppraisal(beforeInput);
      const a = computeAppraisal(afterInput);

      return {
        from: { id: from.id, label: from.label, note: from.note, at: from.updatedAt },
        to: { id: to.id, label: to.label, note: to.note, at: to.updatedAt },
        diff: compareAppraisals(beforeInput, afterInput),
        impact: {
          gdv: { before: b.gdv, after: a.gdv },
          totalCost: { before: b.totalCost, after: a.totalCost },
          profit: { before: b.profit, after: a.profit },
          poc: { before: b.poc, after: a.poc },
          residualNet: { before: b.residualNet, after: a.residualNet },
        },
      };
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
    /**
     * Stand the old version down and raise the restored one together, with the
     * same compare-and-set `save` uses for a branch. These were two loose
     * statements: two callers restoring at once both read the same current row,
     * both flipped it and both created, leaving TWO rows marked current — after
     * which "the current appraisal" is whichever findFirst happened to return.
     *
     * The current row is read OUTSIDE the transaction, exactly as `save` reads
     * it, so the flip is a genuine compare-and-set against what this caller saw.
     * Reading it inside would make the race impossible on SQLite by
     * serialisation alone — which passes the test and leaves the guard that
     * production actually needs unexercised.
     */
    const existingCurrent = await ctx.prisma.appraisal.findFirst({
      where: { dealId: input.dealId, orgId: ctx.principal.orgId, isCurrent: true },
    });
    const restored = await ctx.prisma.$transaction(async (tx) => {
      if (existingCurrent) {
        const { count } = await tx.appraisal.updateMany({
          where: { id: existingCurrent.id, isCurrent: true },
          data: { isCurrent: false },
        });
        if (count !== 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Somebody else changed the current version a moment ago. Reload to see it, then restore from there.',
          });
        }
      }
      /**
       * A restored version is a NEW version and starts as a draft.
       *
       * The review fields were copied along with everything else, so restoring
       * an approved version produced a fresh row asserting it had been approved
       * — by that person, on that date — when nobody had seen this row at all.
       * `save` already refuses to carry an approval onto a branch, and the
       * review tests state the rule: "a new version inherits no approval — it
       * has to earn its own."
       */
      const {
        id: _id,
        createdAt: _c,
        updatedAt: _u,
        reviewStatus: _rs,
        reviewedById: _rb,
        reviewedAt: _ra,
        reviewNote: _rn,
        submittedById: _sb,
        submittedAt: _sa,
        ...copy
      } = version;
      return tx.appraisal.create({
        data: { ...copy, isCurrent: true, label: `${version.label} (restored)` },
      });
    });
    /**
     * The deal card is derived from whichever version is current, so restoring
     * one has to move it. Without this the board kept the replaced version's
     * GDV for good.
     */
    await syncDealHeadline(ctx.prisma, input.dealId, computeAppraisal(appraisalRowToEngineInput(restored)));
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
   * AI-use disclosure for a deal, derived from the audit trail rather than
   * declared by hand — RICS professional standards require valuers to be
   * transparent about whether and how AI was used, so the report states it and
   * this is where the statement comes from. Every AI touchpoint writes an
   * ActivityEvent under the 'AI Development Director' actor; anything absent
   * from that trail is absent from the disclosure.
   */
  aiDisclosure: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    await assertDeal(ctx, input);
    const events = await ctx.prisma.activityEvent.findMany({
      where: { dealId: input, orgId: ctx.principal.orgId, actor: AI_ACTOR },
      orderBy: { at: 'desc' },
    });
    const items = AI_TOUCHPOINTS.map((t) => {
      const matching = events.filter((e: { action: string }) => e.action === t.action);
      return {
        key: t.key,
        label: t.label,
        purpose: t.purpose,
        count: matching.length,
        lastUsed: matching.length ? (matching[0] as { at: Date }).at.toISOString() : null,
      };
    }).filter((t) => t.count > 0);

    const [row, policy] = await Promise.all([
      ctx.prisma.appraisal.findFirst({
        where: { dealId: input, orgId: ctx.principal.orgId, isCurrent: true },
        orderBy: { updatedAt: 'desc' },
      }),
      ctx.prisma.orgPolicy.findUnique({ where: { orgId: ctx.principal.orgId } }),
    ]);
    const narrative = J<NarrativePayload | null>(row?.narrative, null);
    return {
      used: items.length > 0,
      items,
      // the firm's own policy note ADDS to the standing statement; it never
      // replaces it, because that statement is a fact about how the engine works
      firmPolicy: policy?.aiPolicy?.trim() || null,
      // the model that drafted the prose currently reproduced in the report
      model: narrative?.model ?? null,
      narrativeEmbedded: !!narrative,
      narrativeDraftedAt: narrative?.generatedAt ?? null,
      statement: items.length > 0 ? AI_STANDING_STATEMENT : AI_NONE_STATEMENT,
    };
  }),

  /**
   * AI-drafted Red Book narrative — market commentary, valuation rationale and
   * risk commentary. Every figure comes from the deterministic engine; the LLM
   * only writes prose around them. Persisted onto the current appraisal so the
   * report renders the same narrative until it is redrafted.
   */
  draftNarrative: aiProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const deal = await assertDeal(ctx, input);
    const row = await ctx.prisma.appraisal.findFirst({
      where: { dealId: input, orgId: ctx.principal.orgId, isCurrent: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No current appraisal to draft a narrative from — save an appraisal first.' });
    // the narrative IS the Red Book prose, and it carries the AI-use disclosure
    assertNotApproved(row);
    const engineInput = appraisalRowToEngineInput(row);
    const { result } = fullResult({ ...engineInput, jv: engineInput.jv! } as z.infer<typeof zAppraisalInput>);
    const comps = await ctx.prisma.comparable.findMany({ where: { dealId: input, orgId: ctx.principal.orgId } });
    /**
     * The instruction's own terms. A special assumption is what determines what
     * the figure MEANS — "assuming planning is granted" can move a value by
     * millions — and the narrative was denying them unconditionally.
     */
    const terms = await ctx.prisma.engagementTerms.findFirst({ where: { dealId: input, orgId: ctx.principal.orgId } });
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
      specialAssumptions: statedSpecialAssumptions(terms?.specialAssumptions),
    });
    /**
     * Provenance from what actually produced the prose, not from what is
     * configured.
     *
     * This read `process.env.ANTHROPIC_API_KEY ? NARRATIVE_MODEL : 'demo'`,
     * which is a fact about the deployment rather than about the words on the
     * page. Two ways it was wrong, both in the AI-use disclosure of a signed
     * Red Book valuation — the section whose entire job is to be accurate about
     * this:
     *
     *   with no key, the report declared "Artificial intelligence was used in
     *   preparing this valuation" over prose a template wrote;
     *
     *   with a key, when the figure guard rejected the model's draft and the
     *   template was used instead, the report NAMED the model that had not
     *   written the sentences it was being credited with.
     */
    const { source, ...sections_ } = sections;
    const payload: NarrativePayload = {
      ...sections_,
      generatedAt: new Date().toISOString(),
      model: source === 'model' ? NARRATIVE_MODEL : 'template',
    };
    await ctx.prisma.appraisal.update({ where: { id: row.id }, data: { narrative: JSON.stringify(payload) } });
    /**
     * The disclosure is derived from this event — aiDisclosure filters the audit
     * trail on AI_ACTOR — so filing one for a template is how a valuation came
     * to declare an AI use that never happened. The drafting is still recorded,
     * under the person who asked for it, because the audit trail should say a
     * narrative was produced either way.
     */
    await ctx.prisma.activityEvent.create({
      data: {
        orgId: ctx.principal.orgId,
        dealId: input,
        actor: source === 'model' ? AI_ACTOR : ctx.principal.name,
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
 * The special assumptions actually stated in the terms of engagement, or null.
 *
 * The terms carry clause 11 as free text and the house-style default is the
 * word "None." — so a firm that has not set one is not making one. Anything
 * else is a stated special assumption, and the report has to say so: measured
 * on a real instruction whose terms read "That full planning permission for 10
 * dwellings is granted ... and that the site is free of contamination", the
 * Red Book narrative printed "No special assumptions have been made."
 *
 * Two documents in the same product, on the same instruction, contradicting
 * each other on the one clause that says what the valuation figure means.
 */
export function statedSpecialAssumptions(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  // "None", "None.", "none", "N/A" — a firm saying there are none, not making one
  if (/^(none|n\/?a|nil|not applicable)\.?$/i.test(text)) return null;
  return text;
}

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
  /**
   * The special assumptions from the terms of engagement, or null where the
   * terms state none. Clause 11 of the signed terms, and the narrative used to
   * deny them unconditionally — see the risk commentary below.
   */
  specialAssumptions: string | null;
}): Promise<NarrativeSections & { source: 'model' | 'template' }> {
  const mv = Math.round(facts.gdv / 1000) * 1000; // Market Value — GDV to the nearest £1,000, as reported
  const psf = facts.nia > 0 ? Math.round(mv / facts.nia) : 0;
  const compLine = facts.compCount
    ? `${facts.compCount} adjusted comparable${facts.compCount === 1 ? '' : 's'} (${facts.compAddresses.join('; ')}) supporting ${facts.supportedPsf != null ? `£${facts.supportedPsf}/ft²` : 'the adopted rate'}`
    : 'no comparables logged — appraisal-led evidence only';
  const key = process.env.ANTHROPIC_API_KEY;
  /** figures the model wrote that the engine did not produce — logged, then the draft is dropped */
  const narrativeRejections: string[] = [];
  if (key) {
    const instruction = `Write the three narrative sections of a RICS Red Book valuation report via record_narrative.

FACTS (use these figures verbatim — do not invent or recompute any number):
- Subject: ${facts.subject}, ${facts.address} (${facts.assetType.toLowerCase().replace('_', ' ')})
- Market Value opinion: ${gbp(mv)} (GDV ${gbp(facts.gdv)}; analysed rate £${psf}/ft² on ${Math.round(facts.nia).toLocaleString('en-GB')} ft² NIA)
- Forecast developer's profit: ${gbp(facts.profit)} (${(facts.poc * 100).toFixed(1)}% on cost)
- Planning status: ${facts.planningStatus ?? 'not assessed'}
- Comparable evidence: ${compLine}
- Special assumptions agreed in the terms of engagement: ${facts.specialAssumptions ?? 'none stated'}

RULES: each section 90-140 words; UK valuation-report register; third person ("the valuer", "the subject property") — no first person; plain prose, no markdown; each section MUST reference the deal's actual figures above (Market Value/GDV, supported £/ft², comparable count as relevant); valuationRationale MUST end with the Market Value opinion of ${gbp(mv)}.

DO NOT ASSERT WHAT IS NOT ABOVE. Specifically: do not state transaction volumes, marketing periods, demand levels, supply of comparable stock, or any other market condition — none of it has been measured, and this goes into a signed valuation. Do not declare the evidence base adequate; state its extent and leave the judgement to the valuer. State the special assumptions exactly as given, and say none are made only when the line above says none stated.`;
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
      if (parsed.success) {
        /**
         * The model was told to use the engine's figures verbatim. This checks it
         * did. A draft that carries a figure nobody calculated is discarded for
         * the deterministic template below, which interpolates the same numbers
         * and cannot drift — losing some prose quality rather than putting an
         * invented Market Value into a signed valuation.
         */
        const sections = parsed.data as unknown as Record<string, string>;
        const unsupported = [
          ...unsupportedFigures(sections, {
            money: [mv, facts.gdv, facts.profit, psf, ...(facts.supportedPsf != null ? [facts.supportedPsf] : [])],
            percents: [Number((facts.poc * 100).toFixed(1))],
          }),
          /**
           * And what it CLAIMED. The prompt's rules about market conditions, the
           * adequacy of the evidence and clause 11 were enforced by nothing —
           * and none of those sentences carries a figure, so the check above
           * cannot see them. Same disposal: fall back to the template, which
           * makes none of them.
           */
          ...unsupportedClaims(sections, { specialAssumptions: facts.specialAssumptions }),
        ];
        if (unsupported.length === 0) return { ...parsed.data, source: 'model' as const };
        narrativeRejections.push(...unsupported);
      } else {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI narrative drafting returned an unusable response — try again.' });
      }
    }
    else {
      // surface the real upstream reason (e.g. "credit balance too low") instead of a mystery failure
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `AI narrative drafting unavailable: ${err?.error?.message ?? `Anthropic API returned ${res.status}`}. Fix the API key/credits and try again.`,
      });
    }
  }
  /**
   * Deterministic templates interpolating the same engine figures. Used in demo
   * mode, and whenever a model draft carried a figure the engine did not produce.
   */
  if (narrativeRejections.length) {
    console.warn(`[narrative] draft discarded — not supported by the record: ${narrativeRejections.join(', ')}`);
  }
  const evidence = facts.compCount
    ? `${facts.compCount} adjusted comparable transaction${facts.compCount === 1 ? '' : 's'}, which support${facts.compCount === 1 ? 's' : ''} a rate of £${facts.supportedPsf}/ft²`
    : 'the current development appraisal, pending comparable evidence';
  return {
    // the deterministic template — no model wrote a word of what follows, and
    // the AI-use disclosure has to be able to tell
    source: 'template' as const,
    /**
     * What this paragraph asserted, for every property, in every location, in
     * every market: that the market "remains active, with steady occupier and
     * investor demand and a limited supply of directly comparable stock", that
     * "transaction volumes over the preceding twelve months have been stable",
     * and that "marketing periods for well-presented accommodation are
     * typically six to eight weeks". Nothing measured any of it. It printed the
     * same sentences on a scheme with no comparables logged at all.
     *
     * What is left is what the product actually knows, and an explicit sentence
     * saying the market appraisal is the valuer's to write. A gap a valuer can
     * see is a gap they can fill; an invented paragraph reads as done.
     */
    marketCommentary:
      `Pricing evidence for this ${facts.assetType.toLowerCase().replace('_', ' ')} scheme at ${facts.subject} is drawn from ${evidence}. The appraisal indicates a gross development value of ${gbp(facts.gdv)}${psf ? ` and an analysed rate of £${psf}/ft² on ${Math.round(facts.nia).toLocaleString('en-GB')} ft² of net internal area` : ''}. Local market conditions — occupier and investor demand, supply of comparable stock, transaction volumes and marketing periods — have not been assessed in this draft and are for the valuer to state.`,
    valuationRationale:
      `Primary reliance is placed on the comparable method, cross-checked against the depreciated replacement cost and investment approaches. ${facts.compCount ? `The ${facts.compCount} comparable${facts.compCount === 1 ? '' : 's'} analysed support${facts.compCount === 1 ? 's' : ''} £${facts.supportedPsf}/ft², against ${Math.round(facts.nia).toLocaleString('en-GB')} ft² of net internal area.` : 'In the absence of logged comparables, greatest weight is afforded to the residual development appraisal.'} The appraisal indicates a gross development value of ${gbp(facts.gdv)} and a forecast developer's profit of ${gbp(facts.profit)} (${(facts.poc * 100).toFixed(1)}% on cost). Reconciling the approaches, the valuer's opinion of Market Value is ${gbp(mv)}.`,
    /**
     * Two declarations here are required by VPS 3 and were both asserted rather
     * than established.
     *
     * "The evidence base of N comparables is considered adequate for the class"
     * fired on ANY count above zero — so one comparable was declared adequate
     * evidence for a Market Value. Adequacy is the valuer's judgement; the
     * report states the extent and leaves the conclusion to them.
     *
     * "No special assumptions have been made" was printed regardless of what the
     * signed terms of engagement say at clause 11.
     */
    riskCommentary:
      `Planning status is recorded as ${(facts.planningStatus ?? 'not assessed').toLowerCase()}${facts.planningStatus ? ', and the valuation assumes all stated consents remain in effect' : ''}. The principal risks to the reported figure of ${gbp(mv)} are movement in local sales rates${facts.supportedPsf ? ` away from the supported £${facts.supportedPsf}/ft²` : ''}, build-cost inflation compressing the ${(facts.poc * 100).toFixed(1)}% profit on cost, and any extension of the sales period. ${facts.compCount ? `The evidence base is ${facts.compCount} comparable${facts.compCount === 1 ? '' : 's'}, and its adequacy for the class is for the valuer to confirm` : 'No comparables have been logged, so the figure is appraisal-led and should be read accordingly'}. ${
        facts.specialAssumptions
          ? `The following special assumption${/\band\b|;|\n/.test(facts.specialAssumptions) ? 's are' : ' is'} made, as agreed in the terms of engagement: ${facts.specialAssumptions.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '')}`
          : 'No special assumptions have been made'
      }. Material valuation uncertainty has not been assessed in this draft.`,
  };
}

// ---------- Auto-Appraisal ----------

const SAMPLE_EXTRACTION: Extraction = {
  sample: true,
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
export async function documentBlocks(
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
  /**
   * No key. What follows is the built-in worked example, not a reading of the
   * user's documents — right for a demo, dangerous in production, and the
   * absence of a key is not consent to it.
   *
   * The screen that shows this warns about it in an amber panel above the
   * figures. The warning does not survive the data: "Open full appraisal" saves
   * these units into a real Appraisal row, with their `source` citations —
   * "Drawing A-102", "Cost plan summary" — naming documents this deal has never
   * had. From there they reach the appraisal screen, the report and the Red
   * Book, none of which know the numbers were invented, and `sample` is not a
   * column so nothing downstream can find out.
   */
  if (!demoFallbacksAllowed()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'AI extraction is not configured on this server. Use Manual entry to enter the scheme — this server will not invent one for you.',
    });
  }

  // demo fallback: deterministic sample keyed off the notes where possible
  const s106Match = notes.match(/S106[^£]*£([\d,]+)/i);
  const cilMatch = notes.match(/CIL[^£]*£(\d+)\s*per\s*sqm/i);
  const askingMatch = notes.match(/asking[^£]*£([\d,]+)/i);
  const num = (m: RegExpMatchArray | null, dflt: number) => (m ? parseFloat(m[1].replace(/,/g, '')) : dflt);
  return {
    ...SAMPLE_EXTRACTION,
    // flagged, because everything except these three figures is the worked
    // example and NOT a reading of what the user pasted
    sample: true,
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
  extract: aiProcedure
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
          data: { orgId: ctx.principal.orgId, dealId: doc.dealId, actor: AI_ACTOR, action: 'extracted scheme from', target: doc.name },
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
    const deal = await assertDeal(ctx, input);
    const comps = await ctx.prisma.comparable.findMany({ where: { dealId: input, orgId: ctx.principal.orgId } });
    const summary = weightedComparables(
      comps.map((c: any) => ({
        address: c.address,
        basePsf: c.basePsf,
        adjustments: { size: c.adjSize, condition: c.adjCondition, date: c.adjDate, location: c.adjLocation },
      })),
    );
    /**
     * The subject's coordinates, resolved HERE rather than by the browser.
     *
     * The Comparables screen used to fetch api.postcodes.io directly from the
     * visitor's browser, which put a third party between a valuer and their own
     * evidence map three ways over: it handed that provider the visitor's IP, it
     * missed the cache this deal's comps already use, and it failed for anyone
     * behind an ad blocker or a corporate proxy — silently, since the map was
     * gated on the result and simply vanished.
     */
    const subject = await locate(ctx.prisma, (deal as any)?.postcode);
    return { comps, summary, subject };
  }),

  upsert: internalProcedure
    .input(
      z.object({
        id: z.string().optional(),
        dealId: z.string(),
        /**
         * Optional, and an update writes only what it was given.
         *
         * The Comparables screen persists on blur and sent the WHOLE row every
         * time, so adjusting one column wrote all seven fields from the copy the
         * page was holding. Two valuers on one deal — the collaboration this
         * product sells — meant the second blur silently reverted the first's
         * adjustments, and an adjustment is a judgement a Red Book valuation is
         * defended with.
         *
         * Patch rather than a stamp, for the reason `7dd1415` gives: a stamp
         * DETECTS the clobber and asks the user to reload; not sending the field
         * means there is nothing to clobber. Two people adjusting DIFFERENT
         * columns should both land. Only the same column is last-write-wins,
         * which is what editing one number means.
         */
        address: z.string().optional(),
        meta: z.string().optional(),
        basePsf: z.number().optional(),
        adjSize: z.number().optional(),
        adjCondition: z.number().optional(),
        adjDate: z.number().optional(),
        adjLocation: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeal(ctx, input.dealId);
      const { id, dealId: _d, ...supplied } = input;
      /**
       * Only the keys actually supplied. `undefined` in a spread is written as
       * null; a missing key tells Prisma to leave the column alone, which is the
       * whole point of a partial write.
       */
      const data = Object.fromEntries(Object.entries(supplied).filter(([, v]) => v !== undefined));
      if (!id && (data.address == null || data.basePsf == null)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A new comparable needs an address and a base £/ft².' });
      }
      /**
       * These ARE the evidence. A Red Book valuation is defended by its
       * comparables and the adjustments made to them, and an adjustment is a
       * judgement — the reviewer's question is never "what is the number" but
       * "who decided that, and when". `sitePack.applyComps` records the comps it
       * imports from open data; the ones a valuer types or edits by hand, which
       * are the ones carrying a judgement, recorded nothing.
       */
      // read from the ROW, never the input: after a partial write the input may
      // carry only the one column that changed
      const note = (action: string, row: { address: string; basePsf: number; adjSize: number; adjCondition: number; adjDate: number; adjLocation: number }) =>
        ctx.prisma.activityEvent.create({
          data: {
            orgId: ctx.principal.orgId,
            dealId: input.dealId,
            userId: ctx.principal.userId,
            actor: ctx.principal.name,
            action,
            target: `${row.address} · £${Math.round(row.basePsf).toLocaleString('en-GB')}/ft² base, adjustments ${
              [row.adjSize, row.adjCondition, row.adjDate, row.adjLocation].map((n) => `${n > 0 ? '+' : ''}${n}%`).join(' ')
            }`,
          },
        });
      if (id) {
        await assertOwned(ctx.prisma.comparable, id, ctx.principal.orgId);
        const updated = await ctx.prisma.comparable.update({ where: { id }, data });
        await note('edited a comparable', updated);
        return updated;
      }
      const created = await ctx.prisma.comparable.create({
        data: { meta: '', adjSize: 0, adjCondition: 0, adjDate: 0, adjLocation: 0, ...data, orgId: ctx.principal.orgId, dealId: input.dealId } as never,
      });
      await note('added a comparable', created);
      return created;
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
    assertNotApproved(appraisal);
    const supported = Math.round(summary.supportedPsf);
    const before = (JSON.parse(appraisal.units) as any[]).map((u) => u.cap);
    const units = (JSON.parse(appraisal.units) as any[]).map((u) => ({
      ...u,
      cap: supported,
      conf: 'high',
      source: `Comparables — supported £${supported}/ft²`,
    }));
    await ctx.prisma.appraisal.update({ where: { id: appraisal.id }, data: { units: JSON.stringify(units) } });
    /**
     * This overwrites the sale price of EVERY unit type on the current
     * appraisal, which moves GDV, profit and the residual land value — the most
     * consequential single write outside `save`, and the only one that left no
     * trace. `sitePack.applyComps`, which does the same job from open data,
     * records; this one, driven by a valuer's own adjusted comparables, did not.
     */
    await ctx.prisma.activityEvent.create({
      data: {
        orgId: ctx.principal.orgId,
        dealId: input,
        userId: ctx.principal.userId,
        actor: ctx.principal.name,
        action: 'applied comparables to the appraisal',
        target: `${comps.length} comparables · every unit cap set to £${supported.toLocaleString('en-GB')}/ft² (was ${
          [...new Set(before)].map((c) => `£${Math.round(Number(c)).toLocaleString('en-GB')}`).join(', ') || '—'
        })`,
      },
    });
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
        // optional for the same reason as the comparables above: the Scenarios
        // screen persists a lever on blur and used to write all six fields
        name: z.string().optional(),
        descriptor: z.string().optional(),
        blendedPsf: z.number().optional(),
        buildPsf: z.number().optional(),
        gia: z.number().optional(),
        targetProfitPct: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeal(ctx, input.dealId);
      const { id, dealId: _d, ...supplied } = input;
      /**
       * Only the keys actually supplied. `undefined` in a spread is written as
       * null; a missing key tells Prisma to leave the column alone, which is the
       * whole point of a partial write.
       */
      const data = Object.fromEntries(Object.entries(supplied).filter(([, v]) => v !== undefined));
      if (!id && (data.name == null || data.blendedPsf == null || data.buildPsf == null || data.gia == null || data.targetProfitPct == null)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A new scheme option needs a name and all four levers.' });
      }
      // a scheme option is what a promoter takes to a lender or a JV partner, and
      // `draftRisk` right below records the commentary written ABOUT these — so
      // the prose was traceable and the levers it describes were not
      // from the ROW, not the input — a partial write may name only one lever
      const note = (action: string, row: { name: string; blendedPsf: number; buildPsf: number; gia: number; targetProfitPct: number }) =>
        ctx.prisma.activityEvent.create({
          data: {
            orgId: ctx.principal.orgId,
            dealId: input.dealId,
            userId: ctx.principal.userId,
            actor: ctx.principal.name,
            action,
            target: `${row.name} · £${row.blendedPsf}/ft² blended, £${row.buildPsf}/ft² build, ${row.gia.toLocaleString('en-GB')} ft² GIA, ${row.targetProfitPct}% target`,
          },
        });
      if (id) {
        await assertOwned(ctx.prisma.scenario, id, ctx.principal.orgId);
        const updated = await ctx.prisma.scenario.update({ where: { id }, data });
        await note('edited a scheme option', updated);
        return updated;
      }
      const created = await ctx.prisma.scenario.create({
        data: { descriptor: '', ...data, orgId: ctx.principal.orgId, dealId: input.dealId } as never,
      });
      await note('added a scheme option', created);
      return created;
    }),

  /**
   * AI-drafted comparative risk commentary across the scheme options. Every
   * figure comes from the deterministic engine (same compute as the compare
   * grid); the LLM only writes prose around them. Ephemeral — returned to the
   * caller, never persisted.
   */
  draftRisk: aiProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const deal = await assertDeal(ctx, input);
    const rows = await ctx.prisma.scenario.findMany({ where: { dealId: input, orgId: ctx.principal.orgId } });
    const options = rows.slice(0, 3).map((s: any) => ({
      name: s.name as string,
      descriptor: s.descriptor as string,
      blendedPsf: s.blendedPsf as number,
      buildPsf: s.buildPsf as number,
      gia: s.gia as number,
      targetProfitPct: s.targetProfitPct as number,
      ...scenarioMetrics(s),
    }));
    if (options.length < 2)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'At least two scheme options are needed to compare risk — add another option first.' });
    const { commentary, source } = await draftRiskCommentary({ subject: deal.name, options });
    /**
     * Audited like every other AI touchpoint — the report's AI-use disclosure is
     * derived from this trail, so an unlogged call would be an undisclosed one.
     *
     * And the converse, which this missed: a LOGGED non-call is a falsely
     * disclosed one. With no key the commentary comes from a deterministic
     * template, and filing it under AI_ACTOR put "Scenario risk commentary" in
     * the AI-use declaration of a signed valuation over prose no model wrote.
     * Recorded either way, under whoever actually did it.
     */
    await ctx.prisma.activityEvent.create({
      data: {
        orgId: ctx.principal.orgId,
        dealId: input,
        actor: source === 'model' ? AI_ACTOR : ctx.principal.name,
        action: 'drafted scenario risk commentary for',
        target: deal.name,
      },
    });
    return {
      commentary,
      generatedAt: new Date().toISOString(),
      model: process.env.ANTHROPIC_API_KEY ? NARRATIVE_MODEL : 'demo',
    };
  }),
});

// ---------- Scenario risk commentary (AI-drafted, figures from the engine) ----------

type RiskOption = {
  name: string;
  descriptor: string;
  blendedPsf: number;
  buildPsf: number;
  gia: number;
  targetProfitPct: number;
  residual: number;
  gdv: number;
  totalCost: number;
  profit: number;
  poc: number;
};

export type RiskFactsForGuard = { subject: string; options: RiskOption[] };

/**
 * Every figure the risk commentary is allowed to carry.
 *
 * Built from the options being compared, which is what the instruction hands
 * the model — so the guard's allowance and the model's brief cannot drift apart
 * the way two hand-kept lists would.
 */
export function riskFigures(facts: RiskFactsForGuard): { money: number[]; percents: number[] } {
  return {
    money: facts.options.flatMap((o) => [o.gdv, o.residual, o.profit, o.totalCost, o.blendedPsf, o.buildPsf]),
    percents: [
      ...facts.options.flatMap((o) => [Number((o.poc * 100).toFixed(1)), o.targetProfitPct]),
      SCENARIO_ASSUMPTIONS.ltcPct,
      SCENARIO_ASSUMPTIONS.ratePct,
    ],
  };
}

/**
 * The deterministic commentary, in one place.
 *
 * It is both the demo-mode output AND what a rejected model draft falls back
 * to, so it has to satisfy `riskFigures` itself — a guard its own fallback
 * fails would reject every draft and then print prose it had just called
 * unsupported. `risk-commentary-guard.test.ts` asserts exactly that.
 */
export function riskTemplate(facts: RiskFactsForGuard): string {
  const best = bestOption(facts);
  const others = facts.options.filter((o) => o !== best);
  const spread = others
    .map((o) => `${o.name} returns ${(o.poc * 100).toFixed(1)}% on cost against a GDV of ${gbp(o.gdv)} and a residual of ${gbp(o.residual)}`)
    .join(', while ');
  return (
    `The options for ${facts.subject} carry distinct risk profiles. ${spread}. ` +
    `Planning exposure sits with the unconsented variants, whose residuals assume value that has yet to be secured, and build-cost inflation bears hardest on the larger floorplates. ` +
    `On sales absorption, the higher-GDV schemes lean more heavily on rate and take-up holding through the ${SCENARIO_ASSUMPTIONS.salesMonths}-month disposal window, and with all options geared at ${SCENARIO_ASSUMPTIONS.ltcPct}% loan-to-cost at ${SCENARIO_ASSUMPTIONS.ratePct}%, any extension of the programme compounds finance costs across the board. ` +
    `${best.name} is considered the more resilient option: its forecast profit of ${gbp(best.profit)} at ${(best.poc * 100).toFixed(1)}% on cost, against a GDV of ${gbp(best.gdv)} and a residual land value of ${gbp(best.residual)}, provides the widest margin against planning delay, cost overrun and softer sales rates.`
  );
}

/**
 * Which option the engine actually ranks best, by profit on cost.
 *
 * The template and the instruction both derive it here, so the brief the model
 * is given and the answer it is checked against cannot drift apart.
 */
const bestOption = (facts: RiskFactsForGuard) => facts.options.reduce((a, b) => (b.poc > a.poc ? b : a));

/** the option names, longest first, so "Scheme A2" is matched before "Scheme A" */
const namesIn = (facts: RiskFactsForGuard) => [...facts.options].sort((a, b) => b.name.length - a.name.length);

const escapeName = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, name: string) => new RegExp(`(?<![\\w-])${escapeName(name)}(?![\\w-])`, 'i').test(text);

/**
 * Words a reader takes as "this is the one".
 *
 * The instruction asks the model to name the resilient option and say why its
 * margin is widest, so this is the vocabulary it was pointed at.
 */
const PREFERRED =
  /\b(?:more|most)\s+resilient\b|\bresilient\s+option\b|\bpreferred\b|\brecommend(?:ed|s|ation)?\b|\bwidest\s+margin\b|\b(?:most|more)\s+(?:robust|defensive|attractive)\b|\bstrongest\b|\bbest\s+(?:option|placed|risk[- ]adjusted)\b|\bfavoured\b/i;

/**
 * Does the commentary recommend the option the ENGINE ranked best?
 *
 * `unsupportedFigures` checks that every number came from the engine. Choosing
 * WHICH option those numbers make the better scheme is a financial conclusion —
 * the first non-negotiable in this codebase is that the model never draws one —
 * and it was checked by nothing. Every figure in "Scheme B is the more resilient
 * option" is a figure the model was handed, so the figure guard returns [] and
 * a commentary recommending the scheme the engine ranks lower is shown as the
 * model's own work, to a promoter taking it to a lender or a JV partner.
 *
 * Sentence-level and comparison-aware: "Scheme B is less resilient than Scheme A"
 * names both, and naming the engine's choice in the same breath is what makes it
 * a comparison rather than a rival recommendation.
 */
export function unsupportedRecommendation(commentary: string, facts: RiskFactsForGuard): string[] {
  if (facts.options.length < 2) return [];
  const best = bestOption(facts);
  const bad: string[] = [];
  if (!mentions(commentary, best.name)) {
    bad.push(`the commentary never names ${best.name}, which the engine ranks best on profit on cost`);
  }
  for (const sentence of commentary.split(/(?<=[.;])\s+/)) {
    if (!PREFERRED.test(sentence) || mentions(sentence, best.name)) continue;
    for (const o of namesIn(facts)) {
      if (o.name === best.name) continue;
      if (mentions(sentence, o.name)) {
        bad.push(`recommends ${o.name} over the engine's choice of ${best.name} — "${sentence.trim()}"`);
        break;
      }
    }
  }
  return bad;
}

/**
 * Whether a drafted commentary may be shown, or the template used instead.
 *
 * The model was told to use these figures verbatim. This checks it did — the
 * same reasoning as the Red Book narrative, which has had it since
 * `narrative-guard.ts`: the instruction is right, and it is still only an
 * instruction. This commentary is what a promoter takes to a lender or a JV
 * partner, beside a comparison grid showing the real numbers, so a transposed
 * digit is a residual land value nobody calculated in the one paragraph a
 * reader takes on trust.
 *
 * Separated from the fetch on purpose. Behind the live call it could only be
 * exercised with an API key and a model that misbehaves on cue, so removing it
 * would have failed nothing — the split is what lets the decision be driven
 * backwards.
 */
export function acceptRiskDraft(
  commentary: string,
  facts: RiskFactsForGuard,
): { commentary: string; source: 'model' | 'template' } {
  const unsupported = [
    ...unsupportedFigures({ commentary }, riskFigures(facts)),
    ...unsupportedRecommendation(commentary, facts),
  ];
  if (unsupported.length === 0) return { commentary, source: 'model' };
  console.warn(`[risk] draft discarded — not supported by the engine: ${unsupported.join(', ')}`);
  return { commentary: riskTemplate(facts), source: 'template' };
}

const zRiskCommentary = z.object({ commentary: z.string().min(1) });

/** JSON Schema for the forced tool call — one plain-prose comparative paragraph. */
const RISK_TOOL = {
  name: 'record_risk_commentary',
  description:
    'Record the comparative risk commentary for the scheme options being appraised. Plain prose only — no markdown, no headings, no bullet points.',
  input_schema: {
    type: 'object',
    properties: {
      commentary: {
        type: 'string',
        description: "100-160 words comparing the options' risk profiles and naming the more resilient option",
      },
    },
    required: ['commentary'],
  },
} as const;

/**
 * Draft the comparative risk commentary. The LLM is FORCED through a tool call
 * so output is schema-valid JSON by construction, and every number it may cite
 * is supplied (engine-computed) — it authors register, never arithmetic. Falls
 * back to a deterministic template when no ANTHROPIC_API_KEY (demo mode).
 */
async function draftRiskCommentary(
  facts: { subject: string; options: RiskOption[] },
): Promise<{ commentary: string; source: 'model' | 'template' }> {
  const best = bestOption(facts);
  const optionLines = facts.options
    .map(
      (o) =>
        `- ${o.name} (${o.descriptor}): GDV ${gbp(o.gdv)}; residual land value ${gbp(o.residual)}; forecast profit ${gbp(o.profit)} (${(o.poc * 100).toFixed(1)}% on cost); ${Math.round(o.gia).toLocaleString('en-GB')} ft² GIA at £${Math.round(o.blendedPsf)}/ft² blended sales and £${Math.round(o.buildPsf)}/ft² build`,
    )
    .join('\n');
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    const instruction = `Write the comparative risk commentary for a UK development-appraisal scenario comparison via record_risk_commentary.

FACTS (use these figures verbatim — do not invent or recompute any number):
- Subject: ${facts.subject}
- Scheme options under comparison:
${optionLines}
- All options assume ${SCENARIO_ASSUMPTIONS.ltcPct}% loan-to-cost debt at ${SCENARIO_ASSUMPTIONS.ratePct}% over an ${SCENARIO_ASSUMPTIONS.periodMonths}-month build plus ${SCENARIO_ASSUMPTIONS.salesMonths}-month sales period

RULES: 100-160 words; UK development-appraisal register; third person — no first person; plain prose, no markdown; compare the options' risk profiles across planning, cost, sales absorption and finance/leverage; reference the deal's actual figures above (GDV, profit on cost, residual land value); name ${best.name} as the more resilient option and explain why its ${(best.poc * 100).toFixed(1)}% profit on cost gives the widest margin.`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: NARRATIVE_MODEL,
        max_tokens: 1000,
        tools: [RISK_TOOL],
        tool_choice: { type: 'tool', name: 'record_risk_commentary' },
        messages: [{ role: 'user', content: instruction }],
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { content: Array<{ type: string; input?: unknown }> };
      const toolUse = body.content.find((c) => c.type === 'tool_use');
      const parsed = zRiskCommentary.safeParse(toolUse?.input);
      if (!parsed.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI risk drafting returned an unusable response — try again.' });
      }
      return acceptRiskDraft(parsed.data.commentary, facts);
    }
    // surface the real upstream reason (e.g. "credit balance too low") instead of a mystery failure
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `AI risk drafting unavailable: ${err?.error?.message ?? `Anthropic API returned ${res.status}`}. Fix the API key/credits and try again.`,
    });
  }
  /**
   * Demo fallback: a deterministic template interpolating the same engine
   * figures. No model wrote a word of it, and the caller has to be able to tell
   * — the AI-use disclosure in the Red Book is derived from whether this was an
   * AI touchpoint.
   */
  return { source: 'template' as const, commentary: riskTemplate(facts) };
}
