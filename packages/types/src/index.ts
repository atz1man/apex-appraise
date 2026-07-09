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

export const zAppraisalInput = z.object({
  units: z.array(zAppraisalUnit),
  efficiency: z.number().positive().max(120),
  trades: z.array(z.object({ label: z.string(), rate: z.number() })),
  profFeePct: z.number().min(0).max(50),
  contingencyPct: z.number().min(0).max(50),
  otherCosts: z.array(z.object({ label: z.string(), amount: z.number() })),
  finance: z.object({
    ltcPct: z.number().min(0).max(100),
    ratePct: z.number().min(0).max(40),
    periodMonths: z.number().min(1).max(60),
    salesMonths: z.number().min(1).max(24),
    arrangementFeePct: z.number().min(0).max(10),
    spendProfile: z.enum(['scurve', 'even', 'linear', 'front', 'back']).optional(),
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
  startYear: z.number().int().min(2000).max(2100).optional(),
  startMonth: z.number().int().min(0).max(11).optional(),
});
export type AppraisalInputDto = z.infer<typeof zAppraisalInput>;

// ---- LLM extraction contract (API.md) — the model extracts INPUTS ONLY ----
export const zExtraction = z.object({
  scheme: z.string(),
  address: z.string(),
  assetType: z.enum(['industrial', 'residential', 'commercial', 'mixed']),
  units: z.array(
    z.object({
      label: z.string(),
      count: z.number(),
      area: z.number(),
      value: z.number(), // £/ft²
      conf: z.enum(['high', 'med', 'low']),
      source: z.string(),
    }),
  ),
  efficiency: z.number(),
  profFee: z.number(),
  contingency: z.number(),
  finance: z.object({
    ltc: z.number(),
    rate: z.number(),
    period: z.number(),
    sales: z.number(),
    arrFee: z.number(),
  }),
  targetProfit: z.number(),
  asking: z.number(),
  cilPerSqm: z.number(),
  s106: z.number(),
  agent: z.number(),
  legal: z.number(),
  acq: z.number(),
  planningStatus: z.string(),
  planningRisk: z.number().min(0).max(100),
  planningRiskLabel: z.string(),
  planningNotes: z.string(),
  recommendation: z.string(),
  confidence: z.string(),
});
export type Extraction = z.infer<typeof zExtraction>;

export const zWhatIfResponse = z.object({
  changes: z.record(z.unknown()),
  reply: z.string(),
});
