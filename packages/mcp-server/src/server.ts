import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ENGINE_VERSION,
  autoAppraise,
  capitaliseIncome,
  cilCharge,
  compareAppraisals,
  computeAppraisal,
  discountedCashflow,
  formatMoneyFull,
  formatPct,
  scenarioMetrics,
  sdltCommercial,
  sdltResidential,
  sensitivityGrid,
  type AppraisalInput,
  type AppraisalResult,
} from '@apex/appraisal-engine';
import { ASSET_CLASSES } from '@apex/types/asset-classes';
import { REGION_PROFILES, REGIONS } from '@apex/types/regions';
import { appraisalShape, quickShape, zDcf, zIncome } from './schemas.js';
import { NO_WORKSPACE, WorkspaceError, apiGet, workspaceFromEnv, type WorkspaceConfig } from './workspace-client.js';

/**
 * Apex Appraise over MCP: the deterministic engine, as tools.
 *
 * The product's first non-negotiable is that the LLM never computes a financial
 * figure — it extracts inputs, and the engine computes. Handing an assistant an
 * MCP server is where that rule either holds or quietly stops holding, because
 * the easiest thing to build is a server that fetches numbers and lets the model
 * do the arithmetic on them.
 *
 * So this server exposes the ENGINE, not a calculator's worth of primitives. A
 * model cannot assemble a GDV out of these tools by multiplying things it was
 * handed: it states the scheme and gets back the figures `computeAppraisal`
 * produced — the same function, in the same package, that the appraisal screen,
 * the .xlsx export, the Red Book certificate and the customer's own `/api/v1`
 * integration all call. Every figure it returns is one a valuer could sign,
 * because it is the figure a valuer's report would carry.
 *
 * Read-only throughout. The calculation tools touch no workspace at all; the
 * three that read one go through the public API with an org-scoped key, and
 * every route they call is a GET.
 */

const INSTRUCTIONS = `Apex Appraise — UK property development appraisal, over the same deterministic engine
that produces the figures on a signed valuation.

DO NOT COMPUTE FINANCIAL FIGURES YOURSELF. Do not multiply areas by rates, sum a cost plan,
work out interest, or solve a residual land value in your own reasoning, and do not correct or
round what a tool returns. Read the scheme's inputs out of whatever the user gives you, pass
them to a tool, and report what comes back. A figure you arrived at is not a figure anyone can
rely on; a figure from the engine is the one the report will carry.

Money is in POUNDS everywhere, in and out. Areas and rates are per SQUARE FOOT, except the
infrastructure levy, which every UK charging schedule states per square metre.

Start with apex_conventions if you have not used this server before — it names the engine
version every figure came from, the asset classes, and what each jurisdiction calls things.`;

/** The headline of an appraisal, for the text a person reads beside the data. */
function headline(r: AppraisalResult, mode: 'residual' | 'profit'): string {
  const lines = [
    `GDV ${formatMoneyFull(r.gdv)} over ${Math.round(r.nia).toLocaleString('en-GB')} ft² NIA`,
    `Total development cost ${formatMoneyFull(r.totalCost)}`,
    mode === 'residual'
      ? `Residual land value ${formatMoneyFull(r.residualNet)} (gross of acquisition costs, ${formatMoneyFull(r.landGross)})`
      : `Developer profit ${formatMoneyFull(r.profit)}`,
    `Profit on cost ${formatPct(r.poc, 1)}, on GDV ${formatPct(r.rogdv, 1)}`,
    `Peak debt ${formatMoneyFull(r.facility)}, equity ${formatMoneyFull(r.equity)}`,
  ];
  if (r.investmentValue > 0) {
    lines.splice(1, 0, `— of which ${formatMoneyFull(r.salesGdv)} sold on and ${formatMoneyFull(r.investmentValue)} capitalised`);
  }
  return `${lines.join('\n')}\n\nEngine ${ENGINE_VERSION}.`;
}

/**
 * What a tool hands back: prose for a person, structure for a program.
 *
 * No `outputSchema` on the appraisal tools, and that is a decision rather than
 * an omission. Declaring one means writing the engine's result shape out a
 * second time, in a second package, where it can drift from the first — which
 * is the exact defect `one-engine-sweep` exists to catch, wearing the clothes of
 * good practice. The small tools below, whose shape is three numbers this file
 * owns outright, do declare one.
 */
const answer = (text: string, data: unknown) => ({
  content: [{ type: 'text' as const, text }],
  structuredContent: data as Record<string, unknown>,
});

const failed = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

const READS_NOTHING = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const READS_WORKSPACE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export interface ServerDeps {
  /** null when no API key is configured — the calculation tools do not need one */
  workspace: WorkspaceConfig | null;
}

export function createServer(deps: ServerDeps = { workspace: workspaceFromEnv() }): McpServer {
  const server = new McpServer({ name: 'apex-appraise', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  // ---------------------------------------------------------------- the engine

  server.registerTool(
    'apex_conventions',
    {
      title: 'What this engine computes, and what things are called',
      description:
        'The engine version every figure is produced by, the asset classes a scheme can be, and the vocabulary and ' +
        'floor-area unit of each region this product supports. Call it first: it is how you find out that student ' +
        'accommodation is its own class rather than "residential", and that a US reader says "cap rate" where a UK ' +
        'one says "all-risks yield". Costs nothing and touches no workspace.',
      inputSchema: {},
      annotations: READS_NOTHING,
    },
    async () => {
      const data = {
        engineVersion: ENGINE_VERSION,
        money: 'Every figure in and out of this server is in pounds. Money never changes with the region.',
        assetClasses: ASSET_CLASSES.map((c) => ({
          code: c.code,
          label: c.label,
          incomeLed: c.incomeLed,
          planningUseClassEnglandWales: c.useClass,
        })),
        regions: REGIONS.map((code) => {
          const p = REGION_PROFILES[code];
          return { code, label: p.label, areaUnit: p.areaUnit, terms: p.terms, landTaxModelled: p.landTaxModelled, redBook: p.redBook };
        }),
        note:
          'The land tax this engine computes is England & Northern Ireland SDLT. `landTaxModelled` is true only for GB: ' +
          'elsewhere the duty is real and this engine does not model it, so say where the figure came from rather than ' +
          'presenting it under a local name.',
      };
      return answer(
        `Engine ${ENGINE_VERSION}. ${ASSET_CLASSES.length} asset classes, ${ASSET_CLASSES.filter((c) => c.incomeLed).length} of them income-led. ` +
          `Regions: ${REGIONS.join(', ')}. Money is in pounds in all of them.`,
        data,
      );
    },
  );

  server.registerTool(
    'apex_appraise',
    {
      title: 'Appraise a development scheme',
      description:
        'The full residual appraisal, from the same function every screen and report in Apex Appraise calls. Give it ' +
        'the accommodation, the cost plan, the finance and the disposal assumptions and it returns GDV, total cost, ' +
        'the residual land value (or the profit, if the land price is fixed), returns, peak debt and the monthly ' +
        'cashflow. Use `site.mode: "residual"` to solve what the site is worth at a target profit, or "profit" to ' +
        'take a price as given and read the profit out. Add `income` for a held-and-let element — for an operated ' +
        'asset (build-to-rent, student, co-living, care home, hotel) that is where the value comes from.',
      inputSchema: { ...appraisalShape, includeCashflow: z.boolean().optional().describe('include the month-by-month cashflow rows. Off by default — they are long, and the totals are in the result either way.') },
      annotations: READS_NOTHING,
    },
    async (args) => {
      const { includeCashflow, ...input } = args as typeof args & { includeCashflow?: boolean };
      /**
       * `withCash` ALWAYS. It is what produces peak debt over the programme and
       * the two IRRs, and those are headline figures rather than an extra — an
       * appraisal answering "what is the project IRR" with nothing is not a
       * cheaper appraisal, it is an incomplete one. What `includeCashflow`
       * decides is only whether the month-by-month ROWS come back with it,
       * because those are long and a model rarely needs them to answer.
       */
      const result = computeAppraisal(input as unknown as AppraisalInput, { withCash: true });
      const { cash, ...rest } = result;
      const data = {
        engineVersion: ENGINE_VERSION,
        ...rest,
        cash: cash ? { peak: cash.peak, totalMonths: cash.totalMonths, projIrr: cash.projIrr, eqIrr: cash.eqIrr, ...(includeCashflow ? { rows: cash.rows } : {}) } : undefined,
      };
      return answer(headline(result, (input as AppraisalInput).site.mode), data);
    },
  );

  server.registerTool(
    'apex_appraise_quick',
    {
      title: 'Appraise from a single set of headline assumptions',
      description:
        'The same arithmetic as apex_appraise, taking one blended build rate rather than a trade-by-trade cost plan — ' +
        'what you can fill in from one planning notice or cost summary. It also computes the SDLT on the land and the ' +
        'CIL on the floorspace. Use apex_appraise instead once the scheme has a real cost plan, phases or a rent roll.',
      inputSchema: quickShape,
      annotations: READS_NOTHING,
    },
    async (args) => {
      const r = autoAppraise(args as never);
      /**
       * No verdict here, and that is not an oversight. The screens print one
       * ("Proceed" / "Caution"), and it is a judgement made against the FIRM's
       * own thresholds, which live on their workspace and not in this engine.
       * A verdict invented in an MCP server would read as the product's opinion
       * of the scheme while being nobody's.
       */
      return answer(
        `GDV ${formatMoneyFull(r.gdv)}. Residual land value ${formatMoneyFull(r.residualNet)}, ` +
          `profit ${formatMoneyFull(r.profit)} at ${formatPct(r.poc, 1)} on cost.\n` +
          (r.rocAtAsking == null
            ? 'No asking price was given, so there is no return at asking to report.'
            : `At the asking price the return on cost is ${formatPct(r.rocAtAsking, 1)}, with headroom of ${formatMoneyFull(r.headroom ?? 0)}.`) +
          `\n\nSDLT on the land ${formatMoneyFull(r.sdlt)} (England & Northern Ireland bands), CIL ${formatMoneyFull(r.cil)}.\n\n` +
          `Engine ${ENGINE_VERSION}.`,
        { engineVersion: ENGINE_VERSION, ...r },
      );
    },
  );

  server.registerTool(
    'apex_sensitivity',
    {
      title: 'Sensitise an appraisal against sales and build movements',
      description:
        'Re-runs the WHOLE appraisal — including monthly finance — at each combination of sales-value and build-cost ' +
        'movement, and returns the grid. Not a multiplication of the base case: a 10% build overrun changes the ' +
        'facility, which changes the interest, which changes the residual, and only re-running catches that.',
      inputSchema: {
        ...appraisalShape,
        metric: z.enum(['roc', 'profit', 'residual']).describe('what each cell reports: return on cost, profit, or residual land value'),
        steps: z.array(z.number()).max(9).optional().describe('the movements to test, as fractions: [-0.1, -0.05, 0, 0.05, 0.1] by default'),
      },
      annotations: READS_NOTHING,
    },
    async (args) => {
      const { metric, steps, ...input } = args as typeof args & { metric: 'roc' | 'profit' | 'residual'; steps?: number[] };
      const grid = sensitivityGrid(input as unknown as AppraisalInput, metric, steps ?? [-0.1, -0.05, 0, 0.05, 0.1]);
      const base = grid.flat().find((c) => c.isBase);
      return answer(
        `${grid.length} × ${grid[0]?.length ?? 0} grid of ${metric}. Base cell ${
          base ? (metric === 'roc' ? formatPct(base.value, 1) : formatMoneyFull(base.value)) : 'n/a'
        }. Engine ${ENGINE_VERSION}.`,
        { engineVersion: ENGINE_VERSION, metric, grid },
      );
    },
  );

  server.registerTool(
    'apex_compare_schemes',
    {
      title: 'Compare scheme options on the levers that differ',
      description:
        'Four levers per option — blended sales rate, build rate, floor area and target profit — and the residual, ' +
        'GDV, cost, profit and return each produces. For choosing between consented schemes or massing options. It ' +
        'ranks them by residual land value and says so; the ranking is the engine\'s, not an opinion.',
      inputSchema: {
        options: z
          .array(
            z.object({
              name: z.string().describe('what to call this option, e.g. "Option A — 42 flats"'),
              blendedPsf: z.number().describe('blended sales value per square foot, in pounds'),
              buildPsf: z.number().describe('build cost per square foot of GIA, in pounds'),
              gia: z.number().describe('gross internal area, in square feet'),
              targetProfitPct: z.number().describe('target profit as a share of GDV, as a percentage'),
            }),
          )
          .min(2)
          .max(6),
      },
      annotations: READS_NOTHING,
    },
    async ({ options }) => {
      const scored = (options as Array<{ name: string; blendedPsf: number; buildPsf: number; gia: number; targetProfitPct: number }>).map((o) => ({
        name: o.name,
        ...scenarioMetrics({ blendedPsf: o.blendedPsf, buildPsf: o.buildPsf, gia: o.gia, targetProfitPct: o.targetProfitPct }),
      }));
      const ranked = [...scored].sort((a, b) => b.residual - a.residual);
      return answer(
        `On residual land value, best first:\n${ranked
          .map((s, i) => `${i + 1}. ${s.name} — residual ${formatMoneyFull(s.residual)}, GDV ${formatMoneyFull(s.gdv)}, profit on cost ${formatPct(s.poc, 1)}`)
          .join('\n')}\n\nEngine ${ENGINE_VERSION}.`,
        { engineVersion: ENGINE_VERSION, options: scored, bestByResidual: ranked[0]?.name ?? null },
      );
    },
  );

  server.registerTool(
    'apex_capitalise_income',
    {
      title: 'Value a rent roll by the investment method',
      description:
        'Net rent from a rent roll, capitalised at the all-risks yield (a "cap rate" in the United States) and net of ' +
        "purchaser's costs. Perpetuity, term-and-reversion or hardcore. This is the value of an operated asset — " +
        'build-to-rent, student accommodation, co-living, a care home, a hotel — and of the held element of a scheme ' +
        'that is part sold and part retained.',
      inputSchema: { income: zIncome },
      annotations: READS_NOTHING,
    },
    async ({ income }) => {
      const r = capitaliseIncome(income as never);
      return answer(
        `Gross rent ${formatMoneyFull(r.grossRent)} pa, net rent ${formatMoneyFull(r.netRent)} pa.\n` +
          `Gross capital value ${formatMoneyFull(r.grossCapitalValue)}, net of purchaser's costs ${formatMoneyFull(r.netCapitalValue)}.\n` +
          `Blended rent £${r.blendedRentPsf.toFixed(2)}/ft² over ${Math.round(r.totalArea).toLocaleString('en-GB')} ft².\n\nEngine ${ENGINE_VERSION}.`,
        { engineVersion: ENGINE_VERSION, ...r },
      );
    },
  );

  server.registerTool(
    'apex_dcf',
    {
      title: 'Cross-check a capitalisation with a growth-explicit DCF',
      description:
        'Projects the rent through its reviews, sells at the exit yield and discounts at a target rate. A CROSS-CHECK: ' +
        'the capitalisation stays the reported value, and the equated yield this returns is the rate at which the two ' +
        'agree. Never present the NPV as the valuation.',
      inputSchema: { income: zIncome, dcf: zDcf },
      annotations: READS_NOTHING,
    },
    async ({ income, dcf }) => {
      const r = discountedCashflow(income as never, dcf as never);
      return answer(
        `Net present value ${formatMoneyFull(r.netPresentValue)} over ${(dcf as { holdYears: number }).holdYears} years — ` +
          `${formatMoneyFull(r.incomePv)} from income, ${formatMoneyFull(r.exitPv)} from the sale.\n` +
          `Equated yield ${formatPct(r.equatedYield, 2)}. The reported value remains the capitalisation.\n\nEngine ${ENGINE_VERSION}.`,
        { engineVersion: ENGINE_VERSION, ...r },
      );
    },
  );

  server.registerTool(
    'apex_land_tax',
    {
      title: 'Stamp Duty Land Tax on a purchase',
      description:
        'SDLT on a land or property purchase, on the slice bands. ENGLAND AND NORTHERN IRELAND ONLY — Scotland levies ' +
        'LBTT and Wales LTT, on different bands, and neither is this. Say which tax the figure is when you report it.',
      inputSchema: {
        price: z.number().min(0).describe('the purchase price, in pounds'),
        basis: z.enum(['commercial', 'residential']).describe('non-residential and mixed use, or residential'),
        additionalDwelling: z.boolean().optional().describe('residential only: the higher rate for an additional dwelling'),
      },
      outputSchema: { tax: z.number(), effectiveRatePct: z.number(), basis: z.string(), jurisdiction: z.string() },
      annotations: READS_NOTHING,
    },
    async ({ price, basis, additionalDwelling }) => {
      const tax = basis === 'residential' ? sdltResidential(price, { additionalDwelling }) : sdltCommercial(price);
      const data = {
        tax: Math.round(tax * 100) / 100,
        effectiveRatePct: price > 0 ? Math.round((tax / price) * 10000) / 100 : 0,
        basis,
        jurisdiction: 'England & Northern Ireland (SDLT)',
      };
      return answer(
        `SDLT on ${formatMoneyFull(price)} (${basis}${additionalDwelling ? ', additional dwelling' : ''}) is ${formatMoneyFull(tax)} — ` +
          `an effective rate of ${data.effectiveRatePct}%. England & Northern Ireland bands.`,
        data,
      );
    },
  );

  server.registerTool(
    'apex_infrastructure_levy',
    {
      title: 'Community Infrastructure Levy on new floorspace',
      description:
        'CIL at a charging-schedule rate. The rate is per SQUARE METRE, as every charging schedule states it, and the ' +
        'area is in square feet, as the rest of this server takes areas — the conversion is done here so it is done once.',
      inputSchema: {
        giaSqFt: z.number().min(0).describe('gross internal area, in square feet'),
        ratePerSqm: z.number().min(0).describe('the charging-schedule rate, in pounds per square metre'),
      },
      outputSchema: { charge: z.number(), giaSqM: z.number(), ratePerSqm: z.number() },
      annotations: READS_NOTHING,
    },
    async ({ giaSqFt, ratePerSqm }) => {
      const charge = cilCharge(giaSqFt, ratePerSqm);
      const data = { charge: Math.round(charge * 100) / 100, giaSqM: Math.round((charge / (ratePerSqm || 1)) * 100) / 100, ratePerSqm };
      return answer(
        `CIL on ${Math.round(giaSqFt).toLocaleString('en-GB')} ft² GIA at £${ratePerSqm}/m² is ${formatMoneyFull(charge)}.`,
        data,
      );
    },
  );

  server.registerTool(
    'apex_compare_appraisals',
    {
      title: 'What changed between two versions of an appraisal',
      description:
        'Takes two complete appraisal inputs and reports what moved, both in the assumptions and in the figures they ' +
        'produce. For answering "why is the residual £200k lower than last month" without guessing at it.',
      inputSchema: { before: z.object(appraisalShape), after: z.object(appraisalShape) },
      annotations: READS_NOTHING,
    },
    async ({ before, after }) => {
      const b = before as unknown as AppraisalInput;
      const a = after as unknown as AppraisalInput;
      const diff = compareAppraisals(b, a);
      // the figures either side come from the engine too — this file does not
      // subtract one GDV from another and call the answer a movement
      const rb = computeAppraisal(b);
      const ra = computeAppraisal(a);
      return answer(
        `${diff.changes.length} assumption${diff.changes.length === 1 ? '' : 's'} moved${diff.identical ? ' (the inputs are identical)' : ''}.\n` +
          diff.changes.map((c) => `• ${c.label}: ${c.before} → ${c.after}`).join('\n') +
          `\n\nGDV ${formatMoneyFull(rb.gdv)} → ${formatMoneyFull(ra.gdv)}. ` +
          `Residual land value ${formatMoneyFull(rb.residualNet)} → ${formatMoneyFull(ra.residualNet)}. ` +
          `Profit on cost ${formatPct(rb.poc, 1)} → ${formatPct(ra.poc, 1)}.\n\nEngine ${ENGINE_VERSION}.`,
        {
          engineVersion: ENGINE_VERSION,
          ...diff,
          figures: {
            before: { gdv: rb.gdv, totalCost: rb.totalCost, profit: rb.profit, poc: rb.poc, residualNet: rb.residualNet },
            after: { gdv: ra.gdv, totalCost: ra.totalCost, profit: ra.profit, poc: ra.poc, residualNet: ra.residualNet },
          },
        },
      );
    },
  );

  // ------------------------------------------------------------- the workspace

  const needWorkspace = (): WorkspaceConfig => {
    if (!deps.workspace) throw new WorkspaceError(NO_WORKSPACE);
    return deps.workspace;
  };

  const guarded = <T>(run: () => Promise<T>) =>
    run().catch((e: unknown) => {
      if (e instanceof WorkspaceError) return failed(e.message);
      throw e;
    });

  server.registerTool(
    'apex_deals_list',
    {
      title: "Deals in the signed-in firm's workspace",
      description:
        'The pipeline, newest first, with each deal\'s indicative GDV. Needs APEX_API_KEY. Paginated by cursor rather ' +
        'than offset, so a page cannot shift under you while somebody adds a deal.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('up to 100; 25 by default'),
        cursor: z.string().optional().describe('the nextCursor from the previous page'),
        stage: z
          .enum(['SOURCING', 'APPRAISAL', 'OFFER', 'ACQUISITION', 'CONSTRUCTION', 'SALES_LETTING', 'COMPLETED'])
          .optional()
          .describe('only deals at this stage'),
      },
      annotations: READS_WORKSPACE,
    },
    async ({ limit, cursor, stage }) =>
      guarded(async () => {
        const cfg = needWorkspace();
        const body = await apiGet<{ data: Array<{ name: string; stage: string; gdv: number }>; pagination: { nextCursor: string | null } }>(
          cfg,
          '/api/v1/deals',
          { limit: limit?.toString(), cursor, stage },
        );
        return answer(
          `${body.data.length} deal${body.data.length === 1 ? '' : 's'}:\n` +
            body.data.map((d) => `• ${d.name} — ${d.stage.toLowerCase().replace('_', '/')}, GDV ${formatMoneyFull(d.gdv)}`).join('\n') +
            (body.pagination.nextCursor ? `\n\nMore: pass cursor "${body.pagination.nextCursor}".` : ''),
          body,
        );
      }),
  );

  server.registerTool(
    'apex_deal_get',
    {
      title: 'One deal, with the figures its current appraisal produces',
      description:
        'A deal and its current appraisal, computed by the engine at the moment you ask — not a cached number. ' +
        '`reviewStatus` says whether a person has approved it, and `engineVersion` is the engine that signed it if ' +
        'one has: quote both when you report the figures. Needs APEX_API_KEY.',
      inputSchema: { dealId: z.string().describe('the deal id, from apex_deals_list') },
      annotations: READS_WORKSPACE,
    },
    async ({ dealId }) =>
      guarded(async () => {
        const cfg = needWorkspace();
        const body = await apiGet<{ data: { name: string; appraisal: { gdv: number; profit: number; profitOnCost: number; reviewStatus: string } | null } }>(
          cfg,
          `/api/v1/deals/${encodeURIComponent(dealId)}`,
        );
        const a = body.data.appraisal;
        return answer(
          a
            ? `${body.data.name}: GDV ${formatMoneyFull(a.gdv)}, profit ${formatMoneyFull(a.profit)}, ` +
              `profit on cost ${formatPct(a.profitOnCost, 1)}. Review status: ${a.reviewStatus}.`
            : `${body.data.name} has no saved appraisal yet.`,
          body,
        );
      }),
  );

  server.registerTool(
    'apex_portfolio_exposure',
    {
      title: 'Portfolio exposure, concentration and covenant breaches',
      description:
        'Every position with a current appraisal, rolled up: facility, drawn, equity, concentration by asset class ' +
        'and by region, and any breach of the firm\'s own covenants. `drawnSource` says whether "drawn" is the bank ' +
        'feed or committed spend — they are different claims and it matters which. Needs APEX_API_KEY.',
      inputSchema: {},
      annotations: READS_WORKSPACE,
    },
    async () =>
      guarded(async () => {
        const cfg = needWorkspace();
        const body = await apiGet<{ data: { totals?: { facility?: number; drawn?: number }; positions?: unknown[] } }>(cfg, '/api/v1/exposure');
        const n = body.data.positions?.length ?? 0;
        return answer(
          `${n} position${n === 1 ? '' : 's'} with a current appraisal. ` +
            (body.data.totals?.facility != null ? `Facility ${formatMoneyFull(body.data.totals.facility)}.` : ''),
          body,
        );
      }),
  );

  return server;
}
