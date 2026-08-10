import { describe, expect, it } from 'vitest';
import { MIN_CONTRIBUTORS, MIN_POINTS, cohortStats, periodMedian, rankWithin, type CohortPoint } from '../src/index.js';

/** n points spread across `firms` firms, values 1..n so quantiles are checkable by hand */
const spread = (n: number, firms: number, offset = 0): CohortPoint[] =>
  Array.from({ length: n }, (_, i) => ({ value: offset + i + 1, orgId: `firm-${i % firms}` }));

describe('cohortStats — the anonymity floor', () => {
  it('withholds a cohort that too few FIRMS contributed to, however many points it holds', () => {
    /**
     * The failure this prevents: forty schemes from two firms looks like a
     * healthy sample by row count. It is not anonymous — either firm can
     * subtract its own figures and read the other's cost base off the remainder.
     * The floor counts people, not rows.
     */
    const verdict = cohortStats(spread(40, 2));
    expect(verdict.published).toBe(false);
    if (verdict.published) return;
    expect(verdict.reason).toBe('too_few_contributors');
    expect(verdict.contributors).toBe(2);
    expect(verdict.points).toBe(40);
  });

  it('withholds a cohort of enough firms but too few points', () => {
    const verdict = cohortStats(spread(6, 6));
    expect(verdict.published).toBe(false);
    if (verdict.published) return;
    expect(verdict.reason).toBe('too_few_points');
    expect(verdict.contributors).toBe(6);
  });

  it('publishes once both floors are met', () => {
    const verdict = cohortStats(spread(MIN_POINTS, MIN_CONTRIBUTORS));
    expect(verdict.published).toBe(true);
  });

  it('returns no_data for an empty set rather than a cohort of zeros', () => {
    /**
     * The specific defect in the previous implementation: every quantile came
     * back 0, which renders as a £0/ft² market benchmark — a number a reader has
     * no way to recognise as an absence.
     */
    const verdict = cohortStats([]);
    expect(verdict.published).toBe(false);
    if (verdict.published) return;
    expect(verdict.reason).toBe('no_data');
    expect(verdict).not.toHaveProperty('median');
  });
});

describe('cohortStats — never compared against yourself', () => {
  it('excludes the reader’s own points from the distribution', () => {
    // ten firms, one point each at 1..10; the reader is firm-0 sitting at 1
    const points: CohortPoint[] = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, orgId: `firm-${i}` }));
    const withMine = cohortStats(points);
    const withoutMine = cohortStats(points, { excludeOrgId: 'firm-0' });
    expect(withMine.published && withMine.median).toBe(5.5);
    // 2..10 → median 6
    expect(withoutMine.published && withoutMine.median).toBe(6);
    expect(withoutMine.published && withoutMine.points).toBe(9);
    expect(withoutMine.published && withoutMine.contributors).toBe(9);
  });

  it('withholds when excluding your own points drops the cohort below the floor', () => {
    /**
     * The order matters: exclusion happens BEFORE the floor is tested. A cohort
     * that only clears the threshold because the reader's own schemes are in it
     * is not a market view, and publishing it would flatter exactly the firm
     * that contributed most.
     */
    const others = spread(MIN_POINTS, MIN_CONTRIBUTORS - 1);
    const mine: CohortPoint[] = [{ value: 99, orgId: 'me' }, { value: 98, orgId: 'me' }];
    expect(cohortStats([...others, ...mine]).published).toBe(true);
    const verdict = cohortStats([...others, ...mine], { excludeOrgId: 'me' });
    expect(verdict.published).toBe(false);
    if (!verdict.published) expect(verdict.reason).toBe('too_few_contributors');
  });
});

describe('quantiles', () => {
  it('interpolates between neighbours', () => {
    // 1..10 across ten firms: p25 sits a quarter of the way along nine gaps
    const points: CohortPoint[] = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, orgId: `firm-${i}` }));
    const v = cohortStats(points);
    expect(v.published).toBe(true);
    if (!v.published) return;
    expect(v.p25).toBeCloseTo(3.25, 10);
    expect(v.median).toBeCloseTo(5.5, 10);
    expect(v.p75).toBeCloseTo(7.75, 10);
    expect(v.lo).toBeCloseTo(1.45, 10);
    expect(v.hi).toBeCloseTo(9.55, 10);
  });
});

describe('rankWithin', () => {
  it('ranks against the same set the quantiles came from', () => {
    const points: CohortPoint[] = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, orgId: `firm-${i}` }));
    // excluding firm-0 leaves 2..10; a value of 6 is at or above five of nine
    expect(rankWithin(points, 6, { excludeOrgId: 'firm-0' })).toBe(56);
  });

  it('gives no rank where the cohort is withheld', () => {
    expect(rankWithin(spread(40, 2), 10)).toBeNull();
    expect(rankWithin([], 10)).toBeNull();
  });

  it('gives no rank for a firm with nothing to compare', () => {
    expect(rankWithin(spread(MIN_POINTS, MIN_CONTRIBUTORS), null)).toBeNull();
  });
});

describe('periodMedian', () => {
  it('returns null for a thin quarter instead of borrowing whatever it has', () => {
    /**
     * A trend line that fills sparse quarters with a two-firm median draws a
     * shape somebody will read a tender-conditions story into.
     */
    expect(periodMedian(spread(3, 2))).toBeNull();
    expect(periodMedian(spread(MIN_POINTS, MIN_CONTRIBUTORS))).not.toBeNull();
  });
});
