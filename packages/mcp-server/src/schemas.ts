import { z } from 'zod';

/**
 * The shapes the tools accept.
 *
 * Written here rather than imported from `@apex/types`, and that is deliberate
 * twice over. The MCP SDK wants a Zod RAW SHAPE per tool and turns it into the
 * JSON Schema a model reads, so these descriptions are not comments — they are
 * the documentation the calling model actually sees, and they say what a figure
 * MEANS and what unit it is in. And `@apex/types`' schemas exist to validate
 * what a browser posts to a tRPC procedure; sharing them would tie the two
 * surfaces together so that tightening one silently narrows the other.
 *
 * Money is in POUNDS everywhere in this file, because that is what the engine
 * works in. The pence boundary is the database's, and no part of it is here.
 */

const money = (what: string) => z.number().describe(`${what} — in pounds`);
const pct = (what: string) => z.number().describe(`${what} — as a percentage, so 7.5 means 7.5%`);

export const zUnit = z
  .object({
    label: z.string().describe('what the unit type is called, e.g. "2-bed apartment" or "Trade counter unit"'),
    count: z.number().min(0).describe('how many of this type'),
    area: z.number().min(0).describe('net internal area of ONE unit, in square feet'),
    cap: money('capital value per square foot for this unit type'),
  })
  .describe('one line of the accommodation schedule');

export const zTrade = z.object({
  label: z.string().describe('the trade, e.g. "Groundworks & substructure"'),
  rate: money('its rate per square foot of gross internal area'),
});

export const zOtherCost = z.object({
  label: z.string().describe('what the cost is, e.g. "CIL" or "S106"'),
  amount: money('the amount'),
});

export const zFinance = z.object({
  ltcPct: pct('senior debt as a share of construction cost'),
  ratePct: pct('interest rate per year'),
  periodMonths: z.number().min(1).max(60).describe('build programme, in months'),
  salesMonths: z.number().min(1).max(24).describe('sales or letting period after practical completion, in months'),
  arrangementFeePct: pct('arrangement fee on the facility'),
  spendProfile: z
    .enum(['scurve', 'even', 'linear', 'front', 'back'])
    .optional()
    .describe('how construction spend falls across the build. Defaults to an S-curve, which is what most schemes do.'),
});

export const zIncome = z
  .object({
    lines: z
      .array(
        z.object({
          label: z.string().describe('the tenancy or space'),
          count: z.number().min(0),
          area: z.number().min(0).describe('lettable area of one, in square feet'),
          rentPsf: money('passing rent per square foot per year'),
          voidPct: pct('void allowance').optional(),
          ervPsf: money('estimated rental value per square foot per year — omit to use the passing rent').optional(),
          yearsToReview: z.number().min(0).max(60).optional(),
          yieldPct: pct('a yield for this line alone — omit to use the scheme yield').optional(),
        }),
      )
      .describe('the rent roll'),
    method: z
      .enum(['perpetuity', 'termReversion', 'hardcore'])
      .optional()
      .describe('the investment method. Defaults to a perpetuity capitalisation.'),
    nonRecoverablePct: pct('non-recoverable outgoings, as a share of rent'),
    annualDeductions: money('fixed deductions per year').optional(),
    yieldPct: pct('the all-risks yield the net rent is capitalised at (a "cap rate" in the United States)'),
    reversionYieldPct: pct('the reversionary yield, for a term-and-reversion or hardcore valuation').optional(),
    purchaserCostsPct: pct("purchaser's costs deducted from the gross capital value. UK market standard is 6.8%.").optional(),
    letUpMonths: z.number().min(0).max(60).describe('let-up void, in months').optional(),
  })
  .describe(
    'The held-and-let element of a scheme, valued by the investment method and ADDED to GDV. ' +
      'Omit it entirely for a scheme that is built and sold. For an operated asset — build-to-rent, ' +
      'student accommodation, co-living, a care home, a hotel — this IS where the value comes from.',
  );

export const zDcf = z
  .object({
    holdYears: z.number().min(1).max(50),
    rentalGrowthPct: pct('rental growth per year'),
    discountRatePct: pct('the target rate the cashflows are discounted at'),
    exitYieldPct: pct('the yield the asset is sold at (a "terminal yield" in Australia)'),
    exitCostsPct: pct('costs of the sale').optional(),
    reviewCycleYears: z.number().min(1).max(25).optional(),
  })
  .describe(
    'A growth-explicit DCF over the held element. It is a CROSS-CHECK and never sets GDV — ' +
      'the capitalisation is what a report states as Market Value.',
  );

/** The full appraisal input, as a raw shape for `registerTool`. */
export const appraisalShape = {
  units: z.array(zUnit).describe('the accommodation schedule. Ignored when `phases` is given — a phased scheme owns its own.'),
  phases: z
    .array(
      z.object({
        name: z.string(),
        start: z.number().min(1).max(240).describe('the project month this phase starts on site'),
        buildMonths: z.number().min(1).max(60),
        salesMonths: z.number().min(1).max(24),
        absorptionUnitsPerMonth: z.number().positive().max(500).optional(),
        units: z.array(zUnit),
        trades: z.array(zTrade).optional().describe('omit to inherit the scheme rates'),
        profFeePct: pct('professional fees for this phase — omit to inherit').optional(),
        contingencyPct: pct('contingency for this phase — omit to inherit').optional(),
        otherCosts: z.array(zOtherCost).optional(),
      }),
    )
    .max(12)
    .optional()
    .describe('a phased programme, each phase drawing, completing and selling on its own clock'),
  efficiency: pct('net internal area as a share of gross internal area'),
  trades: z.array(zTrade).describe('the cost plan, trade by trade'),
  profFeePct: pct('professional fees, as a share of build cost'),
  contingencyPct: pct('contingency, as a share of build cost'),
  otherCosts: z.array(zOtherCost).describe('everything outside the build: planning obligations, project management, surveys'),
  finance: zFinance,
  site: z.object({
    mode: z
      .enum(['residual', 'profit'])
      .describe(
        'residual: solve the land value at the target profit. profit: take the land price as given and read the profit out.',
      ),
    landFixed: money('the land price — used when mode is "profit", ignored when residual'),
    acqPct: pct('acquisition costs on the land, excluding land tax'),
  }),
  disposal: z.object({ agentPct: pct('agency fee on sales'), legalPct: pct('legal fees on sales') }),
  targetProfitOnGdvPct: pct("the developer's target profit, as a share of GDV"),
  jv: z
    .object({ gpCoinvestPct: pct('GP co-investment'), prefPct: pct('preferred return per year'), promotePct: pct('promote') })
    .optional()
    .describe('a joint-venture waterfall — omit when the developer holds all the equity'),
  income: zIncome.optional(),
  dcf: zDcf.optional(),
  startYear: z.number().int().min(2000).max(2100).optional(),
  startMonth: z.number().int().min(0).max(11).optional().describe('0 = January'),
};

/** The flat, quick input — what a model can fill from one document. */
export const quickShape = {
  units: z.array(zUnit),
  efficiency: pct('net internal area as a share of gross internal area'),
  buildPerSqft: money('an all-in build rate per square foot of gross internal area'),
  profFeePct: pct('professional fees'),
  contingencyPct: pct('contingency'),
  cilPerSqm: money('the Community Infrastructure Levy rate, per SQUARE METRE of gross internal area (0 if none)'),
  s106: money('the S106 or planning-obligation contribution (0 if none)'),
  agentPct: pct('agency fee on sales'),
  legalPct: pct('legal fees on sales'),
  ltcPct: pct('senior debt as a share of construction cost'),
  ratePct: pct('interest rate per year'),
  periodMonths: z.number().min(1).max(120),
  salesMonths: z.number().min(1).max(24),
  arrangementFeePct: pct('arrangement fee on the facility'),
  targetProfitPct: pct('target profit as a share of GDV'),
  acqPct: pct('acquisition costs on the land, excluding SDLT'),
  asking: money('the asking price for the site — 0 when none has been quoted'),
};
