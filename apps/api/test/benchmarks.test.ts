import { beforeAll, describe, expect, it } from 'vitest';
import { MIN_CONTRIBUTORS } from '@apex/appraisal-engine';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Contributed benchmarks.
 *
 * Three separate things have to hold, and each one has a way of failing that
 * looks fine on screen:
 *
 * A firm must never see another firm's cost base or scheme names. That was a real
 * leak once and the assertions that caught it are kept below.
 *
 * A cohort must be withheld until enough DIFFERENT firms are in it, because a
 * median over two contributors is arithmetic away from one of them.
 *
 * And a firm must never be compared against itself — including its own points
 * drags the median toward it and flatters the comparison most for whoever
 * contributes most.
 */

let A: Tenant;
let B: Tenant;

/** a contributed point from a given firm */
const point = (orgId: string | null, dealName: string, value: number, over: Record<string, unknown> = {}) =>
  prisma.benchmarkPoint.create({
    data: {
      orgId,
      region: 'BH',
      useClass: 'INDUSTRIAL',
      metric: 'buildPsf',
      value,
      period: '2026Q1',
      source: 'contributed',
      dealName,
      ...over,
    },
  });

/** enough distinct outside firms to clear the anonymity floor */
const populateCohort = async (region: string, count = MIN_CONTRIBUTORS + 3) => {
  for (let i = 0; i < count; i++) {
    const org = await prisma.organisation.create({ data: { name: `Contributor ${region} ${i}`, plan: 'TRIAL' } });
    await point(org.id, `Scheme ${i}`, 100 + i, { region });
  }
};

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Ours');
  B = await makeTenant('Theirs');

  await point(A.orgId, 'Our Wharf', 150);
  await point(B.orgId, 'Their Secret Scheme', 999);
}, 180_000);

describe('confidentiality between firms', () => {
  it('never shows one firm another firm’s deals or build costs', async () => {
    const trend = (await callerFor(A.principal).benchmarks.trend({ region: 'BH', useClass: 'INDUSTRIAL' } as never)) as {
      series: Array<{ own: Array<{ value: number; dealName: string | null }> }>;
    };
    const names = trend.series.flatMap((t) => t.own.map((o) => o.dealName));
    const values = trend.series.flatMap((t) => t.own.map((o) => o.value));

    expect(names).toContain('Our Wharf');
    expect(names, 'another firm’s deal name leaked into the trend').not.toContain('Their Secret Scheme');
    expect(values, 'another firm’s build cost leaked into the trend').not.toContain(999);
  });

  it('keeps other firms’ names out of the percentile strips too', async () => {
    const m = (await callerFor(A.principal).benchmarks.metrics({ region: 'BH', useClass: 'INDUSTRIAL' } as never)) as Record<
      string,
      { ownDeals: Array<{ dealName: string | null }> }
    >;
    const names = m.buildPsf.ownDeals.map((d) => d.dealName);
    expect(names).toContain('Our Wharf');
    expect(names).not.toContain('Their Secret Scheme');
  });
});

describe('the anonymity floor', () => {
  it('withholds a cohort of too few firms instead of publishing a median', async () => {
    /**
     * Only two firms have contributed to BH. Publishing a median there would let
     * either of them subtract their own figure and read the other's.
     */
    const m = (await callerFor(A.principal).benchmarks.metrics({ region: 'BH', useClass: 'INDUSTRIAL' } as never)) as Record<
      string,
      { basis: string; cohort: { published: boolean; reason?: string } }
    >;
    expect(m.buildPsf.cohort.published).toBe(false);
    expect(m.buildPsf.cohort.reason).toBe('too_few_contributors');
  });

  it('publishes once enough separate firms have contributed', async () => {
    await populateCohort('KENT');
    const m = (await callerFor(A.principal).benchmarks.metrics({ region: 'KENT', useClass: 'INDUSTRIAL' } as never)) as Record<
      string,
      { basis: string; cohort: { published: boolean; median?: number; contributors?: number } }
    >;
    expect(m.buildPsf.cohort.published).toBe(true);
    expect(m.buildPsf.basis).toBe('contributed');
    expect(m.buildPsf.cohort.contributors).toBeGreaterThanOrEqual(MIN_CONTRIBUTORS);
  });

  it('does not count a firm’s own points toward its own cohort', async () => {
    /**
     * The firm gets a large number of points into SOLO — enough that a naive
     * implementation would happily publish — but they are all its own, so after
     * exclusion there is nothing left to compare against.
     */
    for (let i = 0; i < 20; i++) await point(A.orgId, `Mine ${i}`, 200 + i, { region: 'SOLO' });
    const m = (await callerFor(A.principal).benchmarks.metrics({ region: 'SOLO', useClass: 'INDUSTRIAL' } as never)) as Record<
      string,
      { cohort: { published: boolean; reason?: string }; yours: number | null; rank: number | null }
    >;
    expect(m.buildPsf.cohort.published, 'a firm was published its own figures as the market').toBe(false);
    expect(m.buildPsf.rank, 'a rank against yourself is not a rank').toBeNull();
    // it still sees its own marker — that is its own data
    expect(m.buildPsf.yours).not.toBeNull();
  });

  it('withholds thin quarters from the trend rather than borrowing whatever it has', async () => {
    const trend = (await callerFor(A.principal).benchmarks.trend({ region: 'BH', useClass: 'INDUSTRIAL' } as never)) as {
      series: Array<{ cohortMedian: number | null }>;
    };
    expect(trend.series.every((s) => s.cohortMedian === null)).toBe(true);
  });
});

describe('illustrative data is never dressed as evidence', () => {
  it('labels a demonstration cohort as illustrative', async () => {
    for (let i = 0; i < 12; i++) {
      await prisma.benchmarkPoint.create({
        data: { orgId: null, region: 'DEMO', useClass: 'INDUSTRIAL', metric: 'buildPsf', value: 120 + i, period: '2026Q1', source: 'illustrative' },
      });
    }
    const m = (await callerFor(A.principal).benchmarks.metrics({ region: 'DEMO', useClass: 'INDUSTRIAL' } as never)) as Record<
      string,
      { basis: string; cohort: { published: boolean } }
    >;
    expect(m.buildPsf.basis, 'demonstration figures were presented as contributed market data').toBe('illustrative');
  });

  it('reports no basis at all where there is nothing', async () => {
    const m = (await callerFor(A.principal).benchmarks.metrics({ region: 'EMPTY', useClass: 'INDUSTRIAL' } as never)) as Record<
      string,
      { basis: string; cohort: { published: boolean; reason?: string } }
    >;
    expect(m.buildPsf.basis).toBe('none');
    expect(m.buildPsf.cohort.published).toBe(false);
    expect(m.buildPsf.cohort.reason).toBe('no_data');
    // the specific defect this replaces: quantiles of zero, rendering as a £0/ft² benchmark
    expect(m.buildPsf.cohort).not.toHaveProperty('median');
  });
});

describe('consent', () => {
  it('refuses to contribute from a workspace that has not opted in', async () => {
    await expectDenied('contribute without opting in', () => callerFor(A.principal).benchmarks.contribute(A.dealId as never));
  });

  it('withdraws what was already given when a firm opts out', async () => {
    const C = await makeTenant('Leaving');
    await point(C.orgId, 'Leaving Scheme', 175, { region: 'EXIT' });
    await prisma.organisation.update({ where: { id: C.orgId }, data: { contributesBenchmarks: true } });

    const before = await prisma.benchmarkPoint.count({ where: { orgId: C.orgId, source: 'contributed' } });
    expect(before).toBeGreaterThan(0);

    const result = (await callerFor(C.principal).benchmarks.setContribution({ enabled: false } as never)) as { withdrawn: number };
    expect(result.withdrawn).toBe(before);

    /**
     * The point of the test: a switch that only stopped FUTURE contributions
     * would leave this firm's figures in other firms' medians after it asked to
     * leave, which is not what anyone means by turning it off.
     */
    const after = await prisma.benchmarkPoint.count({ where: { orgId: C.orgId, source: 'contributed' } });
    expect(after).toBe(0);
  });

  it('lets an opted-in firm contribute, and counts firms rather than rows', async () => {
    const D = await makeTenant('Joining');
    await prisma.organisation.update({ where: { id: D.orgId }, data: { contributesBenchmarks: true } });
    await prisma.appraisal.create({
      data: {
        orgId: D.orgId,
        dealId: D.dealId,
        label: 'Base',
        isCurrent: true,
        units: JSON.stringify([{ label: 'Flats', count: 10, area: 900, cap: 355 }]),
        trades: JSON.stringify([{ label: 'Shell', rate: 140 }]),
        otherCosts: JSON.stringify([]),
      },
    });
    await callerFor(D.principal).benchmarks.contribute(D.dealId as never);

    const c = (await callerFor(D.principal).benchmarks.contributions()) as { total: number; firms: number; yours: number; optedIn: boolean };
    expect(c.yours).toBeGreaterThan(0);
    expect(c.optedIn).toBe(true);
    // three metrics per deal — the headline must be firms, not points
    expect(c.firms).toBeLessThan(c.total);
  });

  it('only lets an administrator change it', async () => {
    const E = await makeTenant('Viewer');
    const viewer = { ...E.principal, role: 'VIEWER' };
    await expectDenied('non-admin turning contribution on', () =>
      callerFor(viewer).benchmarks.setContribution({ enabled: true } as never),
    );
  });
});
