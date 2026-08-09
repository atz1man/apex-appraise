import { z } from 'zod';

// ---- Enum-like unions (SQLite dev DB stores these as strings) ----
export const ASSET_TYPES = ['INDUSTRIAL', 'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE'] as const;
export const DEAL_STAGES = ['SOURCING', 'APPRAISAL', 'OFFER', 'ACQUISITION', 'CONSTRUCTION', 'SALES_LETTING', 'COMPLETED'] as const;
export const FIGURE_STATUSES = ['ESTIMATE', 'COMMITTED', 'ACTUAL'] as const;
export const VIABILITIES = ['PROCEED', 'CAUTION', 'DECLINE'] as const;
export const SALES_STATUSES = ['AVAILABLE', 'RESERVED', 'EXCHANGED', 'COMPLETED', 'HANDOVER'] as const;
export const TENANCY_STATUSES = ['AVAILABLE', 'APPLICATION', 'REFERENCING', 'SIGNED', 'OCCUPIED'] as const;
export const USER_ROLES = ['ADMIN', 'ANALYST', 'SURVEYOR', 'VIEWER'] as const;
export const PRINCIPAL_TYPES = ['internal', 'buyer', 'investor'] as const;
export const SPEND_PROFILES = ['SCURVE', 'EVEN', 'FRONT', 'BACK'] as const;

export type AssetType = (typeof ASSET_TYPES)[number];
export type DealStage = (typeof DEAL_STAGES)[number];
export type FigureStatus = (typeof FIGURE_STATUSES)[number];
export type Viability = (typeof VIABILITIES)[number];
export type SalesStatus = (typeof SALES_STATUSES)[number];
export type TenancyStatus = (typeof TENANCY_STATUSES)[number];
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const zAssetType = z.enum(ASSET_TYPES);
export const zDealStage = z.enum(DEAL_STAGES);
export const zSpendProfile = z.enum(SPEND_PROFILES);

/** Stage → how hard the figures are (estimate → committed → actual). */
export const figureStatusForStage: Record<DealStage, FigureStatus> = {
  SOURCING: 'ESTIMATE',
  APPRAISAL: 'ESTIMATE',
  OFFER: 'ESTIMATE',
  ACQUISITION: 'COMMITTED',
  CONSTRUCTION: 'ACTUAL',
  SALES_LETTING: 'ACTUAL',
  COMPLETED: 'ACTUAL',
};

export const SALES_MILESTONES = [
  'Reserved',
  'Memorandum of sale',
  'Searches ordered',
  'Enquiries raised',
  'Mortgage offer',
  'Exchanged',
  'Completed',
  'Handover & snagging',
] as const;

export const LETTING_MILESTONES = ['Enquiry', 'Viewing', 'Application', 'Referencing', 'Tenancy signed', 'Move-in'] as const;

// ---- Appraisal input (client → engine), money in POUNDS at this layer ----
export const zAppraisalUnit = z.object({
  label: z.string(),
  count: z.number().min(0),
  area: z.number().min(0),
  cap: z.number().min(0),
  conf: z.enum(['high', 'med', 'low']).optional(),
  source: z.string().optional(),
});

/** Investment method — the held-and-let element of the scheme (rents in £/ft²/yr). */
export const zIncomeInput = z.object({
  lines: z.array(
    z.object({
      label: z.string(),
      count: z.number().min(0),
      area: z.number().min(0),
      rentPsf: z.number().min(0),
      voidPct: z.number().min(0).max(100).optional(),
      ervPsf: z.number().min(0).optional(),
      yearsToReview: z.number().min(0).max(60).optional(),
      yieldPct: z.number().min(0).max(30).optional(),
    }),
  ),
  method: z.enum(['perpetuity', 'termReversion', 'hardcore']).optional(),
  reversionYieldPct: z.number().min(0).max(30).optional(),
  nonRecoverablePct: z.number().min(0).max(100),
  annualDeductions: z.number().min(0).optional(),
  yieldPct: z.number().min(0).max(30),
  purchaserCostsPct: z.number().min(0).max(20).optional(),
  letUpMonths: z.number().min(0).max(60).optional(),
});
export type IncomeInputDto = z.infer<typeof zIncomeInput>;

/** When a cost line falls — omitted means "follow the scheme profile over the build". */
export const zCostTiming = z.object({
  start: z.number().min(1).max(120).optional(),
  months: z.number().min(1).max(120).optional(),
  profile: z.enum(['scurve', 'even', 'linear', 'front', 'back']).optional(),
});

/** A phase of a phased scheme — its own accommodation and its own programme. */
export const zPhase = z.object({
  name: z.string().max(80),
  start: z.number().min(1).max(240),
  buildMonths: z.number().min(1).max(60),
  salesMonths: z.number().min(1).max(24),
  absorptionUnitsPerMonth: z.number().positive().max(500).optional(),
  units: z.array(zAppraisalUnit),
  // cost overrides — omitted fields inherit the scheme
  trades: z.array(z.object({ label: z.string(), rate: z.number(), timing: zCostTiming.optional() })).optional(),
  profFeePct: z.number().min(0).max(50).optional(),
  contingencyPct: z.number().min(0).max(50).optional(),
  otherCosts: z.array(z.object({ label: z.string(), amount: z.number(), timing: zCostTiming.optional() })).optional(),
});

/** Growth-explicit DCF over the held element — a cross-check on the capitalisation. */
export const zDcfInput = z.object({
  holdYears: z.number().min(1).max(50),
  rentalGrowthPct: z.number().min(-20).max(20),
  discountRatePct: z.number().min(0).max(40),
  exitYieldPct: z.number().min(0).max(30),
  exitCostsPct: z.number().min(0).max(20).optional(),
  reviewCycleYears: z.number().min(1).max(25).optional(),
});
export type DcfInputDto = z.infer<typeof zDcfInput>;

export const zAppraisalInput = z.object({
  units: z.array(zAppraisalUnit),
  phases: z.array(zPhase).max(12).optional(),
  efficiency: z.number().positive().max(120),
  trades: z.array(z.object({ label: z.string(), rate: z.number(), timing: zCostTiming.optional() })),
  profFeePct: z.number().min(0).max(50),
  contingencyPct: z.number().min(0).max(50),
  otherCosts: z.array(z.object({ label: z.string(), amount: z.number(), timing: zCostTiming.optional() })),
  finance: z.object({
    ltcPct: z.number().min(0).max(100),
    ratePct: z.number().min(0).max(40),
    periodMonths: z.number().min(1).max(60),
    salesMonths: z.number().min(1).max(24),
    arrangementFeePct: z.number().min(0).max(10),
    spendProfile: z.enum(['scurve', 'even', 'linear', 'front', 'back']).optional(),
    absorptionUnitsPerMonth: z.number().positive().max(500).optional(),
  }),
  site: z.object({
    mode: z.enum(['residual', 'profit']),
    landFixed: z.number().min(0),
    acqPct: z.number().min(0).max(30),
  }),
  disposal: z.object({ agentPct: z.number().min(0).max(10), legalPct: z.number().min(0).max(10) }),
  targetProfitOnGdvPct: z.number().min(0).max(60),
  jv: z
    .object({
      gpCoinvestPct: z.number().min(0).max(100),
      prefPct: z.number().min(0).max(30),
      promotePct: z.number().min(0).max(60),
    })
    .optional(),
  income: zIncomeInput.optional(),
  dcf: zDcfInput.optional(),
  startYear: z.number().int().min(2000).max(2100).optional(),
  startMonth: z.number().int().min(0).max(11).optional(),
});
export type AppraisalInputDto = z.infer<typeof zAppraisalInput>;

// ---- LLM extraction contract (API.md) — the model extracts INPUTS ONLY ----
// The model returns null for anything the documents don't state (never invents
// figures); deterministic code fills UK-standard appraisal defaults here.
const numOr = (dflt: number) => z.number().nullish().transform((v) => v ?? dflt);
const strOr = (dflt: string) => z.string().nullish().transform((v) => v ?? dflt);

export const zExtraction = z.object({
  /**
   * True when this is the built-in worked example rather than a reading of the
   * user's own text — which is what an unkeyed server returns. The UI must say so:
   * handing someone a confident appraisal of a scheme they did not paste, with a
   * different name and address on it, is the kind of thing that ends a trial.
   */
  sample: z.boolean().nullish().transform((v) => v ?? false),
  scheme: strOr('Development scheme'),
  address: strOr(''),
  assetType: z.enum(['industrial', 'residential', 'commercial', 'mixed']).nullish().transform((v) => v ?? 'mixed'),
  units: z.array(
    z.object({
      // the core extraction — the model must state these, no defaults
      label: z.string(),
      count: z.number(),
      area: z.number(),
      value: z.number(), // £/ft²
      conf: z.enum(['high', 'med', 'low']).nullish().transform((v) => v ?? 'med'),
      source: strOr('Extracted from notes'),
    }),
  ),
  efficiency: numOr(90),
  profFee: numOr(11),
  contingency: numOr(5),
  finance: z
    .object({
      ltc: numOr(60),
      rate: numOr(7.5),
      period: numOr(18),
      sales: numOr(3),
      arrFee: numOr(1.5),
    })
    .nullish()
    .transform((v) => v ?? { ltc: 60, rate: 7.5, period: 18, sales: 3, arrFee: 1.5 }),
  targetProfit: numOr(20),
  asking: numOr(0),
  cilPerSqm: numOr(0),
  s106: numOr(0),
  agent: numOr(1.5),
  legal: numOr(0.5),
  acq: numOr(1.8),
  planningStatus: strOr('Not stated in documents'),
  planningRisk: z.number().min(0).max(100).nullish().transform((v) => v ?? 30),
  planningRiskLabel: strOr('Medium'),
  planningNotes: strOr(''),
  recommendation: strOr(''),
  confidence: strOr('Estimate'),
});
export type Extraction = z.infer<typeof zExtraction>;

export const zWhatIfResponse = z.object({
  changes: z.record(z.unknown()),
  reply: z.string(),
});
