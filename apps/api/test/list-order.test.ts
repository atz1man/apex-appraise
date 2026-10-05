import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A list of rows this server hands out is ORDERED.
 *
 * Postgres guarantees no row order without `ORDER BY`, and under MVCC an UPDATE
 * writes a new tuple — so the row somebody just edited physically moves. SQLite
 * returns rowid order, which is insertion order and stable, so every local run
 * of every suite agreed and nothing noticed.
 *
 * `cost.list` had no `orderBy`. Found by CI, not by reading:
 * `e2e/cost-contractor.spec.ts` picks a contractor on the first package, reloads,
 * and asserts the same select still holds it. It passed locally for months and
 * failed in CI with
 *
 *     Expected: "cmuunz1uu004ivwx60qobfp4n"
 *     Received: "cmuunz1ur004cvwx6yu5oenrl"
 *
 * — a different package's dropdown, because the one just written had moved. What
 * the test caught in a selector, a valuer meets as a cost table whose rows jump
 * after every save, on the screen a lender pack is built from.
 *
 * Nine more sites had the same shape and two of them chose rows rather than
 * merely ordering them: `documentBlocks` takes `docs.slice(0, 4)`, and
 * `draftRisk` takes `rows.slice(0, 3)` of the scenarios — so which three
 * scenarios the AI risk commentary discussed was arbitrary, and
 * `unsupportedRecommendation` holds that prose to the option the engine ranks
 * best out of exactly those three.
 *
 * The rule cannot be "every findMany orders": most of these build a Map, a sum or
 * a count, where order is unobservable. So the bar is the same one
 * `provenance-sweep` and `lost-update-sweep` use — a decision somebody wrote
 * down. An entry here says why this list's order cannot be seen, and a new
 * unordered read has to be classified rather than merely added.
 */

const SRC = join(import.meta.dirname, '..', 'src');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return full.endsWith('.ts') ? [full] : [];
  });

/** Comments become blank space, so prose about a query is not a query. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');

/**
 * Every `findMany` and whether its own call carries an `orderBy`.
 *
 * The call's extent is found by matching parentheses rather than by a character
 * window: these calls run from one line to a dozen, and `upload-failure`'s own
 * first version is the standing reminder that a fixed window is a guess about
 * how far away the thing you are looking for is.
 */
export function findManyCalls(file: string, src: string): Array<{ site: string; model: string; ordered: boolean }> {
  const t = strip(src);
  const out: Array<{ site: string; model: string; ordered: boolean }> = [];
  for (const m of t.matchAll(/prisma\.(\w+)\.findMany\(/g)) {
    let depth = 1;
    let k = m.index! + m[0].length;
    for (; k < t.length && depth > 0; k++) {
      if (t[k] === '(') depth++;
      else if (t[k] === ')') depth--;
    }
    const call = t.slice(m.index!, k);
    out.push({
      site: `${file}:${m[1]}`,
      model: m[1]!,
      ordered: /orderBy/.test(call),
    });
  }
  return out;
}

/**
 * Reads whose order nobody can see, each with the reason.
 *
 * Keyed by `file:model` rather than by line, because a line number goes stale on
 * the next edit and an exemption that silently stops matching is worse than none.
 * Grouped by why:
 *
 *   INTO A MAP — the rows are immediately keyed by id and looked up.
 *   REDUCED — summed, counted, or tested for existence.
 *   ONE MATCH — `.find(…)` for a single row.
 *   NOT A LIST FOR A PERSON — internal plumbing with a single consumer.
 */
const ORDER_UNOBSERVABLE: Record<string, string> = {
  'benchmark-feed.ts:costPackage': 'summed into certified spend for the out-turn point; no row is shown.',
  'benchmark-feed.ts:deal': 'the backfill walks every deal and files a point per deal; nothing renders the sequence.',
  'org-delete.ts:user': 'collects addresses to notify on erasure, then iterates; no order is shown to anybody.',
  'routers/appraisal.ts:user': 'actor ids → a name Map for the version history, which is ordered by its own query.',
  'routers/appraisal.ts:deal': 'deal ids → a name Map for the review queue, which is ordered by its own query.',
  'routers/auth.ts:user': 'the demo accounts, checked for existence at boot. A set, not a list.',
  'routers/benchmarks.ts:benchmarkPoint': 'the pool behind a MEDIAN. The statistic is order-free by construction, and the sweep would otherwise demand an order for a number.',
  'routers/deals.ts:costPackage': 'keyed by dealId into the rollup, then handed to the engine per deal.',
  'routers/deals.ts:bankAccount': 'keyed by dealId for the drawn balance; one row per deal reaches the table.',
  'routers/inspections.ts:sitePhoto': 'checks every photograph an inspection names exists on this deal. A set membership test.',
  'routers/ops.ts:xeroDealMap': 'the deal↔tracking-option mapping, read into a Map by the sync.',
  'routers/org.ts:ssoConnection': 'every OTHER firm’s connection, to refuse a domain already claimed. An existence test.',
  'routers/org.ts:deal': 'deal ids → a name Map for the audit export.',
  'routers/portal.ts:deal': 'deal ids → a name Map for the open capital calls, which are sorted by due date after.',
  'routers/portal.ts:payment': 'found by `kind` while reconciling the schedule. The list RETURNED to the buyer is a second query, ordered by createdAt — which is schedule order, because the rows are created in it.',
  'routers/portal.ts:investor': 'investor ids → a name Map for the portal-access table.',
  'routers/portal.ts:unit': 'unit ids → a name Map for the portal-access table.',
  'routers/sales.ts:payment': 'summed into the refusal message when a plot with receipts against it is deleted.',
  'sso.ts:ssoConnection': 'every connection, to resolve an issuer at callback. A lookup by issuer.',
  'webhook-delivery.ts:webhookEndpoint': 'the live endpoints for one event; each is dispatched to independently, and the deliveries have their own ordered queue.',
  'xero.ts:xeroDealMap': 'the same mapping as ops.ts, read into a Map by the sync.',
  'routers/ops.ts:document': 'the SECOND read in documents.list — reduced to per-category counts and total bytes. The list a person reads is the first, ordered by addedAt.',
};

const allCalls = () =>
  sources(SRC).flatMap((f) => findManyCalls(f.slice(SRC.length + 1), readFileSync(f, 'utf8')));

describe('every list of rows is ordered, or its order cannot be seen', () => {
  it('finds the reads, from the real sources', () => {
    const calls = allCalls();
    expect(calls.length, 'no findMany was found — the matcher is broken').toBeGreaterThan(40);
    expect(calls.some((c) => c.site === 'routers/ops.ts:costPackage' && c.ordered), 'the cost table is unordered again').toBe(
      true,
    );
  });

  it('orders every list whose order somebody can see', () => {
    const unexplained = allCalls()
      .filter((c) => !c.ordered)
      .filter((c) => !(c.site in ORDER_UNOBSERVABLE))
      .map((c) => c.site);
    expect(
      [...new Set(unexplained)],
      'Postgres guarantees no row order and an UPDATE moves the row, so an unordered read is a list that reshuffles '
        + 'when somebody edits it. Add an orderBy, or add the site to ORDER_UNOBSERVABLE with the reason its order '
        + `cannot be seen.\n  ${[...new Set(unexplained)].join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no stale exemptions', () => {
    const unordered = new Set(allCalls().filter((c) => !c.ordered).map((c) => c.site));
    const gone = Object.keys(ORDER_UNOBSERVABLE).filter((s) => !unordered.has(s));
    expect(gone, `exempted reads that now order, or no longer exist: ${gone.join(', ')}`).toEqual([]);
    const thin = Object.entries(ORDER_UNOBSERVABLE).filter(([, why]) => why.trim().length < 40);
    expect(thin.map(([s]) => s), 'an exemption with no real reason is an exemption nobody checked').toEqual([]);
  });

  describe('the matcher itself', () => {
    it('sees an orderBy anywhere in the call, however it is spread', () => {
      const multi = `await prisma.deal.findMany({\n  where: { orgId },\n  orderBy: { name: 'asc' },\n});`;
      expect(findManyCalls('x.ts', multi)[0]!.ordered).toBe(true);
    });

    it('reports a call with none', () => {
      expect(findManyCalls('x.ts', 'await prisma.deal.findMany({ where: { orgId } });')[0]).toMatchObject({
        model: 'deal',
        ordered: false,
      });
    });

    /**
     * The extent is matched by parentheses, not by a window. A nested call —
     * `{ in: ids.map(…) }` — closes parens of its own, and a naive scan would end
     * the call early and miss an `orderBy` after it.
     */
    it('does not end the call at a nested parenthesis', () => {
      const nested =
        "await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { name: 'asc' } });";
      expect(findManyCalls('x.ts', nested)[0]!.ordered).toBe(true);
    });

    it('does not read a comment about a query as a query', () => {
      expect(findManyCalls('x.ts', '/* prisma.deal.findMany({}) with no orderBy */\nconst x = 1;')).toEqual([]);
    });
  });
});
