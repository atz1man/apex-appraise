import Fastify from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerPublicApi } from '../src/public-api.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The book, as a lender sees it. The engine's arithmetic is tested in the engine;
 * what matters here is that the right deals are in it, from the right firm, with
 * a facility that agrees with the appraisal.
 */

let A: Tenant;
let B: Tenant;

const input = (rate = 120) => ({
  units: [{ label: 'Units', count: 10, area: 800, cap: 400 }],
  efficiency: 85,
  trades: [{ label: 'Build', rate }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Book');
  B = await makeTenant('Rival');
  await callerFor(A.principal).appraisal.save({ dealId: A.dealId, input: input(), label: 'Base' } as never);
  await callerFor(B.principal).appraisal.save({ dealId: B.dealId, input: input(), label: 'Theirs' } as never);
}, 120_000);

describe('portfolio exposure', () => {
  it('carries the facility the appraisal actually produces', async () => {
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ dealId: string; facility: number }>;
      totals: { facility: number; deals: number };
    };
    expect(e.positions).toHaveLength(1);
    // the book agrees with the deal it sums — checked against the engine's own
    // figure for the same appraisal, not a stored one
    const appraisal = (await callerFor(A.principal).appraisal.getCurrent(A.dealId)) as { result: { facility: number } };
    expect(e.positions[0]!.facility).toBeCloseTo(appraisal.result.facility, 6);
    expect(e.totals.facility).toBeCloseTo(appraisal.result.facility, 6);
  });

  it('never includes another firm’s lending', async () => {
    const e = (await callerFor(A.principal).deals.exposure()) as { positions: Array<{ dealId: string }> };
    expect(e.positions.map((p) => p.dealId)).toEqual([A.dealId]);
    expect(e.positions.map((p) => p.dealId)).not.toContain(B.dealId);
  });

  it('leaves out a deal with no appraisal rather than padding the book with a zero', async () => {
    await prisma.deal.create({
      data: { orgId: A.orgId, name: 'Just a prospect', address: '1 Nowhere', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'SOURCING' },
    });
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ name: string }>;
      byRegion: Array<{ key: string; share: number }>;
    };
    // a prospect is not a position; counting it would understate every
    // concentration by inflating the denominator
    expect(e.positions.map((p) => p.name)).not.toContain('Just a prospect');
    expect(e.byRegion.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 10);
  });

  it('counts committed spend as drawn', async () => {
    await callerFor(A.principal).cost.upsertPackage({
      dealId: A.dealId, name: 'Groundworks', budget: 500_000, committed: 250_000, spent: 100_000, forecast: 500_000, retentionPct: 5,
    } as never);
    const e = (await callerFor(A.principal).deals.exposure()) as {
      totals: { drawn: number; undrawn: number; utilisation: number };
    };
    expect(e.totals.drawn).toBe(250_000);
    expect(e.totals.utilisation).toBeGreaterThan(0);
    expect(e.totals.undrawn).toBeGreaterThan(0);
  });
});

describe('drawdown against works', () => {
  it('judges spend on the works done, not on the calendar', async () => {
    // half the money committed against a quarter of the works
    await callerFor(A.principal).cost.upsertPackage({
      dealId: A.dealId, name: 'Frame', budget: 1_000_000, committed: 500_000, spent: 400_000, forecast: 1_000_000, retentionPct: 5,
    } as never);
    await prisma.costPackage.updateMany({ where: { dealId: A.dealId }, data: { progressPct: 25 } });

    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ dealId: string; drawdown: { status: string; varianceOnProgress: number } | null }>;
    };
    const pos = e.positions.find((p) => p.dealId === A.dealId)!;
    expect(pos.drawdown).not.toBeNull();
    expect(pos.drawdown!.status).toBe('overspending');
    expect(pos.drawdown!.varianceOnProgress).toBeGreaterThan(0);
  });

  it('reports nothing rather than a false clean bill when there is no cost monitoring', async () => {
    const fresh = await makeTenant('NoCosts');
    await callerFor(fresh.principal).appraisal.save({ dealId: fresh.dealId, input: input(), label: 'Base' } as never);
    const e = (await callerFor(fresh.principal).deals.exposure()) as {
      positions: Array<{ drawdown: unknown }>;
    };
    // a 0%-complete reading would report this as underspending, which is a
    // finding about nothing
    expect(e.positions[0]!.drawdown).toBeNull();
  });
});

describe('facility covenants', () => {
  it('tests nothing until the firm sets its own limits', async () => {
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ covenants: { untested: boolean; tests: unknown[] } }>;
    };
    // no limits saved: the ratios exist, but nothing is called a breach
    expect(e.positions[0]!.covenants.untested).toBe(true);
    expect(e.positions[0]!.covenants.tests).toEqual([]);
  });

  it('tests against the limits the firm actually saved, and names the breach', async () => {
    const policy = (await callerFor(A.principal).org.policy()) as Record<string, unknown>;
    await callerFor(A.principal).org.savePolicy({
      ...policy,
      // the stamp it just read — the panel now sends this so a second admin's
      // save cannot silently restore seventeen clauses
      expectedUpdatedAt: policy.updatedAt,
      // deliberately tight, so the seeded deal breaches
      covLtgdvMaxPct: 1,
      covLtcMaxPct: null,
      covMinProfitOnCostPct: null,
    } as never);

    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ covenants: { untested: boolean; breaches: Array<{ key: string; headroomPts: number }> } }>;
    };
    const c = e.positions[0]!.covenants;
    expect(c.untested).toBe(false);
    expect(c.breaches.map((b) => b.key)).toEqual(['ltgdv']);
    // negative headroom, so the panel can say by how much
    expect(c.breaches[0]!.headroomPts).toBeLessThan(0);
  });

  it('lets a covenant be cleared again', async () => {
    const policy = (await callerFor(A.principal).org.policy()) as Record<string, unknown>;
    await callerFor(A.principal).org.savePolicy({
      ...policy,
      expectedUpdatedAt: policy.updatedAt,
      covLtgdvMaxPct: null,
    } as never);
    const e = (await callerFor(A.principal).deals.exposure()) as {
      positions: Array<{ covenants: { untested: boolean } }>;
    };
    // a covenant that cannot be removed is a covenant nobody will risk setting
    expect(e.positions[0]!.covenants.untested).toBe(true);
  });
});

/**
 * WHERE each position's `drawn` figure came from, as the book reports it.
 *
 * `cash.ts` computes `drawnSource` and states its purpose in as many words:
 * "The funding pack says which, because a figure derived from invoices and one
 * taken from a bank statement do not deserve the same confidence." The pack
 * printed one unconditional sentence over every book — "drawn is committed
 * spend from cost monitoring" — so a firm that had connected its bank feed sent
 * its lender a document disclaiming figures it had taken from statements, and a
 * firm with feeds on some schemes sent one that was wrong about half its rows.
 *
 * The pack now reads `drawnSource` (`web/src/lib/drawn-basis.ts` decides what it
 * says, and is tested at its boundaries there). This is the other end of that
 * wire: an absent source classifies as the proxy by design, so if this
 * procedure quietly stopped emitting the field the pack would go back to
 * printing the old sentence and every test on the browser side would still
 * pass. The failure would be silent, which is why it is pinned HERE.
 */
describe('where the drawn figure came from', () => {
  it('reports both sources in one book, so a mixed pack can tell its rows apart', async () => {
    const T = await makeTenant('Feed');
    await callerFor(T.principal).appraisal.save({ dealId: T.dealId, input: input(), label: 'Base' } as never);
    // a second scheme in the same firm, appraised, with no account mapped to it
    const noFeed = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'No Feed', address: '2 Statement Street', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });
    await callerFor(T.principal).appraisal.save({ dealId: noFeed.id, input: input(), label: 'Base' } as never);

    const conn = await prisma.bankConnection.create({
      data: {
        orgId: T.orgId, institution: 'Test Bank', accessToken: 'x', refreshToken: 'y',
        expiresAt: new Date(Date.now() + 86_400_000), consentExpiresAt: new Date(Date.now() + 86_400_000),
        createdById: T.principal.userId,
      },
    });
    const acct = await prisma.bankAccount.create({
      data: { orgId: T.orgId, connectionId: conn.id, externalId: 'acc-1', name: 'Development', last4: '4321', dealId: T.dealId },
    });
    await prisma.bankTransaction.createMany({
      data: [
        // a classified facility advance, and money out — the two the pack reports
        { orgId: T.orgId, accountId: acct.id, externalId: 't1', bookedAt: new Date(), amount: BigInt(400_000_00), description: 'Facility drawdown', classification: 'drawdown' },
        { orgId: T.orgId, accountId: acct.id, externalId: 't2', bookedAt: new Date(), amount: BigInt(-250_000_00), description: 'Contractor payment', classification: 'cost' },
        /**
         * And a credit nobody has said what it is. `cash.ts`: "An unclassified
         * credit is reported as unclassified, never quietly booked as a
         * drawdown that would flatter or damn the position." Without this line
         * the fixture's only credit was already classified, so a `drawn` that
         * counted every credit gave the same answer and the promise went
         * untested — measured: the mutation survived.
         */
        { orgId: T.orgId, accountId: acct.id, externalId: 't3', bookedAt: new Date(), amount: BigInt(90_000_00), description: 'Transfer in', classification: 'unclassified' },
      ],
    });

    const e = (await callerFor(T.principal).deals.exposure()) as {
      positions: Array<{ dealId: string; drawn: number; paid: number; unclassifiedIn: number; drawnSource: string }>;
    };
    const fed = e.positions.find((p) => p.dealId === T.dealId)!;
    const unfed = e.positions.find((p) => p.dealId === noFeed.id)!;

    expect(fed.drawnSource, 'a scheme with a mapped account was reported as a proxy figure').toBe('bank');
    expect(unfed.drawnSource, 'a scheme with no account claimed bank evidence').toBe('committed');

    /**
     * Discriminating: the two assertions above hold if the field were hardcoded
     * per-deal by some other rule. These pin it to the numbers the source
     * actually changes — drawn is the classified advance, not committed spend,
     * and paid is what left the account.
     */
    expect(fed.drawn, 'an unclassified credit was booked as a facility drawdown').toBe(400_000);
    expect(fed.paid).toBe(250_000);
    expect(fed.unclassifiedIn, 'the unclassified credit went unreported instead').toBe(90_000);
    expect(unfed.drawn, 'a scheme with no packages and no feed drew something').toBe(0);
  });
});

/**
 * The book, asked twice.
 *
 * `/api/v1/exposure` was a near copy of `deals.exposure` — the same appraisal
 * loop, the same covenant test, and its own hand-rolled cost rollup. Two things
 * followed from the copy:
 *
 * 1. Budget-weighted progress was derived a THIRD time (`cost-report.ts` owns
 *    it as `weightedProgressPct`; `deals.exposure` had a copy; so did this).
 *    Three implementations of one rule, on three surfaces — the cost monitor's
 *    build-programme bar, the funding pack's overspending verdict, and a
 *    customer's own integration. `one-engine-sweep` now asks this of the tree.
 *
 * 2. This route had no bank feed at all. `drawn` was always committed spend,
 *    with no `drawnSource` for a consumer to notice by — so for a firm with a
 *    mapped account, the API and the funding pack answered "how much is drawn"
 *    with different numbers and neither said why.
 *
 * Both are now the engine's answer, so the question is asked once. This test
 * compares the two surfaces on ONE firm rather than pinning either to a
 * constant: a constant goes stale the day the rollup legitimately changes,
 * while "these two agree" is the property that actually matters and cannot be
 * satisfied by copying the defect into both.
 */
describe('the public API and the internal book', () => {
  it('give the same answer for the same firm, drawn figure and all', async () => {
    const T = await makeTenant('TwoSurfaces');
    await callerFor(T.principal).appraisal.save({ dealId: T.dealId, input: input(), label: 'Base' } as never);
    await callerFor(T.principal).cost.upsertPackage({
      dealId: T.dealId, name: 'Frame', budget: 900_000, committed: 500_000, spent: 300_000, forecast: 950_000, retentionPct: 5,
    } as never);
    await callerFor(T.principal).cost.upsertPackage({
      dealId: T.dealId, name: 'Fit-out', budget: 100_000, committed: 20_000, spent: 0, forecast: 120_000, retentionPct: 5,
    } as never);
    // deliberately lopsided: 10% on the £900k package and 100% on the £100k one.
    // A plain mean says 55%; weighted by what each is worth it is 19%. If either
    // surface reverts to averaging, the two stop agreeing here.
    await prisma.costPackage.updateMany({ where: { dealId: T.dealId, name: 'Frame' }, data: { progressPct: 10 } });
    await prisma.costPackage.updateMany({ where: { dealId: T.dealId, name: 'Fit-out' }, data: { progressPct: 100 } });

    const conn = await prisma.bankConnection.create({
      data: {
        orgId: T.orgId, institution: 'Test Bank', accessToken: 'x', refreshToken: 'y',
        expiresAt: new Date(Date.now() + 86_400_000), consentExpiresAt: new Date(Date.now() + 86_400_000),
        createdById: T.principal.userId,
      },
    });
    const acct = await prisma.bankAccount.create({
      data: { orgId: T.orgId, connectionId: conn.id, externalId: 'acc-2', name: 'Development', last4: '9876', dealId: T.dealId },
    });
    await prisma.bankTransaction.createMany({
      data: [
        { orgId: T.orgId, accountId: acct.id, externalId: 'p1', bookedAt: new Date(), amount: BigInt(600_000_00), description: 'Facility drawdown', classification: 'drawdown' },
        { orgId: T.orgId, accountId: acct.id, externalId: 'p2', bookedAt: new Date(), amount: BigInt(-310_000_00), description: 'Contractor payment', classification: 'cost' },
      ],
    });

    const key = (await callerFor({ ...T.principal, role: 'ADMIN' }).org.createApiKey({ name: 'compare', write: false } as never)) as {
      key: string;
    };
    const app = Fastify();
    registerPublicApi(app, prisma);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/v1/exposure', headers: { authorization: `Bearer ${key.key}` } });
    expect(res.statusCode, res.body).toBe(200);
    const pub = JSON.parse(res.body).data.positions.find((p: { dealId: string }) => p.dealId === T.dealId);

    const internal = (
      (await callerFor(T.principal).deals.exposure()) as {
        positions: Array<{ dealId: string; drawn: number; drawnSource: string; drawdown: { progressPct?: number; status: string; varianceOnProgress: number } | null }>;
      }
    ).positions.find((p) => p.dealId === T.dealId)!;

    expect(pub, 'the public route did not report the deal at all').toBeTruthy();

    /**
     * Discriminating: the equalities below hold if BOTH surfaces carry the same
     * wrong rule. These pin the values the fix actually changed — drawn is the
     * bank advance rather than committed spend, and the progress the drawdown
     * verdict rests on is the budget-weighted 19%, not the 55% a mean gives.
     */
    expect(internal.drawn, 'the internal book reported committed spend as drawn').toBe(600_000);
    expect(internal.drawnSource).toBe('bank');
    /**
     * To the penny, not to full float. The public surface rounds every money
     * figure to 2dp on purpose — "£14,848,183.911266606 is not a figure anyone
     * can do anything with" — so this compares at the precision that surface
     * actually publishes. Measured: the two differ by £0.0029, which is that
     * rounding and nothing else. Asserting tighter would pin a requirement the
     * API deliberately does not meet.
     */
    expect(internal.drawdown!.varianceOnProgress).toBeCloseTo(pub.drawdown.varianceOnProgress, 2);

    expect(pub.drawn, 'the public API and the funding pack disagree about how much is drawn').toBe(internal.drawn);
    expect(pub.drawnSource, 'the public API states no provenance for its drawn figure').toBe(internal.drawnSource);
    expect(pub.drawdown.status).toBe(internal.drawdown!.status);
  });
});
