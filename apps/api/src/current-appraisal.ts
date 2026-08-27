/**
 * "The current appraisal", defined once.
 *
 * `Appraisal.isCurrent` is true for exactly one row per deal — `a51595a` closed
 * the last path that could break that. But fourteen places asked the question
 * and resolved it three different ways: some `findFirst` with no order at all,
 * three with `orderBy: { updatedAt: 'desc' }`, and the two portfolio rollups by
 * building `new Map(rows.map(a => [a.dealId, a]))`, which keeps whichever row
 * arrived LAST.
 *
 * While the invariant holds those three agree, so nothing was visibly wrong.
 * The exposure is the same one `aa6a119` was about: nothing MADE them agree. If
 * a second current row ever appeared again — a bad migration, a restored
 * backup, a path nobody has thought of yet — the Red Book, the deal card and
 * `appraisal.getCurrent` would each report a different version, and every one of
 * them would be using the engine correctly on different inputs, which is the one
 * way the existing guards cannot see a disagreement.
 *
 * So the question has one answer: the most recently updated current row. Callers
 * take it from here rather than spelling it out, and `one-current-read-sweep`
 * refuses a new site that spells it out again.
 */

/** newest first, so "the current one" is well defined even if there are two */
export const CURRENT_FIRST = { updatedAt: 'desc' } as const;

/** the minimum of a Prisma delegate this needs — a transaction client satisfies it too */
type Findable<T> = { findFirst(args: unknown): Promise<T | null> };

/** The current appraisal for one deal, or null. */
export function currentAppraisal<T>(appraisal: Findable<T>, dealId: string, orgId: string): Promise<T | null> {
  return appraisal.findFirst({ where: { dealId, orgId, isCurrent: true }, orderBy: CURRENT_FIRST });
}

/**
 * The current appraisal per deal, across a whole workspace.
 *
 * Keeps the FIRST row seen for each deal, which is the newest when the rows come
 * back ordered by `CURRENT_FIRST` — so a portfolio rollup and a single deal's
 * report resolve to the same version rather than to opposite ends of a tie.
 */
export function currentByDeal<T extends { dealId: string }>(rows: T[]): Map<string, T> {
  const byDeal = new Map<string, T>();
  for (const row of rows) if (!byDeal.has(row.dealId)) byDeal.set(row.dealId, row);
  return byDeal;
}

/** Every current appraisal in a workspace, newest first so `currentByDeal` can trust the order. */
export function currentAppraisals<T>(appraisal: { findMany(args: unknown): Promise<T[]> }, orgId: string): Promise<T[]> {
  return appraisal.findMany({ where: { orgId, isCurrent: true }, orderBy: CURRENT_FIRST });
}
