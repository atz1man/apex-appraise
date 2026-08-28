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

/**
 * When a cost line actually falls, independent of the scheme-wide profile.
 * Groundworks front-load, fit-out lands late, an S106 payment is a single
 * lump at implementation — spreading them all identically misstates interest
 * and peak debt. Omit and the line follows the scheme profile over the build.
 */
export interface CostTiming {
  start?: number; // 1-based project month the line starts
  months?: number; // how long it spreads (1 = a single lump)
  profile?: SpendProfileKey; // how it spreads within its own window
}

export interface BuildTrade {
  label: string;
  rate: number; // £/ft² — Σ rates = build rate
  timing?: CostTiming;
}

export interface OtherCost {
  label: string;
  amount: number; // £
  timing?: CostTiming;
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
  /**
   * The mezzanine tranche, when the stack has one — see capitalStack().
   *
   * The ENGINE'S OWN FIGURES DO NOT USE THIS. `interest` is senior debt only,
   * compounding monthly on the drawn balance, and profit, return on cost and
   * the residual land value follow from that. The mezzanine is carried here so
   * the stack has one shared definition and the terms persist; treating its
   * cost as an appraisal input is a financial-modelling decision that has not
   * been made. The panel that shows it says so.
   */
  mezz?: { toPct: number; ratePct: number; drawFactorPct: number };
}

export type SiteMode = 'residual' | 'profit';

/** One line of the rent roll — a tenancy or a block of like-for-like lettable units. */
export interface IncomeLine {
  label: string;
  count: number;
  area: number; // sqft NIA per unit
  /** PASSING rent — what the tenant pays today, £/ft² per annum */
  rentPsf: number;
  /** structural void / bad-debt allowance on this line, % of its gross rent */
  voidPct?: number;
  /**
   * Estimated rental value — what the space would let for today. Above the
   * passing rent the tenancy is reversionary and the uplift is worth something
   * at the next review or expiry. Omit and it equals the passing rent.
   */
  ervPsf?: number;
  /** years until the next review or expiry — when the ERV can be captured */
  yearsToReview?: number;
  /** this tenancy's own yield; omit to use the scheme yield */
  yieldPct?: number;
}

/**
 * Investment-method inputs (RICS): the part of the scheme that is HELD and let
 * rather than sold on. Capitalised at an all-risks yield to a capital value.
 */
/**
 * How a reversion is valued.
 * - `perpetuity`  — capitalise the net passing rent in perpetuity; no reversion.
 * - `termReversion` — the passing rent for the term, then the ERV in perpetuity
 *   deferred to the review date (the classic vertical split).
 * - `hardcore` — the passing rent in perpetuity as the bottom slice, plus the
 *   uplift as a deferred top slice (the horizontal split).
 */
export type IncomeMethod = 'perpetuity' | 'termReversion' | 'hardcore';

export interface IncomeInput {
  lines: IncomeLine[];
  /** default `perpetuity`, which is what a scheme with no reversions needs */
  method?: IncomeMethod;
  /**
   * Yield applied to the reversion (term & reversion) or the top slice
   * (hardcore). Omit to use each line's own yield.
   */
  reversionYieldPct?: number;
  /** non-recoverable running costs (management, insurance, repairs) as % of rent after voids */
  nonRecoverablePct: number;
  /** fixed annual deductions — ground rent, service-charge shortfall (£/yr) */
  annualDeductions?: number;
  /** all-risks yield used to capitalise the net rent, % */
  yieldPct: number;
  /** purchaser's costs, % — UK standard 6.8% (SDLT 5% + agent + legal). Default 6.8. */
  purchaserCostsPct?: number;
  /** rent-free / letting void at completion, months — taken as a capital deduction */
  letUpMonths?: number;
}

export interface IncomeLineResult {
  label: string;
  count: number;
  area: number;
  totalArea: number; // count × area
  grossRent: number; // £/yr passing, before voids
  voidAllowance: number;
  rentAfterVoid: number;
  /** net of voids, non-recoverables and this line's share of fixed deductions */
  netPassing: number;
  /** the same treatment applied to the ERV */
  netErv: number;
  grossErv: number;
  yearsToReview: number;
  yieldUsed: number; // % — term/core yield
  reversionYieldUsed: number; // % — reversion/top-slice yield
  /** capitalised value of this tenancy before let-up and purchaser's costs */
  value: number;
  /** the two halves of the split, whichever method produced them */
  termValue: number;
  reversionValue: number;
  isReversionary: boolean;
}

export interface IncomeResult {
  lines: IncomeLineResult[];
  totalArea: number; // lettable NIA
  grossRent: number; // £/yr headline
  voidAllowance: number;
  nonRecoverable: number;
  deductions: number;
  netRent: number; // NOI £/yr
  yearsPurchase: number; // 1 / yield
  grossCapitalValue: number; // netRent × YP
  letUpDeduction: number;
  capitalValueBeforeCosts: number; // what a purchaser pays in total, costs included
  purchaserCosts: number;
  netCapitalValue: number; // the GDV contribution — price net of purchaser's costs
  netInitialYield: number; // fraction — net passing rent ÷ costs-inclusive price
  /** fraction — net ERV ÷ costs-inclusive price; what the yield becomes on reversion */
  reversionaryYield: number;
  /**
   * The single yield that reproduces this valuation — the figure a UK valuer
   * quotes. Equal to the net initial yield when nothing is reversionary.
   */
  equivalentYield: number;
  /** £/yr of ERV, net of the same deductions as the passing rent */
  netErv: number;
  grossErv: number;
  method: IncomeMethod;
  capitalValuePsf: number;
  blendedRentPsf: number;
}

/**
 * Growth-explicit DCF inputs.
 *
 * The investment method capitalises today's rent at an all-risks yield, so
 * growth is IMPLICIT in that yield. A DCF states growth openly instead:
 * project the rent forward, step it at each review, sell at the end, and
 * discount everything at a target rate. The two are reconciled by the equated
 * yield — the discount rate at which the DCF reproduces the capitalised value.
 */
export interface DcfInput {
  /** years held before sale */
  holdYears: number;
  /** rental growth per annum, % */
  rentalGrowthPct: number;
  /** target rate the cashflow is discounted at, % */
  discountRatePct: number;
  /** yield the rent is capitalised at on exit, % */
  exitYieldPct: number;
  /** sale costs at exit, % of the gross exit value */
  exitCostsPct?: number;
  /** rent-review cycle in years — UK standard is 5 */
  reviewCycleYears?: number;
}

export interface DcfYear {
  year: number;
  /** net rent receivable in this year, after reviews and growth */
  rent: number;
  /** true when a review lands in this year */
  reviewed: boolean;
  discountFactor: number;
  presentValue: number;
}

export interface DcfResult {
  years: DcfYear[];
  /** present value of the rent over the hold */
  incomePv: number;
  /** rent running at the moment of sale — what the buyer capitalises */
  exitRent: number;
  exitValueGross: number;
  exitCosts: number;
  exitValueNet: number;
  exitPv: number;
  /** incomePv + exitPv */
  netPresentValue: number;
  /** share of value from income vs from the sale — a hold's honesty check */
  pvFromIncome: number;
  pvFromExit: number;
  /**
   * The discount rate at which this DCF equals the capitalised (all-risks)
   * value. Equal to the all-risks yield when growth is nil — that identity is
   * the cross-check between the two methods.
   */
  equatedYield: number;
}

/**
 * One phase of a phased scheme: its own accommodation, its own place in the
 * programme, its own sales window. Phases share one facility — that is the
 * point of phasing, since receipts from an early phase fund a later one and
 * hold peak debt down.
 */
export interface Phase {
  name: string;
  /** 1-based project month the phase starts on site */
  start: number;
  buildMonths: number;
  /** sales window after this phase completes; ignored when absorption is set */
  salesMonths: number;
  /** units/month for this phase — derives its own sales window */
  absorptionUnitsPerMonth?: number;
  units: AppraisalUnit[];

  // ---- cost overrides: omit any of these and the phase inherits the scheme ----
  /** replaces the scheme trades for this phase — a podium block is not a terrace */
  trades?: BuildTrade[];
  profFeePct?: number;
  contingencyPct?: number;
  /**
   * Costs belonging to this phase alone (remediation, a s278, its own marketing).
   * Timing here is RELATIVE TO THE PHASE: start 1 is the phase's first month.
   */
  otherCosts?: OtherCost[];
}

export interface PhaseResult {
  name: string;
  start: number;
  buildMonths: number;
  salesMonths: number;
  /** last month of this phase's build (start + buildMonths − 1) */
  practicalCompletion: number;
  /** last month of this phase's sales window */
  end: number;
  nia: number;
  gia: number;
  gdv: number;
  /** £/ft² applied to this phase (its own trades, or the scheme's) */
  buildRate: number;
  /** the trade list actually used — the phase's own, or the scheme's */
  trades: BuildTrade[];
  /** true when the phase overrides the scheme's trade list */
  ownTrades: boolean;
  build: number;
  fees: number;
  cont: number;
  /** construction incl. fees and contingency — excludes this phase's other costs */
  cost: number;
  /** costs booked to this phase alone */
  otherTotal: number;
  unitCount: number;
}

export interface AppraisalInput {
  units: AppraisalUnit[];
  /**
   * Phased programme. When present the phases' units are the scheme's
   * accommodation and `units` above is ignored — the phase schedule owns both
   * the revenue and the build programme.
   */
  phases?: Phase[];
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
  /** Held-and-let element valued by the investment method; adds to GDV. Omit for a pure sales scheme. */
  income?: IncomeInput;
  /**
   * Growth-explicit DCF settings. A CROSS-CHECK only: GDV stays driven by the
   * capitalisation, which is what the report states as Market Value.
   */
  dcf?: DcfInput;
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
  /** GDV split — units sold on vs the capitalised value of the held element */
  salesGdv: number;
  investmentValue: number;
  /** present only when the appraisal carries a rent roll */
  income?: IncomeResult;
  /** present only when the scheme is phased */
  phases?: PhaseResult[];
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
  /**
   * The acquisition cost inside `landGross` — SDLT, agent and legal on the land.
   *
   * `landGross` is what the scheme can afford to spend acquiring the site;
   * `residualNet` is what it can pay the vendor. The difference is this, and
   * every surface that prints the residual waterfall needs it as a LINE, or the
   * column does not add up: on the golden fixture the printed rows total
   * £434,368 against a stated residual of £406,711, a £27,656 step with nothing
   * on the page to explain it.
   *
   * Exported rather than left to callers for the reason the JV result records
   * one field down — callers "re-derived them by hand, each with its own copy of
   * the acquisition-cost rule".
   */
  acqCost: number;
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

/**
 * One cell of the growth × exit-yield matrix over a held element.
 *
 * The deltas are percentage POINTS, not multipliers: a valuer sensitises an exit
 * yield by 25 or 50 basis points, and "10% off a 5.5% yield" is not a sentence
 * anyone says. Growth moves in whole points for the same reason.
 */
export interface DcfSensitivityCell {
  /** the assumptions this cell was actually run at */
  rentalGrowthPct: number;
  exitYieldPct: number;
  growthDelta: number;
  yieldDelta: number;
  netPresentValue: number;
  isBase: boolean;
  /** NPV relative to the centre cell — drives colouring */
  ratio: number;
  /**
   * NPV against the capitalisation, which is the REPORTED value. Below 1 means
   * the growth-explicit view does not support the figure being reported.
   */
  vsCapitalisation: number;
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
  /** land at the residual, grossed for acquisition costs — the basis `totalCost` uses */
  landGross: number;
  /**
   * Cost and return AT THE RESIDUAL land value, which is the case every screen
   * uses when no asking price is being tested. These were previously computed
   * only for an asking price, so callers that needed them without one re-derived
   * them by hand — each with its own copy of the acquisition-cost rule.
   */
  totalCost: number;
  profit: number;
  poc: number;
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
