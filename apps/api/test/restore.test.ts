import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Restoring an earlier appraisal version.
 *
 * `save` was hardened twice — it writes the engine's figures onto the deal card,
 * and it stands the old version down with a compare-and-set inside a
 * transaction. `restore` changes which version is current too, and had neither.
 *
 * Measured on a real deal: an optimistic version saved at £4,500,000 GDV, then
 * the prudent £3,150,000 version restored to undo it. The current appraisal read
 * £3,150,000 and the pipeline board, the Hub and the deal card all still read
 * **£4,500,000** — the version that had just been replaced — with no way back
 * except saving the appraisal again by hand.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const input = (cap: number) => ({
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate: 110 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

const dealCard = async () => prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });
const current = async () => prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });
const versionNamed = async (label: string) =>
  prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, label } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Restore');
  await caller().appraisal.save({ dealId: T.dealId, input: input(420), label: 'Prudent' } as never);
  await caller().appraisal.save({ dealId: T.dealId, input: input(600), asNewVersion: true, label: 'Optimistic' } as never);
}, 120_000);

describe('the deal card follows the current version', () => {
  it('moves back when an earlier version is restored', async () => {
    const optimistic = await dealCard();
    expect(Number(optimistic.gdv) / 100, 'the fixture should start on the optimistic figure').toBe(4_500_000);

    await caller().appraisal.restore({ dealId: T.dealId, versionId: (await versionNamed('Prudent')).id } as never);

    const after = await dealCard();
    expect(
      Number(after.gdv) / 100,
      'the board kept the GDV of the version that was replaced',
    ).toBe(3_150_000);
  });

  it('moves the whole headline, not just the one figure a screen happens to read', async () => {
    // profit, return on cost and the viability verdict are all derived from the
    // current version, and the pipeline sorts and filters on them
    const card = await dealCard();
    const cur = await current();
    expect(cur.label).toBe('Prudent (restored)');
    expect(Number(card.forecastProfit)).toBeGreaterThan(0);
    expect(['PROCEED', 'CAUTION', 'DECLINE']).toContain(card.viability);
  });
});

describe('a restored version is a new version', () => {
  it('starts as a draft, however the version it came from ended', async () => {
    /**
     * The review fields were copied with everything else, so restoring an
     * approved version produced a fresh row asserting it had been approved — by
     * that person, on that date — when nobody had seen this row at all. The
     * rule is already written down for a branch: "a new version inherits no
     * approval — it has to earn its own."
     */
    const v = await current();
    await caller().appraisal.submitForReview({ versionId: v.id } as never);
    await caller().appraisal.review({ versionId: v.id, decision: 'approve', note: 'Rates check out' } as never);
    expect((await current()).reviewStatus).toBe('approved');

    await caller().appraisal.restore({ dealId: T.dealId, versionId: v.id } as never);

    const restored = await current();
    expect(restored.reviewStatus, 'a restored version claimed an approval it never earned').toBe('draft');
    expect(restored.reviewedById).toBeNull();
    expect(restored.reviewedAt).toBeNull();
    expect(restored.reviewNote).toBeNull();
    expect(restored.submittedById).toBeNull();

    // and the version it was restored FROM keeps its approval
    const source = await prisma.appraisal.findUniqueOrThrow({ where: { id: v.id } });
    expect(source.reviewStatus).toBe('approved');
  });

  it('can be edited in place, because it is a draft and not an approved record', async () => {
    // the corollary: an inherited "approved" also locked the restored row
    // against the in-place save that `save` refuses on an approved version
    const held = await current();
    await expect(
      caller().appraisal.save({ dealId: T.dealId, input: input(430), expectedUpdatedAt: held.updatedAt } as never),
    ).resolves.toBeTruthy();
  });
});

describe('two people restoring at once', () => {
  it('leaves exactly one current version', async () => {
    /**
     * `updateMany` then `create`, with nothing between them: two callers both
     * read the same current row, both flip it and both create — after which
     * "the current appraisal" is whichever findFirst happens to return. `save`
     * was fixed for this; restore was the other half of the same defect.
     */
    const target = (await versionNamed('Optimistic')).id;
    await Promise.allSettled([
      caller().appraisal.restore({ dealId: T.dealId, versionId: target } as never),
      caller().appraisal.restore({ dealId: T.dealId, versionId: target } as never),
    ]);
    const currents = await prisma.appraisal.findMany({ where: { dealId: T.dealId, isCurrent: true } });
    expect(currents.length, 'two rows were left marked current').toBe(1);
  });

  it('leaves the deal card agreeing with whichever one won', async () => {
    // against what the ENGINE says for the current version, not against a sum
    // worked out here — a test that reimplements the maths is the defect
    const cur = (await caller().appraisal.getCurrent(T.dealId)) as { result: { gdv: number; profit: number } };
    const card = await dealCard();
    expect(Number(card.gdv) / 100).toBeCloseTo(cur.result.gdv, 2);
    expect(Number(card.forecastProfit) / 100).toBeCloseTo(cur.result.profit, 2);
  });
});
