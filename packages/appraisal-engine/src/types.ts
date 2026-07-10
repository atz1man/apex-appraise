/** Engine-internal money is plain £ numbers; the API/DB boundary converts to integer pence. */

export type Confidence = 'high' | 'med' | 'low';

export interface AppraisalUnit {
  label: string;
  count: number;
  area: number; // sqft (NIA per unit)
  cap: number; // £/sqft capital value
  conf?: Confidence;
  source?: string;
}

export interface BuildTrade {
  label: string;
  rate: number; // £/ft² — Σ rates = build rate
}

export interface OtherCost {
  label: string;
  amount: number; // £
}

export type SpendProfileKey = 'scurve' | 'even' | 'linear' | 'front' | 'back';

export interface FinanceInput {
  ltcPct: number;
  ratePct: number;
  periodMonths: number;
  salesMonths: number;
  arrangementFeePct: number;
  spendProfile?: SpendProfileKey;
  /**
   * Sales absorption (units/month). When set, the sales period is derived from
   * the unit count and revenue arrives as units actually sell, instead of the
   * flat salesMonths spread. Omit for the classic even-spread model.
   */
  absorptionUnitsPerMonth?: number;
}

export type SiteMode = 'residual' | 'profit';

export interface AppraisalInput {
  units: AppraisalUnit[];
  efficiency: number; // NIA/GIA %
  trades: BuildTrade[];
  profFeePct: number;
  contingencyPct: number;
  otherCosts: OtherCost[];
  finance: FinanceInput;
  site: { mode: SiteMode; landFixed: number; acqPct: number };
  disposal: { agentPct: number; legalPct: number };
  targetProfitOnGdvPct: number;
  jv?: JvInput;
  startYear?: number;
  startMonth?: number; // 0-based
}

export interface JvInput {
  gpCoinvestPct: number;
  prefPct: number;
  promotePct: number;
}

export interface CashflowRow {
  m: number;
  cost: number; // construction + land (month 1)
  intr: number;
  rev: number;
  net: number;
  cum: number;
}

export interface CashflowResult {
  rows: CashflowRow[];
  totalMonths: number;
  peak: number;
  projIrr: number | null; // annualised unlevered IRR
  eqIrr: number | null; // annualised equity IRR
}

export interface AppraisalResult {
  nia: number;
  gia: number;
  gdv: number;
  buildRate: number;
  build: number;
  fees: number;
  cont: number;
  otherTotal: number;
  saleCosts: number;
  interest: number;
  arrangement: number;
  finance: number;
  facility: number;
  equity: number;
  residualNet: number;
  landGross: number;
  profit: number;
  totalCost: number;
  poc: number;
  rogdv: number;
  roe: number;
  period: number;
  salesMonths: number;
  holdYears: number;
  cash?: CashflowResult;
}

export interface JvPartyResult {
  equity: number;
  profit: number;
  total: number;
  moic: number;
  irr: number | null; // annualised MOIC approximation
}

export interface JvResult {
  lp: JvPartyResult;
  gp: JvPartyResult;
  prefTotal: number;
  residualProfit: number;
  promote: number;
  holdYears: number;
}

export type SensitivityMetric = 'roc' | 'profit' | 'residual';

export interface SensitivityCell {
  value: number;
  salesDelta: number;
  buildDelta: number;
  isBase: boolean;
  /** value relative to base cell — drives colouring */
  ratio: number;
}

/** Auto-Appraisal (indicative) — lighter finance approximation for instant results. */
export interface AutoAppraisalInput {
  units: AppraisalUnit[];
  efficiency: number;
  buildPerSqft: number;
  profFeePct: number;
  contingencyPct: number;
  cilPerSqm: number;
  s106: number;
  agentPct: number;
  legalPct: number;
  ltcPct: number;
  ratePct: number;
  periodMonths: number;
  salesMonths: number;
  arrangementFeePct: number;
  targetProfitPct: number;
  acqPct: number;
  asking: number; // 0 = no asking price
}

export interface AutoAppraisalResult {
  nia: number;
  gia: number;
  gdv: number;
  build: number;
  fees: number;
  cont: number;
  cil: number;
  other: number;
  saleCosts: number;
  facility: number;
  interest: number;
  arrangement: number;
  finance: number;
  targetProfit: number;
  residualNet: number;
  sdlt: number;
  askingGross: number | null;
  totalCostAtAsking: number | null;
  profitAtAsking: number | null;
  rocAtAsking: number | null;
  headroom: number | null;
}

export interface ComparableInput {
  address: string;
  basePsf: number;
  adjustments: { size: number; condition: number; date: number; location: number }; // % each
}

export interface ComparableResult {
  address: string;
  basePsf: number;
  adjustedPsf: number;
  netAdjustment: number;
  grossAdjustment: number;
  weight: number;
}

export interface ComparablesSummary {
  comps: ComparableResult[];
  supportedPsf: number;
  avgGrossAdjustment: number;
  range: { lo: number; hi: number };
}

export interface MonteCarloOptions {
  iterations?: number; // default 500
  /** 1σ of the sales (GDV) multiplier, e.g. 0.075 = ±7.5% typical move */
  salesSigma?: number;
  /** 1σ of the build-cost multiplier */
  buildSigma?: number;
  seed?: number; // deterministic runs for tests/UI stability
}

export interface MonteCarloResult {
  iterations: number;
  landFixed: number; // the land price the simulation held constant
  profit: { p10: number; p50: number; p90: number; mean: number };
  poc: { p10: number; p50: number; p90: number };
  /** probability profit meets the target (targetProfitOnGdvPct of base GDV) */
  probAtTarget: number;
  probLoss: number;
}
