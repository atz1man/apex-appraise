import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Two valuers on one workfile.
 *
 * "One connected workfile" is the product's own description of itself, and
 * Growth sells ten seats to a team running a live pipeline. Two analysts on the
 * same scheme is the collaboration being sold, not an edge case.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

/** The same shape review.test.ts uses — the real zAppraisalInput, not a guess. */
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

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Workfile');
  await caller().appraisal.save({ dealId: T.dealId, input: input(), label: 'Base' } as never);
}, 120_000);

describe('two people editing the same draft', () => {
  it('refuses the second, instead of silently discarding the first', async () => {
    const opened = await prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });

    // A saves a new build rate against the version they opened
    await caller().appraisal.save({
      dealId: T.dealId,
      input: input({ trades: [{ label: 'Superstructure', rate: 195 }] }),
      expectedUpdatedAt: opened.updatedAt,
    } as never);

    // @updatedAt has millisecond resolution; without this the two saves can land
    // in the same tick and the test would be measuring nothing
    await new Promise((r) => setTimeout(r, 5));

    /**
     * B is holding what the page loaded BEFORE A saved. Their write carries every
     * field, including a build rate that is now stale — which is how the first
     * person's work used to disappear with no version, no conflict and no audit
     * event, on a workfile whose version history is the evidence trail.
     */
    await expect(
      caller().appraisal.save({
        dealId: T.dealId,
        input: input({ units: [{ label: '2-bed apartments', count: 14, area: 750, cap: 420 }] }),
        expectedUpdatedAt: opened.updatedAt,
      } as never),
      // the wording is shared with every other optimistic lock — see
      // src/optimistic.ts — so it is asserted on the shape rather than prose
      // that would drift per procedure
    ).rejects.toThrow(/was saved.*after you opened it/s);

    const after = await prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });
    const trades = JSON.parse(after.trades) as Array<{ rate: number }>;
    expect(trades[0]!.rate, "A's build rate was overwritten by B's stale copy").toBe(195);
    // and B's own change did not land either — a refusal that half-applied would
    // be worse than the overwrite it replaces
    expect((JSON.parse(after.units) as Array<{ count: number }>)[0]!.count).toBe(10);
  });

  it('tells a caller that forgot the token what to send', async () => {
    /**
     * Demanded rather than merely checked when present. An optional token
     * silently reopens the hole for whoever forgets next, and the person it costs
     * is a valuer who never learns their afternoon was thrown away.
     */
    await expect(
      caller().appraisal.save({ dealId: T.dealId, input: input() } as never),
    ).rejects.toThrow(/expectedUpdatedAt/);
  });

  it('needs no token to branch a version, or to create the first one', async () => {
    // the token guards editing a row somebody else may be holding; neither of
    // these touches one
    await expect(
      caller().appraisal.save({ dealId: T.dealId, input: input(), asNewVersion: true, label: 'Branch' } as never),
    ).resolves.toBeTruthy();

    const fresh = await makeTenant('Fresh');
    await expect(
      callerFor(fresh.principal).appraisal.save({ dealId: fresh.dealId, input: input() } as never),
    ).resolves.toBeTruthy();
  });
});

describe('two people saving a new version at once', () => {
  it('leaves exactly one version current', async () => {
    /**
     * asNewVersion flips the old row's isCurrent to false and then creates a new
     * one. Two of those interleaved leave TWO rows marked current, and every
     * read of "the current appraisal" is a findFirst — so which figures the deal
     * shows becomes a matter of row order.
     */
    await Promise.all([
      caller().appraisal.save({ dealId: T.dealId, input: input(), asNewVersion: true, label: 'A' } as never),
      caller().appraisal.save({ dealId: T.dealId, input: input(), asNewVersion: true, label: 'B' } as never),
    ]).catch(() => {
      // one of them losing is a correct outcome; two winners is not
    });

    const current = await prisma.appraisal.count({ where: { dealId: T.dealId, isCurrent: true } });
    expect(current, 'more than one version is marked current').toBe(1);
  });
});
