import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ENGINE_VERSION, cilCharge, computeAppraisal, type AppraisalInput } from '@apex/appraisal-engine';
import { createServer } from '../src/server.js';
import { NO_WORKSPACE, workspaceFromEnv, type WorkspaceConfig } from '../src/workspace-client.js';

/**
 * The MCP server, driven the way a client drives it.
 *
 * Over a real transport and a real client, not by calling the handlers: the
 * thing that can be wrong here is the wiring — a schema that will not accept
 * what a model would sensibly send, a tool that is registered but unreachable,
 * a result the SDK refuses to serialise. Calling the callback directly tests
 * none of that.
 */
async function connect(workspace: WorkspaceConfig | null = null) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([createServer({ workspace }).connect(serverSide), client.connect(clientSide)]);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };

/** The golden Bournemouth scheme, as `engine.test.ts` holds it. */
const bournemouth: AppraisalInput = {
  units: [
    { label: 'Trade counter units', count: 6, area: 2600, cap: 225 },
    { label: 'Mezzanine offices', count: 1, area: 3200, cap: 240 },
  ],
  efficiency: 90,
  trades: [{ label: 'Build', rate: 105 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [
    { label: 'Planning & S106', amount: 150000 },
    { label: 'CIL', amount: cilCharge(18800 / 0.9, 40) },
  ],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 3, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 350000, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
  jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
};

describe('the tools a client can see', () => {
  it('offers every tool with a description and a read-only annotation', async () => {
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'apex_appraise',
      'apex_appraise_quick',
      'apex_capitalise_income',
      'apex_compare_appraisals',
      'apex_compare_schemes',
      'apex_conventions',
      'apex_dcf',
      'apex_deal_get',
      'apex_deals_list',
      'apex_infrastructure_levy',
      'apex_land_tax',
      'apex_portfolio_exposure',
      'apex_sensitivity',
    ]);
    for (const t of tools) {
      expect(t.description?.length ?? 0, `${t.name} has no description`).toBeGreaterThan(80);
      // NOTHING here writes. The moment one of these is false, the audit-trail
      // question this server currently does not have to answer becomes live.
      expect(t.annotations?.readOnlyHint, `${t.name} is not marked read-only`).toBe(true);
      expect(t.annotations?.destructiveHint, `${t.name} is marked destructive`).toBe(false);
    }
  });

  it('tells the model, in its instructions, not to do the arithmetic itself', async () => {
    // the product's first non-negotiable, said where the model will read it
    const client = await connect();
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toMatch(/DO NOT COMPUTE FINANCIAL FIGURES YOURSELF/);
    expect(instructions).toMatch(/pounds/i);
  });
});

describe('the figures are the engine’s, to the penny', () => {
  it('appraises the golden Bournemouth scheme exactly as the engine does', async () => {
    const client = await connect();
    const res = await call(client, 'apex_appraise', bournemouth as unknown as Record<string, unknown>);
    const direct = computeAppraisal(bournemouth);

    // the fixture the engine's own suite is locked to
    expect(res.structuredContent!.gdv).toBe(4_278_000);
    expect(res.structuredContent!.residualNet).toBeCloseTo(406_711.36, 2);
    expect(res.structuredContent!.poc).toBeCloseTo(0.25, 2);

    // and every headline figure agrees with calling the engine directly — which
    // is the claim the whole server rests on
    for (const k of ['nia', 'gia', 'gdv', 'build', 'fees', 'cont', 'saleCosts', 'facility', 'equity', 'profit', 'totalCost', 'residualNet', 'landGross', 'acqCost'] as const) {
      expect(res.structuredContent![k], k).toBeCloseTo(direct[k], 6);
    }
    expect(res.structuredContent!.engineVersion).toBe(ENGINE_VERSION);
    expect(res.content[0]!.text).toContain('Engine');
  });

  it('leaves the cashflow rows out unless asked, and keeps its totals either way', async () => {
    const client = await connect();
    const lean = await call(client, 'apex_appraise', bournemouth as unknown as Record<string, unknown>);
    const full = await call(client, 'apex_appraise', { ...bournemouth, includeCashflow: true } as unknown as Record<string, unknown>);
    const leanCash = lean.structuredContent!.cash as { rows?: unknown[]; peak: number; projIrr: number | null };
    const fullCash = full.structuredContent!.cash as { rows?: unknown[]; peak: number; projIrr: number | null };
    expect(leanCash.rows).toBeUndefined();
    expect(fullCash.rows!.length).toBeGreaterThan(12);
    // the summary a reader needs is there whether or not the rows are — peak
    // debt and the IRRs are headline figures, not an extra you opt into
    expect(leanCash.peak).toBe(fullCash.peak);
    expect(leanCash.peak).toBeGreaterThan(0);
    expect(leanCash.projIrr).toBe(fullCash.projIrr);
  });

  it('computes SDLT on the England & Northern Ireland bands, and says which tax it is', async () => {
    const client = await connect();
    const res = await call(client, 'apex_land_tax', { price: 400_000, basis: 'commercial' });
    // 2% on 150k–250k plus 5% above: £2,000 + £7,500
    expect(res.structuredContent!.tax).toBe(9_500);
    expect(res.structuredContent!.jurisdiction).toMatch(/England & Northern Ireland/);
    // a valuer in Edinburgh or Cardiff must not read this as theirs
    expect(res.content[0]!.text).toMatch(/England & Northern Ireland/);
  });

  it('levies CIL per square metre on an area given in square feet', async () => {
    const client = await connect();
    const res = await call(client, 'apex_infrastructure_levy', { giaSqFt: 20_888.888888888887, ratePerSqm: 40 });
    expect(res.structuredContent!.charge).toBeCloseTo(cilCharge(20_888.888888888887, 40), 2);
  });

  it('ranks scheme options by the engine’s residual, not by an opinion', async () => {
    const client = await connect();
    const res = await call(client, 'apex_compare_schemes', {
      options: [
        { name: 'Option A', blendedPsf: 240, buildPsf: 105, gia: 20_000, targetProfitPct: 20 },
        { name: 'Option B', blendedPsf: 210, buildPsf: 105, gia: 20_000, targetProfitPct: 20 },
      ],
    });
    const opts = res.structuredContent!.options as Array<{ name: string; residual: number }>;
    // the only lever that moved is the sales rate, so A must win — and the tool
    // must SAY which won rather than leaving the reader to compare two numbers
    expect(opts[0]!.residual).toBeGreaterThan(opts[1]!.residual);
    expect(res.structuredContent!.bestByResidual).toBe('Option A');
  });

  it('reports a movement between two versions from the engine, both sides', async () => {
    const client = await connect();
    const dearer: AppraisalInput = { ...bournemouth, trades: [{ label: 'Build', rate: 120 }] };
    const res = await call(client, 'apex_compare_appraisals', {
      before: bournemouth as unknown as Record<string, unknown>,
      after: dearer as unknown as Record<string, unknown>,
    });
    const figures = res.structuredContent!.figures as { before: { residualNet: number }; after: { residualNet: number } };
    expect(figures.before.residualNet).toBeCloseTo(computeAppraisal(bournemouth).residualNet, 6);
    expect(figures.after.residualNet).toBeCloseTo(computeAppraisal(dearer).residualNet, 6);
    // a build rate 15/ft² higher cannot leave the site worth more
    expect(figures.after.residualNet).toBeLessThan(figures.before.residualNet);
    expect(res.structuredContent!.identical).toBe(false);
  });

  it('capitalises a rent roll, and its DCF cross-check does not replace it', async () => {
    const client = await connect();
    const income = {
      lines: [{ label: 'Apartments', count: 40, area: 650, rentPsf: 30, voidPct: 5 }],
      nonRecoverablePct: 5,
      yieldPct: 4.25,
      purchaserCostsPct: 6.8,
    };
    const cap = await call(client, 'apex_capitalise_income', { income });
    expect(cap.structuredContent!.netCapitalValue).toBeGreaterThan(0);
    // net of purchaser's costs is always the smaller of the two
    expect(cap.structuredContent!.netCapitalValue).toBeLessThan(cap.structuredContent!.grossCapitalValue as number);

    const dcf = await call(client, 'apex_dcf', {
      income,
      dcf: { holdYears: 10, rentalGrowthPct: 2, discountRatePct: 7, exitYieldPct: 4.5 },
    });
    expect(dcf.content[0]!.text).toMatch(/reported value remains the capitalisation/i);
  });
});

/**
 * The figures `test/evaluation.xml` states, driven through the server.
 *
 * The eval file exists so somebody can check that a MODEL can use this server;
 * these assert that its answers are still the engine's, so the file cannot rot
 * into a set of questions with stale answers that fail every future run for a
 * reason nobody can find.
 */
describe('the answers the evaluation file states', () => {
  it('appraises the 30-flat scheme to the residual the file gives', async () => {
    const client = await connect();
    const res = await call(client, 'apex_appraise_quick', {
      units: [{ label: 'Flats', count: 30, area: 850, cap: 450 }],
      efficiency: 88,
      buildPerSqft: 165,
      profFeePct: 11,
      contingencyPct: 5,
      cilPerSqm: 60,
      s106: 240_000,
      agentPct: 1.5,
      legalPct: 0.5,
      ltcPct: 60,
      ratePct: 8,
      periodMonths: 20,
      salesMonths: 4,
      arrangementFeePct: 1.5,
      targetProfitPct: 20,
      acqPct: 6.8,
      asking: 0,
    });
    expect(res.structuredContent!.gdv).toBe(11_475_000);
    expect(Math.round(res.structuredContent!.residualNet as number)).toBe(2_467_373);
    // no asking price was named, so there is no return at asking — and the tool
    // must say that rather than defaulting the null to a number
    expect(res.structuredContent!.rocAtAsking).toBeNull();
    expect(res.content[0]!.text).toMatch(/No asking price was given/);
  });

  it('capitalises the 48-apartment BTR block to the value the file gives', async () => {
    const client = await connect();
    const res = await call(client, 'apex_capitalise_income', {
      income: {
        lines: [{ label: 'Apartments', count: 48, area: 620, rentPsf: 32, voidPct: 4 }],
        nonRecoverablePct: 5,
        yieldPct: 4.25,
        purchaserCostsPct: 6.8,
      },
    });
    expect(Math.round(res.structuredContent!.netCapitalValue as number)).toBe(19_134_519);
  });

  it('reports student accommodation as sui generis, from the one taxonomy', async () => {
    const client = await connect();
    const res = await call(client, 'apex_conventions');
    const classes = res.structuredContent!.assetClasses as Array<{ code: string; incomeLed: boolean; planningUseClassEnglandWales: string }>;
    const student = classes.find((c) => c.code === 'STUDENT')!;
    expect(student.planningUseClassEnglandWales).toBe('Sui generis');
    expect(student.incomeLed).toBe(true);
    // and the honest limit of the land tax, said in the tool rather than left
    // for a reader to discover on a certificate
    const regions = res.structuredContent!.regions as Array<{ code: string; landTaxModelled: boolean }>;
    expect(regions.filter((r) => r.landTaxModelled).map((r) => r.code)).toEqual(['GB']);
  });
});

describe('what it says when it cannot answer', () => {
  it('names the environment variable rather than inventing a workspace', async () => {
    const client = await connect(null);
    for (const name of ['apex_deals_list', 'apex_deal_get', 'apex_portfolio_exposure']) {
      const res = await call(client, name, name === 'apex_deal_get' ? { dealId: 'x' } : {});
      expect(res.isError, name).toBe(true);
      expect(res.content[0]!.text, name).toContain('APEX_API_KEY');
    }
    expect(NO_WORKSPACE).toMatch(/Settings → API keys/);
  });

  it('still calculates with no workspace configured at all', async () => {
    // the point of the split: modelling a scheme needs no key, no network and
    // no account
    const client = await connect(null);
    const res = await call(client, 'apex_land_tax', { price: 1_000_000, basis: 'commercial' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent!.tax).toBe(39_500);
  });

  it('refuses an input the engine could not honestly compute, and names the field', async () => {
    const client = await connect();
    // a negative floor area is not a scheme. The schema catches it and the
    // refusal says WHERE — a model handed "invalid arguments" and nothing else
    // retries the same call.
    const res = await call(client, 'apex_appraise', {
      ...bournemouth,
      units: [{ label: 'x', count: 1, area: -100, cap: 200 }],
    } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('units[0].area');
  });
});

describe('reading the environment', () => {
  it('needs a key, and defaults the host to a local instance', () => {
    expect(workspaceFromEnv({})).toBeNull();
    expect(workspaceFromEnv({ APEX_API_URL: 'https://apex.example' })).toBeNull();
    expect(workspaceFromEnv({ APEX_API_KEY: '  ' })).toBeNull();
    expect(workspaceFromEnv({ APEX_API_KEY: 'apex_live_x' })).toEqual({ apiKey: 'apex_live_x', baseUrl: 'http://localhost:4100' });
  });

  it('does not double the slash when the host is given with one', () => {
    // "https://apex.example/" + "/api/v1/deals" is a 404 nobody enjoys diagnosing
    expect(workspaceFromEnv({ APEX_API_KEY: 'k', APEX_API_URL: 'https://apex.example/' })!.baseUrl).toBe('https://apex.example');
    expect(workspaceFromEnv({ APEX_API_KEY: 'k', APEX_API_URL: 'https://apex.example///' })!.baseUrl).toBe('https://apex.example');
  });
});
