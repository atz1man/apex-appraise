import { beforeAll, describe, expect, it } from 'vitest';
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
