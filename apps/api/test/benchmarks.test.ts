import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Benchmark contributions are a firm's own build costs, attached to their own
 * deal names. Market points carry no orgId and are shared on purpose; a firm's
 * OWN points are the opposite of shared — they are the commercially sensitive
 * half, and seeing a competitor's cost base and scheme names is the single worst
 * thing this feature could do.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Ours');
  B = await makeTenant('Theirs');

  const point = (orgId: string, dealName: string, value: number, isOwn: boolean) =>
    prisma.benchmarkPoint.create({
      data: { orgId: isOwn ? orgId : null, region: 'BH', useClass: 'INDUSTRIAL', metric: 'buildPsf', value, period: '2026Q1', isOwn, dealName },
    });

  await point(A.orgId, 'Our Wharf', 150, true);
  await point(B.orgId, 'Their Secret Scheme', 999, true);
  // ownerless market data, shared with everyone by design
  await point('', 'market', 140, false);
  await point('', 'market', 160, false);
}, 120_000);

describe('the build-cost trend', () => {
  it('never shows one firm another firm’s deals', async () => {
    const trend = (await callerFor(A.principal).benchmarks.trend({ region: 'BH', useClass: 'INDUSTRIAL' } as never)) as Array<{
      period: string;
      marketMedian: number;
      own: Array<{ value: number; dealName: string | null }>;
    }>;
    const names = trend.flatMap((t) => t.own.map((o) => o.dealName));
    const values = trend.flatMap((t) => t.own.map((o) => o.value));

    expect(names).toContain('Our Wharf');
    // a competitor's scheme name and their build rate
    expect(names, 'another firm’s deal name leaked into the trend').not.toContain('Their Secret Scheme');
    expect(values, 'another firm’s build cost leaked into the trend').not.toContain(999);
  });

  it('still shows the shared market series', async () => {
    const trend = (await callerFor(A.principal).benchmarks.trend({ region: 'BH', useClass: 'INDUSTRIAL' } as never)) as Array<{
      marketMedian: number;
    }>;
    // market points are ownerless and shared on purpose — scoping must not
    // silently remove the thing the chart exists to compare against
    expect(trend.some((t) => t.marketMedian > 0)).toBe(true);
  });
});

describe('the percentile strips', () => {
  it('rank your deals against the market, not against your competitors’ private data', async () => {
    const m = (await callerFor(A.principal).benchmarks.metrics({ region: 'BH', useClass: 'INDUSTRIAL' } as never)) as Record<
      string,
      { ownDeals: Array<{ dealName: string | null }> }
    >;
    const names = m.buildPsf.ownDeals.map((d) => d.dealName);
    expect(names).toContain('Our Wharf');
    expect(names).not.toContain('Their Secret Scheme');
  });
});
