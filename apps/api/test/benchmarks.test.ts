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
        reviewStatus: 'approved',
        reviewedAt: new Date(),
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

/**
 * WHICH deal a contribution belongs to.
 *
 * `contribute` replaces a deal's previous point for the period, and it matched
 * on `dealName`. A name is not an identity, and both failures land in a median
 * OTHER firms read as market evidence — this is the one place in the product
 * where one workspace's mistake moves another workspace's numbers.
 */
describe('replacing a deal’s own contribution', () => {
  /** an opted-in firm with an APPROVED appraisal on a named deal — the pool takes nothing less now */
  const contributor = async (label: string, dealName: string) => {
    const T = await makeTenant(label);
    await prisma.organisation.update({ where: { id: T.orgId }, data: { contributesBenchmarks: true } });
    await prisma.deal.update({ where: { id: T.dealId }, data: { name: dealName } });
    await prisma.appraisal.create({
      data: {
        orgId: T.orgId, dealId: T.dealId, label: 'Base', isCurrent: true, reviewStatus: 'approved', reviewedAt: new Date(),
        units: JSON.stringify([{ label: 'Flats', count: 10, area: 900, cap: 355 }]),
        trades: JSON.stringify([{ label: 'Shell', rate: 140 }]),
        otherCosts: JSON.stringify([]),
      },
    });
    return T;
  };
  const pointsFor = (orgId: string) =>
    prisma.benchmarkPoint.findMany({ where: { orgId, source: 'contributed', metric: 'buildPsf' } });

  it('replaces the same deal rather than stacking a second point', async () => {
    const T = await contributor('Twice', 'Riverside Phase 1');
    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    expect(await pointsFor(T.orgId), 'contributing twice stacked two points for one scheme').toHaveLength(1);
  });

  /**
   * The worse of the two failures, and the reason this needed a column rather
   * than a better string. Renaming matched nothing, so the old point stood
   * beside the new one — one scheme counted twice, doubling its weight in
   * everybody else's benchmark. Renaming a deal is ordinary: schemes get their
   * marketing name after the appraisal.
   */
  it('still replaces it after the deal is renamed', async () => {
    const T = await contributor('Renamed', 'Site off Quay Road');
    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    await callerFor(T.principal).deals.update({ id: T.dealId, patch: { name: 'Harbour Quarter' } } as never);
    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);

    const rows = await pointsFor(T.orgId);
    expect(rows, 'a renamed deal contributed twice — its scheme is double-weighted in the shared median').toHaveLength(1);
    expect(rows[0]!.dealName, 'the point kept the deal’s old name').toBe('Harbour Quarter');
  });

  /**
   * The other direction: two DIFFERENT schemes that happen to share a name.
   * Under the old rule the second erased the first, so a firm contributing both
   * was represented in the market by one.
   */
  it('does not let one scheme erase another that shares its name', async () => {
    const T = await contributor('SameName', 'Phase 1');
    const second = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Phase 1', address: '2 Other Street', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });
    await prisma.appraisal.create({
      data: {
        orgId: T.orgId, dealId: second.id, label: 'Base', isCurrent: true, reviewStatus: 'approved', reviewedAt: new Date(),
        units: JSON.stringify([{ label: 'Houses', count: 6, area: 1200, cap: 300 }]),
        trades: JSON.stringify([{ label: 'Shell', rate: 155 }]),
        otherCosts: JSON.stringify([]),
      },
    });

    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    await callerFor(T.principal).benchmarks.contribute(second.id as never);

    const rows = await pointsFor(T.orgId);
    expect(rows, 'one scheme erased another that merely shared its name').toHaveLength(2);
    // and they are genuinely two different schemes, not one written twice
    expect(new Set(rows.map((r) => r.dealId)).size).toBe(2);
    expect(rows[0]!.value).not.toBe(rows[1]!.value);
  });

  /**
   * A point contributed before the column existed carries no id. It must still
   * be replaceable, or the first contribution after this lands duplicates the
   * very scheme it was meant to replace.
   */
  it('still sweeps a point contributed before the deal id existed', async () => {
    const T = await contributor('Legacy', 'Old Mill');
    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    // make the existing points look like pre-migration rows
    await prisma.benchmarkPoint.updateMany({ where: { orgId: T.orgId }, data: { dealId: null } });

    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    const rows = await pointsFor(T.orgId);
    expect(rows, 'a legacy point was un-replaceable and duplicated').toHaveLength(1);
    expect(rows[0]!.dealId).toBe(T.dealId);
  });

  /**
   * And the legacy arm must still be about ONE deal.
   *
   * A mutation loosening it to `{ dealId: null }` — sweeping every idless point
   * this firm has in the period — passed every other case here, because they
   * all have a single legacy scheme. A firm that contributed two schemes before
   * the column existed would have had one erased by contributing the other:
   * the same defect the column was added to fix, wearing the fix's own clothes.
   */
  it('sweeps only the legacy point for THIS deal, not every idless one', async () => {
    const T = await contributor('LegacyPair', 'Mill Lane');
    const other = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Wharf Street', address: '9 Wharf St', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });
    await prisma.appraisal.create({
      data: {
        orgId: T.orgId, dealId: other.id, label: 'Base', isCurrent: true, reviewStatus: 'approved', reviewedAt: new Date(),
        units: JSON.stringify([{ label: 'Houses', count: 4, area: 1100, cap: 320 }]),
        trades: JSON.stringify([{ label: 'Shell', rate: 165 }]),
        otherCosts: JSON.stringify([]),
      },
    });
    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    await callerFor(T.principal).benchmarks.contribute(other.id as never);
    // both now look like pre-migration rows
    await prisma.benchmarkPoint.updateMany({ where: { orgId: T.orgId }, data: { dealId: null } });

    await callerFor(T.principal).benchmarks.contribute(T.dealId as never);
    const rows = await pointsFor(T.orgId);
    expect(rows, 'contributing one scheme erased another firm-mate’s legacy point').toHaveLength(2);
    expect(rows.map((r) => r.dealName).sort()).toEqual(['Mill Lane', 'Wharf Street']);
  });
});

/**
 * A figure filed under the wrong region is a wrong number in another firm's
 * appraisal, because this pool is shared and its medians are read as market
 * evidence.
 *
 * The feed used to answer "South West" for any address it did not recognise —
 * measured over sixteen addresses, fourteen of them, including Manchester,
 * Birmingham, Edinburgh, Sydney and a deal with no address at all. These are
 * the cases where it now declines instead.
 */
describe('a deal the pool cannot place', () => {
  it('contributes nothing, and says so rather than blaming the appraisal', async () => {
    const T = await makeTenant('Unplaceable');
    await prisma.organisation.update({ where: { id: T.orgId }, data: { contributesBenchmarks: true } });
    const deal = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Tower Yard', address: 'George Street, Sydney NSW', postcode: null, assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });
    await prisma.appraisal.create({
      data: {
        orgId: T.orgId,
        dealId: deal.id,
        label: 'Base',
        isCurrent: true,
        reviewStatus: 'approved',
        reviewedAt: new Date(),
        units: JSON.stringify([{ label: 'Flats', count: 10, area: 900, cap: 355 }]),
        trades: JSON.stringify([{ label: 'Shell', rate: 140 }]),
        otherCosts: JSON.stringify([]),
      },
    });

    // the refusal names the fix. Before this, both "cannot place it" and "no
    // areas yet" arrived as the same message, which sent people to look at a
    // unit schedule that was fine.
    await expect(callerFor(T.principal).benchmarks.contribute(deal.id as never)).rejects.toThrow(/could not be placed|postcode/i);

    // and NOTHING was written — not a point under a guessed region, not a point
    // under an empty one
    expect(await prisma.benchmarkPoint.count({ where: { orgId: T.orgId } })).toBe(0);
  });

  it('records the skip in the audit trail, so it is not merely silent', async () => {
    const T = await makeTenant('Unplaceable audit');
    await prisma.organisation.update({ where: { id: T.orgId }, data: { contributesBenchmarks: true } });
    const deal = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Nowhere Works', address: 'Somewhere', postcode: null, assetType: 'INDUSTRIAL', stage: 'COMPLETED' },
    });
    await prisma.appraisal.create({
      data: {
        orgId: T.orgId,
        dealId: deal.id,
        label: 'Base',
        isCurrent: true,
        reviewStatus: 'approved',
        reviewedAt: new Date(),
        units: JSON.stringify([{ label: 'Units', count: 4, area: 2000, cap: 220 }]),
        trades: JSON.stringify([{ label: 'Shell', rate: 110 }]),
        otherCosts: JSON.stringify([]),
      },
    });
    await prisma.costPackage.create({
      data: { orgId: T.orgId, dealId: deal.id, name: 'Shell', budget: 100_000_00n, committed: 100_000_00n, spent: 100_000_00n, forecast: 100_000_00n },
    });

    const { feedOutturn } = await import('../src/benchmark-feed.js');
    const fed = await feedOutturn(prisma, T.orgId, deal, { userId: T.principal.userId, name: 'Tester' });
    expect(fed).toBeNull();
    expect(await prisma.benchmarkPoint.count({ where: { orgId: T.orgId } })).toBe(0);

    const events = await prisma.activityEvent.findMany({ where: { orgId: T.orgId, dealId: deal.id } });
    const skip = events.find((e) => e.action === 'benchmark contribution skipped');
    expect(skip, 'a contribution that silently does nothing is the same defect one step quieter').toBeTruthy();
    expect(skip!.target).toMatch(/postcode/i);
  });

  it('still contributes a deal it CAN place, and under the right region', async () => {
    const T = await makeTenant('Placeable');
    await prisma.organisation.update({ where: { id: T.orgId }, data: { contributesBenchmarks: true } });
    const deal = await prisma.deal.create({
      // Manchester — which the old feed filed under the South West
      data: { orgId: T.orgId, name: 'Deansgate Block', address: 'Deansgate', postcode: 'M1 4BT', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });
    await prisma.appraisal.create({
      data: {
        orgId: T.orgId,
        dealId: deal.id,
        label: 'Base',
        isCurrent: true,
        reviewStatus: 'approved',
        reviewedAt: new Date(),
        units: JSON.stringify([{ label: 'Flats', count: 20, area: 750, cap: 420 }]),
        trades: JSON.stringify([{ label: 'Shell', rate: 180 }]),
        otherCosts: JSON.stringify([]),
      },
    });
    const res = (await callerFor(T.principal).benchmarks.contribute(deal.id as never)) as { region: string };
    expect(res.region).toBe('North West');
    const points = await prisma.benchmarkPoint.findMany({ where: { orgId: T.orgId } });
    expect(points.length).toBeGreaterThan(0);
    expect(new Set(points.map((p) => p.region))).toEqual(new Set(['North West']));
  });
});

describe('the market index', () => {
  it('fetches NOTHING for a region it has no slug for, rather than the South West under another name', async () => {
    /*
     * `fetchHpi` ended `?? 'south-west'`, so an unrecognised region was answered
     * with South West average prices carrying the asked-for region's label. A
     * market index named as somewhere it is not is worse than no index: nothing
     * on the screen tells the reader which one they are looking at.
     *
     * The assertion is that no request is MADE, not that the series comes back
     * empty — and the difference is the whole test. An earlier version checked
     * only the empty series, and survived restoring the `?? 'south-west'`
     * default: with the fallback in place it fetched twelve months of real
     * South West prices, every request failed in the sandbox, and an empty
     * series came back for a completely different reason.
     */
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      throw new Error('the market index must not be fetched for a region we cannot name');
    }) as typeof fetch;
    try {
      const res = (await callerFor(A.principal).benchmarks.hpi({ region: 'Atlantis' } as never)) as {
        region: string;
        series: unknown[];
      };
      expect(calls, 'a request was made for a region with no slug').toEqual([]);
      expect(res.series).toEqual([]);
      expect(res.region).toBe('Atlantis');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('has a slug for every cohort the picker offers', async () => {
    // the picker and the index were separate lists: the picker offered
    // "Midlands", which the index did not hold and silently served as the South
    // West. Now both come from the one table, so this cannot drift.
    const { UK_REGION_NAMES, hpiSlugFor } = await import('@apex/types/uk-regions');
    for (const name of UK_REGION_NAMES) expect(hpiSlugFor(name), name).toBeTruthy();
  });
});
