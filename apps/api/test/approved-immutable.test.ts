import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * What "approved" is worth.
 *
 * `appraisal.save` states the rule in its own words, and enforces it:
 *
 *   "The rule that gives approval its meaning. Editing an approved version in
 *    place would change what somebody signed off without anyone signing off on
 *    the change — and the version history would show no trace of it."
 *
 * It is the right rule. A Red Book valuation is signed by a named valuer under
 * professional indemnity, and an approval that the figures can move underneath
 * is not an approval at all. But `save` is not the only procedure that writes to
 * an appraisal row, and the rule was written where the defect had been found
 * rather than where the model is.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const input = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

const current = () => prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Signed');
  await caller().appraisal.save({ dealId: T.dealId, input: input(), label: 'For signature' } as never);
  const v = await current();
  await caller().appraisal.submitForReview({ versionId: v.id });
  await caller().appraisal.review({ versionId: v.id, decision: 'approve' });
  const approved = await current();
  expect(approved.reviewStatus, 'the fixture never got the version approved').toBe('approved');
}, 180_000);

/**
 * Every mutation that EDITS an appraisal row in place, read from the real
 * resolvers. Creating a row is not in scope — a row that does not exist yet
 * cannot be one somebody has signed.
 */
const editors = () =>
  Object.entries((appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string; resolver?: unknown } }> } })._def.procedures)
    .filter(([, p]) => p._def.type === 'mutation')
    .filter(([, p]) => /prisma\.appraisal\.(update|updateMany|upsert)\(/.test(String(p._def.resolver ?? '')))
    .map(([path, p]) => [path, String(p._def.resolver ?? '')] as const);

/**
 * Editors that do not call the shared guard, each with the reason.
 *
 * Both of these are the review machinery itself — the procedures whose whole job
 * is to move a version between review states. They carry their own rules about
 * what may follow what, and routing them through a guard that refuses to touch
 * an approved row would stop the approval from being recorded at all.
 */
const NOT_GUARDED: Record<string, string> = {
  'appraisal.submitForReview':
    'refuses an approved version with its own message ("that version is already approved") before it writes anything.',
  'appraisal.review':
    'this IS the approval. It checks the version is in review, and is the only procedure entitled to set the status the guard reads.',
};

describe('an approved version', () => {
  /**
   * The rule is about the MODEL, not about `save`. It lived inside `save` for as
   * long as `save` was the only procedure anyone had thought about, and two
   * others had quietly grown up beside it. This is what stops a third.
   */
  it('is refused by every procedure that edits an appraisal row', () => {
    const found = editors();
    expect(found.length, 'no appraisal editor was found — the walk is broken').toBeGreaterThan(2);
    expect(found.map(([p]) => p), 'save is the procedure this rule was written for').toContainEqual('appraisal.save');

    const unguarded = found
      .filter(([path, src]) => !/assertNotApproved\(/.test(src) && !(path in NOT_GUARDED))
      .map(([path]) => path);
    expect(
      unguarded,
      'these edit an appraisal row without asking whether it has been signed off. '
        + `Call assertNotApproved, or add the path to NOT_GUARDED with the reason: ${unguarded.join(', ')}`,
    ).toEqual([]);

    const stale = Object.keys(NOT_GUARDED).filter((p) => !found.some(([f]) => f === p));
    expect(stale, `exempted editors that no longer edit an appraisal: ${stale.join(', ')}`).toEqual([]);
  });

  it('refuses a plain save — the rule as it already stood', async () => {
    await expect(
      caller().appraisal.save({ dealId: T.dealId, input: input({ efficiency: 90 }) } as never),
    ).rejects.toThrow(/approved/i);
  });

  /**
   * The one that moves the number. `applyToAppraisal` writes the supported £/ft²
   * onto EVERY unit cap of the current appraisal, which moves GDV, profit and the
   * residual land value — the largest single write outside `save`, on a version
   * a valuer has signed.
   */
  it('refuses comparables being applied over the top of it', async () => {
    await caller().comparables.upsert({
      dealId: T.dealId,
      address: '9 Later Lane',
      basePsf: 700,
      adjSize: 0,
      adjCondition: 0,
      adjDate: 0,
      adjLocation: 0,
    } as never);

    const before = await current();
    await expect(caller().comparables.applyToAppraisal(T.dealId)).rejects.toThrow(/approved/i);

    const after = await current();
    expect(after.units, 'an approved valuation’s unit prices were rewritten').toBe(before.units);
    expect(after.reviewStatus, 'and it still reads as approved').toBe('approved');
  });

  /**
   * And the one that moves the words. The narrative IS the Red Book prose, and
   * it carries the AI-use disclosure — so redrafting it after approval replaces
   * the sentences a valuer signed, under their approval, with a new disclosure.
   */
  it('refuses its narrative being redrafted underneath it', async () => {
    const before = await current();
    await expect(caller().appraisal.draftNarrative(T.dealId)).rejects.toThrow(/approved/i);
    const after = await current();
    expect(after.narrative, 'an approved valuation’s narrative was replaced').toBe(before.narrative);
  });
});
