/**
 * Cohort statistics for contributed benchmarks.
 *
 * A benchmark is only worth anything if the firm reading it can tell what it is
 * made of. Two rules follow from that, and both are enforced here rather than in
 * a screen, because a screen is one of several ways these numbers get out — the
 * API and the report can reach them too.
 *
 * FIRST: a cohort is withheld until enough DIFFERENT firms are in it. With two
 * contributors a median is close to arithmetic on somebody's confidential cost
 * base: subtract your own figure and what remains is theirs. The floor is on
 * distinct contributors, not on points, because one firm contributing forty
 * schemes is still one firm — an anonymity claim that counts rows rather than
 * people is the standard way this goes wrong.
 *
 * SECOND: a firm is never compared against itself. Including your own points in
 * the cohort drags the median toward you and flatters the comparison, most of all
 * for the firm that contributes most. The exclusion happens BEFORE the floor is
 * tested, so removing your own points can legitimately take a cohort below the
 * threshold — and then it is withheld, rather than published on the strength of
 * data the reader supplied.
 */

/** Distinct contributing firms required before a cohort may be shown. */
export const MIN_CONTRIBUTORS = 5;
/** Points required as well — five firms with one scheme each is a thin median. */
export const MIN_POINTS = 8;

export interface CohortPoint {
  value: number;
  /** the contributing firm; used for counting and exclusion, never returned */
  orgId: string;
}

export type CohortVerdict =
  | {
      published: true;
      lo: number;
      p25: number;
      median: number;
      p75: number;
      hi: number;
      points: number;
      contributors: number;
    }
  | {
      published: false;
      /** why, so the screen can say something true instead of showing zeros */
      reason: 'no_data' | 'too_few_contributors' | 'too_few_points';
      points: number;
      contributors: number;
      // the thresholds travel with the verdict so a screen can name them without
      // keeping its own copy — two constants drifting apart would have the UI
      // promising a floor the server does not apply
      minContributors: number;
      minPoints: number;
    };

/**
 * Linear-interpolated quantile over a SORTED ascending array.
 *
 * Not exported as a general utility on purpose: it returns nothing meaningful for
 * an empty set, and the only safe caller is one that has already established the
 * set is publishable.
 */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function cohortStats(points: CohortPoint[], opts: { excludeOrgId?: string } = {}): CohortVerdict {
  const eligible = opts.excludeOrgId ? points.filter((p) => p.orgId !== opts.excludeOrgId) : points;
  const contributors = new Set(eligible.map((p) => p.orgId)).size;
  const count = eligible.length;

  // an empty cohort is NOT a cohort of zeros — the previous implementation
  // returned 0 for every quantile, which renders as a £0/ft² market benchmark
  const floors = { minContributors: MIN_CONTRIBUTORS, minPoints: MIN_POINTS };
  if (count === 0) return { published: false, reason: 'no_data', points: 0, contributors: 0, ...floors };
  if (contributors < MIN_CONTRIBUTORS) {
    return { published: false, reason: 'too_few_contributors', points: count, contributors, ...floors };
  }
  if (count < MIN_POINTS) return { published: false, reason: 'too_few_points', points: count, contributors, ...floors };

  const sorted = eligible.map((p) => p.value).sort((a, b) => a - b);
  return {
    published: true,
    lo: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    hi: quantile(sorted, 0.95),
    points: count,
    contributors,
  };
}

/**
 * Where a value sits in a published cohort, as a percentile.
 *
 * Null for a withheld cohort: a rank is a statement about a distribution, and
 * without a distribution worth publishing there is no rank worth quoting.
 */
export function rankWithin(
  points: CohortPoint[],
  value: number | null | undefined,
  opts: { excludeOrgId?: string } = {},
): number | null {
  if (value == null) return null;
  // derived from the same points and the same floor as the cohort itself: a rank
  // taken against a different set than the quantiles is a mismatch nobody would
  // see, since both render as ordinary numbers
  if (!cohortStats(points, opts).published) return null;
  const eligible = opts.excludeOrgId ? points.filter((p) => p.orgId !== opts.excludeOrgId) : points;
  return Math.round((eligible.filter((p) => p.value <= value).length / eligible.length) * 100);
}

/**
 * The median per period, for a trend line.
 *
 * Every period carries the same floor as a cohort. A quarter with two
 * contributors is withheld even when the neighbouring quarters are published —
 * a trend line that silently fills thin quarters with whatever it has is a
 * shape somebody will read a tender conditions story into.
 */
export function periodMedian(points: CohortPoint[], opts: { excludeOrgId?: string } = {}): number | null {
  const verdict = cohortStats(points, opts);
  return verdict.published ? verdict.median : null;
}
