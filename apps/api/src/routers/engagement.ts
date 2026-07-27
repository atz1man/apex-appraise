import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { internalProcedure, publicProcedure, router } from '../trpc.js';
import { AI_STANDING_STATEMENT, AI_TOUCHPOINTS } from '../ai-disclosure.js';
import { toPence, P } from '../mappers.js';

/**
 * Terms of engagement — RICS Red Book VPS 1. The written agreement that has to
 * be settled with the client BEFORE a valuation is reported, covering the
 * parties, the purpose and basis of value, the extent of investigation, the
 * assumptions, the fee basis and the limits of liability.
 *
 * Apex drafts it from what it already knows about the deal so the valuer edits
 * rather than types, then issues it and records the client's acceptance. The
 * AI-use paragraph is generated from the same register that drives the report
 * disclosure (ai-disclosure.ts) — the client is told up front what will be
 * used, and the report afterwards states what actually was.
 */

async function assertDeal(ctx: { prisma: any; principal: { orgId: string } }, dealId: string) {
  const deal = await ctx.prisma.deal.findFirst({ where: { id: dealId, orgId: ctx.principal.orgId } });
  if (!deal) throw new TRPCError({ code: 'NOT_FOUND' });
  return deal;
}

const BASIS_OF_VALUE = ['Market Value', 'Market Rent', 'Fair Value', 'Investment Value'] as const;

/** What the client is told about AI before the work starts. */
export function aiUseParagraph(): string {
  const uses = AI_TOUCHPOINTS.map((t) => t.label.toLowerCase()).join(', ');
  return `Artificial intelligence may be used on this instruction to assist with ${uses}. ${AI_STANDING_STATEMENT} The report will state which of these were actually used, and the firm will provide further detail on request.`;
}

/** A complete first draft from what the deal already tells us. */
function draftFor(deal: { name: string; address: string; assetType: string | null }, orgName: string, valuer: { name: string }) {
  const residential = deal.assetType === 'RESIDENTIAL';
  return {
    status: 'DRAFT' as const,
    clientName: '',
    clientAddress: '',
    otherUsers: 'None. This report is for the addressee client only and no responsibility is accepted to any other party.',
    purpose: 'Secured lending and internal decision-making in respect of the proposed development.',
    interest: 'Freehold, with vacant possession assumed on completion.',
    basisOfValue: 'Market Value' as (typeof BASIS_OF_VALUE)[number],
    valuationDate: null as Date | null,
    extentOfInvestigation: `The valuer will inspect ${deal.name}, ${deal.address} internally and externally to the extent reasonably accessible without specialist equipment. No structural survey, opening up of the fabric, testing of services, environmental survey or measured survey will be undertaken.`,
    sourcesOfInformation:
      'Areas, schedules of accommodation, cost information and planning status supplied by the client and their professional team, together with comparable evidence obtained from HM Land Registry, agency sources and the valuer’s own records. Information supplied by the client is relied upon as accurate and is not independently verified.',
    assumptions: `Good and marketable ${residential ? 'freehold' : 'freehold'} title is held free from onerous restrictions; no deleterious materials are present; services are connected and in working order; the site is free from contamination and material flood risk; and all necessary consents have been obtained.`,
    specialAssumptions: 'None.',
    reportFormat:
      'A written valuation report in the firm’s standard Red Book format, issued in PDF, together with the supporting development appraisal.',
    restrictionsOnUse:
      'The report may not be reproduced, published or relied upon by any third party without the firm’s prior written consent, and may not be quoted in whole or in part in any prospectus or circular.',
    feeBasis: 'A fixed fee as separately quoted, payable on delivery of the report, plus VAT and reasonable disbursements.',
    liabilityCap: null as number | null,
    complaintsProcedure:
      'The firm operates a complaints handling procedure in accordance with RICS requirements, a copy of which is available on request. Unresolved complaints may be referred to an independent redress scheme.',
    aiUse: aiUseParagraph(),
    valuerName: valuer.name,
    valuerReg: 'RICS Registered Valuer',
    orgName,
  };
}

const zTerms = z.object({
  clientName: z.string().max(160),
  clientAddress: z.string().max(400),
  otherUsers: z.string().max(1000),
  purpose: z.string().max(1000),
  interest: z.string().max(600),
  basisOfValue: z.enum(BASIS_OF_VALUE),
  valuationDate: z.string().nullish(),
  extentOfInvestigation: z.string().max(2000),
  sourcesOfInformation: z.string().max(2000),
  assumptions: z.string().max(2000),
  specialAssumptions: z.string().max(2000),
  reportFormat: z.string().max(1000),
  restrictionsOnUse: z.string().max(1000),
  feeBasis: z.string().max(1000),
  liabilityCap: z.number().min(0).nullish(),
  complaintsProcedure: z.string().max(1000),
  aiUse: z.string().max(2000),
  valuerName: z.string().max(120),
  valuerReg: z.string().max(120),
});

const shape = (row: any, orgName: string) => ({
  ...row,
  liabilityCap: row.liabilityCap == null ? null : P(row.liabilityCap),
  orgName,
});

export const engagementRouter = router({
  /** Existing terms, or an unsaved draft prefilled from the deal. */
  get: internalProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const deal = await assertDeal(ctx, input);
    const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
    const row = await ctx.prisma.engagementTerms.findFirst({ where: { dealId: input, orgId: ctx.principal.orgId } });
    if (row) return { saved: true, ...shape(row, org?.name ?? 'Apex Appraise') };
    return {
      saved: false,
      id: null,
      dealId: input,
      ...draftFor(deal, org?.name ?? 'Apex Appraise', { name: ctx.principal.name }),
      issuedAt: null,
      acceptedAt: null,
      acceptedBy: null,
      updatedAt: null,
    };
  }),

  save: internalProcedure
    .input(z.object({ dealId: z.string(), terms: zTerms }))
    .mutation(async ({ ctx, input }) => {
      await assertDeal(ctx, input.dealId);
      const existing = await ctx.prisma.engagementTerms.findFirst({
        where: { dealId: input.dealId, orgId: ctx.principal.orgId },
      });
      if (existing?.status === 'ACCEPTED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'These terms have been accepted by the client and can no longer be edited. Withdraw them to start a revision.',
        });
      }
      const data = {
        ...input.terms,
        valuationDate: input.terms.valuationDate ? new Date(input.terms.valuationDate) : null,
        liabilityCap: input.terms.liabilityCap == null ? null : toPence(input.terms.liabilityCap),
      };
      const row = existing
        ? await ctx.prisma.engagementTerms.update({ where: { id: existing.id }, data })
        : await ctx.prisma.engagementTerms.create({
            data: { ...data, orgId: ctx.principal.orgId, dealId: input.dealId, status: 'DRAFT' },
          });
      return { id: row.id, status: row.status };
    }),

  /** Freeze and date the terms — this is the version the client sees. */
  issue: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const deal = await assertDeal(ctx, input);
    const row = await ctx.prisma.engagementTerms.findFirst({ where: { dealId: input, orgId: ctx.principal.orgId } });
    if (!row) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Save the terms before issuing them.' });
    if (!row.clientName.trim())
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Name the client before issuing — terms of engagement are addressed to someone.' });
    // a fresh token every issue: re-issuing revokes any link already sent
    const updated = await ctx.prisma.engagementTerms.update({
      where: { id: row.id },
      data: {
        status: 'ISSUED',
        issuedAt: new Date(),
        acceptedAt: null,
        acceptedBy: null,
        signToken: randomBytes(24).toString('hex'),
        signedName: null,
        signedAt: null,
        signedIp: null,
        signedUserAgent: null,
      },
    });
    await ctx.prisma.activityEvent.create({
      data: {
        orgId: ctx.principal.orgId,
        dealId: input,
        actor: ctx.principal.name,
        action: 'issued terms of engagement for',
        target: `${deal.name} — ${row.clientName}`,
      },
    });
    return { status: updated.status, issuedAt: updated.issuedAt, signToken: updated.signToken };
  }),

  /** Record the client's written acceptance (name + date), audited. */
  accept: internalProcedure
    .input(z.object({ dealId: z.string(), acceptedBy: z.string().min(2).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const deal = await assertDeal(ctx, input.dealId);
      const row = await ctx.prisma.engagementTerms.findFirst({
        where: { dealId: input.dealId, orgId: ctx.principal.orgId },
      });
      if (!row || row.status === 'DRAFT')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Issue the terms before recording acceptance.' });
      const updated = await ctx.prisma.engagementTerms.update({
        where: { id: row.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedBy: input.acceptedBy.trim() },
      });
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: ctx.principal.orgId,
          dealId: input.dealId,
          actor: ctx.principal.name,
          action: 'recorded client acceptance of terms for',
          target: `${deal.name} — accepted by ${input.acceptedBy.trim()}`,
        },
      });
      return { status: updated.status, acceptedAt: updated.acceptedAt, acceptedBy: updated.acceptedBy };
    }),

  /**
   * PUBLIC — the client's view of issued terms, reached by signing token only.
   * Returns the document and nothing else: no ids, no org internals, no other
   * deal. An unknown, revoked or draft token is simply not found.
   */
  publicGet: publicProcedure.input(z.object({ token: z.string().min(16).max(96) })).query(async ({ ctx, input }) => {
    const row = await ctx.prisma.engagementTerms.findFirst({ where: { signToken: input.token } });
    if (!row || row.status === 'DRAFT') throw new TRPCError({ code: 'NOT_FOUND', message: 'This signing link is no longer valid.' });
    const [deal, org] = await Promise.all([
      ctx.prisma.deal.findUnique({ where: { id: row.dealId } }),
      ctx.prisma.organisation.findUnique({ where: { id: row.orgId } }),
    ]);
    const { id: _id, orgId: _o, dealId: _d, signToken: _t, signedIp: _ip, signedUserAgent: _ua, ...terms } = row;
    return {
      ...shape(terms, org?.name ?? 'Apex Appraise'),
      dealName: deal?.name ?? 'the property',
      dealAddress: deal?.address ?? '',
      dealPostcode: deal?.postcode ?? '',
    };
  }),

  /**
   * PUBLIC — the client signs. A typed name plus an explicit agreement is the
   * standard e-signature form; what makes it defensible later is the evidence
   * recorded alongside it, so time, IP and user agent are captured too.
   */
  sign: publicProcedure
    .input(
      z.object({
        token: z.string().min(16).max(96),
        name: z.string().trim().min(2).max(120),
        agreed: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.engagementTerms.findFirst({ where: { signToken: input.token } });
      if (!row || row.status === 'DRAFT') throw new TRPCError({ code: 'NOT_FOUND', message: 'This signing link is no longer valid.' });
      if (row.status === 'ACCEPTED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'These terms have already been signed.' });
      }
      const signedAt = new Date();
      await ctx.prisma.engagementTerms.update({
        where: { id: row.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: signedAt,
          acceptedBy: input.name.trim(),
          signedName: input.name.trim(),
          signedAt,
          signedIp: ctx.ip ?? null,
          signedUserAgent: ctx.userAgent,
        },
      });
      const deal = await ctx.prisma.deal.findUnique({ where: { id: row.dealId } });
      await ctx.prisma.activityEvent.create({
        data: {
          orgId: row.orgId,
          dealId: row.dealId,
          actor: input.name.trim(),
          action: 'signed the terms of engagement for',
          target: `${deal?.name ?? 'the deal'} — signed electronically`,
        },
      });
      return { signedAt, signedName: input.name.trim() };
    }),

  /** Back to draft for a revision — never deletes the audit trail of the issue. */
  withdraw: internalProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    const deal = await assertDeal(ctx, input);
    const row = await ctx.prisma.engagementTerms.findFirst({ where: { dealId: input, orgId: ctx.principal.orgId } });
    if (!row) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to withdraw.' });
    await ctx.prisma.engagementTerms.update({
      where: { id: row.id },
      data: {
        status: 'DRAFT',
        issuedAt: null,
        acceptedAt: null,
        acceptedBy: null,
        // revoke the signing link — a withdrawn set of terms must not stay signable
        signToken: null,
        signedName: null,
        signedAt: null,
        signedIp: null,
        signedUserAgent: null,
      },
    });
    await ctx.prisma.activityEvent.create({
      data: {
        orgId: ctx.principal.orgId,
        dealId: input,
        actor: ctx.principal.name,
        action: 'withdrew terms of engagement for',
        target: deal.name,
      },
    });
    return { status: 'DRAFT' as const };
  }),
});
