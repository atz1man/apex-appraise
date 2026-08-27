import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { statedSpecialAssumptions } from '../src/routers/appraisal.js';
import { unsupportedClaims, unsupportedFigures } from '../src/narrative-guard.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * What the report DECLARES, as opposed to what it computes.
 *
 * narrative-guard.test.ts already checks every FIGURE against the engine. Nothing
 * checked the claims, and the deterministic template made three that nothing
 * supported — in a document carrying professional indemnity:
 *
 *   "No special assumptions have been made"  — printed regardless of what the
 *   signed terms say at clause 11. Measured on a real instruction whose terms
 *   read "That full planning permission for 10 dwellings is granted ... and
 *   that the site is free of contamination".
 *
 *   "The evidence base of N comparables is considered adequate for the class" —
 *   fired on ANY count above zero, so one comparable was declared adequate
 *   evidence for a Market Value.
 *
 *   "Transaction volumes over the preceding twelve months have been stable and
 *   marketing periods ... are typically six to eight weeks", plus steady demand
 *   and limited supply — the same sentences for every property in every market,
 *   printed even on a scheme with no comparables logged at all.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const INPUT = {
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate: 110 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

const SPECIAL = 'That full planning permission for 10 dwellings is granted on the terms of the current application.';

type Sections = { marketCommentary: string; valuationRationale: string; riskCommentary: string };
const draft = async () => (await caller().appraisal.draftNarrative(T.dealId as never)) as Sections;
/**
 * `engagement.get` hands back an unsaved house-style draft when no row exists,
 * so an `updateMany` against it matches nothing — the first version of this test
 * asserted against terms that were never written.
 */
const setSpecial = async (text: string) => {
  const terms = (await caller().engagement.get(T.dealId as never)) as Record<string, unknown>;
  const { id, status, issuedAt, acceptedAt, acceptedBy, signToken, signTokenExpiresAt,
    signedName, signedAt, signedIp, createdAt, updatedAt, dealId, orgId, ...editable } = terms as never;
  // the stamp it just read, which is what the form does — the terms are now
  // guarded against a second editor, and a fixture that skips the stamp is not
  // exercising the same procedure a person does
  await caller().engagement.save({
    dealId: T.dealId,
    terms: { ...editable, specialAssumptions: text },
    expectedUpdatedAt: updatedAt,
  } as never);
  const row = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: T.dealId } });
  expect(row.specialAssumptions, 'the fixture did not actually save the clause').toBe(text);
};

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Narrative');
  await caller().appraisal.save({ dealId: T.dealId, input: INPUT, label: 'Base' } as never);
  // terms exist for every deal via engagement.get's house-style draft
  await caller().engagement.get(T.dealId as never);
}, 120_000);

describe('reading clause 11', () => {
  it('treats the house-style "None." as no special assumption', () => {
    for (const none of ['None.', 'none', 'None', 'N/A', 'nil', '  ', '']) {
      expect(statedSpecialAssumptions(none), none).toBeNull();
    }
    expect(statedSpecialAssumptions(null)).toBeNull();
  });

  it('treats anything a valuer actually wrote as one', () => {
    expect(statedSpecialAssumptions(SPECIAL)).toBe(SPECIAL);
    expect(statedSpecialAssumptions('  Vacant possession assumed. ')).toBe('Vacant possession assumed.');
    // "None of the units are let" is a real assumption that starts with the word
    expect(statedSpecialAssumptions('None of the units are let.')).toBe('None of the units are let.');
  });
});

describe('the special assumptions declaration', () => {
  it('states them when the terms of engagement do', async () => {
    await setSpecial(SPECIAL);
    const n = await draft();
    expect(
      n.riskCommentary,
      'the report denied a special assumption the signed terms record',
    ).not.toContain('No special assumptions have been made');
    expect(n.riskCommentary).toContain('as agreed in the terms of engagement');
    expect(n.riskCommentary).toContain('full planning permission for 10 dwellings is granted');
  });

  it('does not leave a doubled full stop where the clause already ends in one', async () => {
    await setSpecial(SPECIAL);
    expect((await draft()).riskCommentary).not.toMatch(/\.\./);
  });

  it('says none are made when the terms say none', async () => {
    await setSpecial('None.');
    expect((await draft()).riskCommentary).toContain('No special assumptions have been made');
  });
});

describe('the evidence base', () => {
  it('states its extent and leaves the adequacy to the valuer', async () => {
    await prisma.comparable.create({
      data: { orgId: T.orgId, dealId: T.dealId, address: '12 Quay Road', basePsf: 415, adjSize: 0, adjCondition: 0, adjDate: 0, adjLocation: 0 },
    });
    const n = await draft();
    expect(
      n.riskCommentary,
      'one comparable was declared adequate evidence for a Market Value',
    ).not.toContain('considered adequate for the class');
    expect(n.riskCommentary).toContain('for the valuer to confirm');
    expect(n.riskCommentary).toContain('1 comparable');
  });

  it('says plainly when there is none, rather than reading as an empty count', async () => {
    await prisma.comparable.deleteMany({ where: { dealId: T.dealId } });
    const n = await draft();
    expect(n.riskCommentary).toContain('No comparables have been logged');
    expect(n.riskCommentary).not.toContain('evidence base is no comparable');
  });
});

describe('market conditions nobody measured', () => {
  it('are not asserted', async () => {
    const n = await draft();
    const all = `${n.marketCommentary} ${n.valuationRationale} ${n.riskCommentary}`;
    for (const claim of [
      'remains active',
      'steady occupier and investor demand',
      'limited supply of directly comparable stock',
      'Transaction volumes',
      'six to eight weeks',
      'no material valuation uncertainty is reported',
      'consistent with market-standard return requirements',
    ]) {
      expect(all, `the report asserted "${claim}" with nothing behind it`).not.toContain(claim);
    }
  });

  it('are named as the valuer’s to write, so the gap is visible', async () => {
    const n = await draft();
    expect(n.marketCommentary).toContain('have not been assessed in this draft');
    expect(n.marketCommentary).toContain('for the valuer to state');
  });

  it('still carries the figures the engine produced', async () => {
    // the point is not to empty the report — narrative-guard.test.ts checks the
    // figures are the engine's; this checks they are still there to check
    const n = await draft();
    expect(n.marketCommentary).toContain('£3,150,000');
    expect(n.valuationRationale).toContain('£3,150,000');
    expect(n.riskCommentary).toContain('£3,150,000');
  });
});

/**
 * The guard the model path relies on, held to the prose this product writes.
 *
 * Everything above exercises the DETERMINISTIC TEMPLATE — the harness sets no
 * ANTHROPIC_API_KEY, so `draftNarrative` never reaches the model. That is the
 * gap this closes: on the model path the same three rules were instructions and
 * nothing more, and none of the sentences they forbid carries a figure, so
 * `unsupportedFigures` could not see them.
 *
 * A claim guard that rejected the template would be worse than none, because
 * the template IS the fallback — the report would have nowhere honest to land.
 * So this runs the real draft, in every state the template branches on, through
 * the guard the model draft is now held to.
 */
describe('the claim guard and the template it falls back to', () => {
  it('accepts the template in every state it can be drafted in', async () => {
    for (const [state, prepare] of [
      ['no comparables, no special assumption', async () => {
        await prisma.comparable.deleteMany({ where: { dealId: T.dealId } });
        await setSpecial('None.');
      }],
      ['comparables logged', async () => {
        await prisma.comparable.create({
          data: { orgId: T.orgId, dealId: T.dealId, address: '12 Quay Road', basePsf: 415, adjSize: 0, adjCondition: 0, adjDate: 0, adjLocation: 0 },
        });
      }],
      ['a special assumption in the signed terms', async () => {
        await setSpecial(SPECIAL);
      }],
    ] as const) {
      await prepare();
      const n = await draft();
      const terms = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: T.dealId } });
      expect(
        unsupportedClaims(n as unknown as Record<string, string>, {
          specialAssumptions: statedSpecialAssumptions(terms.specialAssumptions),
        }),
        `the guard rejected the template the model path falls back to (${state})`,
      ).toEqual([]);
    }
  });

  it('rejects the paragraph this product printed before 238d265', async () => {
    /**
     * Verbatim from the template as it stood, which is the register a model
     * drafting in this house style will reach for. On the model path today the
     * figure guard sees nothing in it to object to: no money, no percentage.
     */
    const before = {
      marketCommentary:
        'The local market for this class remains active, with steady occupier and investor demand and a limited supply of directly comparable stock. Transaction volumes over the preceding twelve months have been stable, and marketing periods for well-presented accommodation are typically six to eight weeks.',
      riskCommentary:
        'The evidence base of 1 comparable is considered adequate for the class. No special assumptions have been made. No material valuation uncertainty is reported.',
    };
    expect(
      unsupportedFigures(before, { money: [3_150_000], percents: [20.4] }),
      'the figure guard was never going to catch a claim — that is why this one exists',
    ).toEqual([]);

    const found = unsupportedClaims(before, { specialAssumptions: SPECIAL });
    for (const what of [
      'the state of the market',
      'a level of demand',
      'the supply of comparable stock',
      'transaction volumes',
      'marketing periods',
      'the adequacy of the evidence base',
      'denied a special assumption the terms record',
      'a material valuation uncertainty declaration',
    ]) {
      expect(found.join('\n'), `"${what}" went through unchallenged`).toContain(what);
    }
  });
});

/**
 * The model path, which no test had ever taken.
 *
 * Everything above stops at the template, because the harness sets no
 * ANTHROPIC_API_KEY. In production the key IS set, and then the draft that
 * reaches a signed valuation is the model's — so the checks between it and the
 * reader are the only thing standing there. Deleting either of them passed every
 * test in this file until this one existed.
 *
 * The model is stubbed rather than called: what is under test is the disposal of
 * a draft, not what a model happens to write on the day.
 */
describe('a model draft, which is what production prints', () => {
  const CLEAN = {
    marketCommentary:
      'Pricing evidence for this residential scheme is drawn from the comparables logged against the deal. The appraisal indicates a gross development value of £3,150,000. Local market conditions have not been assessed in this draft and are for the valuer to state.',
    valuationRationale:
      "Primary reliance is placed on the comparable method, cross-checked against the depreciated replacement cost and investment approaches. Reconciling the approaches, the valuer's opinion of Market Value is £3,150,000.",
    riskCommentary:
      'Planning status is recorded as not assessed. The principal risks to the reported figure of £3,150,000 are movement in local sales rates and build-cost inflation. Material valuation uncertainty has not been assessed in this draft.',
  };

  const modelReturns = (sections: Record<string, string>) =>
    vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'tool_use', input: sections }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

  beforeEach(async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    await prisma.comparable.deleteMany({ where: { dealId: T.dealId } });
    await setSpecial('None.');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('prints the model draft when it is supported', async () => {
    vi.stubGlobal('fetch', modelReturns(CLEAN));
    const n = await draft();
    expect(n.valuationRationale, 'a supported draft was thrown away').toBe(CLEAN.valuationRationale);
  });

  it('throws away a draft carrying a figure the engine did not produce', async () => {
    vi.stubGlobal('fetch', modelReturns({
      ...CLEAN,
      valuationRationale: "The valuer's opinion of Market Value is £3,510,000.",
    }));
    const n = await draft();
    expect(n.valuationRationale, 'a transposed Market Value reached the report').not.toContain('£3,510,000');
    expect(n.valuationRationale).toContain('£3,150,000');
  });

  it('throws away a draft asserting market conditions nobody measured', async () => {
    /**
     * The sentence carries no money and no percentage, so the figure guard has
     * nothing to object to. Before `unsupportedClaims` this printed verbatim.
     */
    vi.stubGlobal('fetch', modelReturns({
      ...CLEAN,
      marketCommentary:
        'The local market remains active, with steady occupier demand and a limited supply of directly comparable stock. Transaction volumes have been stable and marketing periods are typically six to eight weeks.',
    }));
    const n = await draft();
    expect(n.marketCommentary, 'unmeasured market conditions reached a signed valuation').not.toContain('remains active');
    expect(n.marketCommentary, 'the report did not fall back to the template').toContain(
      'have not been assessed in this draft',
    );
  });

  it('throws away a draft declaring the evidence base adequate', async () => {
    vi.stubGlobal('fetch', modelReturns({
      ...CLEAN,
      riskCommentary: 'The evidence base of 1 comparable is considered adequate for the class.',
    }));
    expect((await draft()).riskCommentary).not.toContain('considered adequate');
  });

  it('throws away a draft denying a special assumption the signed terms record', async () => {
    await setSpecial(SPECIAL);
    vi.stubGlobal('fetch', modelReturns({
      ...CLEAN,
      riskCommentary: 'No special assumptions have been made in arriving at the reported figure.',
    }));
    const n = await draft();
    expect(n.riskCommentary, 'the report denied a special assumption the signed terms record').not.toContain(
      'No special assumptions have been made',
    );
    expect(n.riskCommentary).toContain('full planning permission for 10 dwellings is granted');
  });
});
