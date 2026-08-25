import { beforeAll, describe, expect, it } from 'vitest';
import { statedSpecialAssumptions } from '../src/routers/appraisal.js';
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
