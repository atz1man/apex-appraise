import { describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';

/**
 * A query may not write.
 *
 * Fifteen mechanical sweeps guard this router, and two of the most important
 * ask their question of MUTATIONS:
 *
 *   `viewer-readonly`    — every internal mutation must refuse a VIEWER.
 *   `provenance-sweep`   — every mutation must write an audit event.
 *
 * Both walk `appRouter._def.procedures` and both filter on
 * `_def.type === 'mutation'`. So a write placed inside a procedure declared as a
 * query is not exempted by anybody's judgement — it is simply never asked about.
 * The browser has the same blind spot: `web/src/lib/read-only.ts` refuses
 * MUTATIONS locally, so a viewer's client raises no objection either.
 *
 * `sitePack.get` was such a procedure. It persisted whatever postcode it was
 * passed. Measured against the real router, as a VIEWER, on a deal set to
 * BH15 1JF:
 *
 *     >>> call SUCCEEDED
 *     >>> postcode now: SW1A 1AA
 *     >>> activity events: 0
 *
 * A read-only account moved a scheme to a different postcode, with no trace —
 * and the address is not cosmetic on a valuation workfile: comparables, the site
 * pack and the Red Book all read it.
 *
 * That was found by reading. This asks it of every query at once, so the
 * sixteenth one cannot reintroduce the blind spot.
 *
 * WHY THE RESOLVER SOURCE rather than behaviour. A behavioural version would
 * have to call every query with arguments that provoke a write, which is
 * exactly the thing nobody knows in advance — the defect above only wrote when
 * a postcode differing from the deal's was supplied. Reading the handler tRPC
 * actually bound to the path catches it whatever the arguments.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH: a write inside a helper the query calls.
 * `opendata-cache.ts` writes `OpenDataCache` on behalf of half the queries here,
 * and that is a cache fill, not a change to a customer's records — a read that
 * remembers its answer. Following calls into helpers would flag all of those and
 * be exempted into uselessness within a month, which is the failure mode
 * `one-engine-sweep` records for itself. This asks a narrower question that has
 * a clear answer: does the procedure's own body change a row?
 */

/** Prisma writes, as they appear in a resolver's own source. */
const WRITES = [
  /\.create\(/,
  /\.createMany\(/,
  /\.update\(/,
  /\.updateMany\(/,
  /\.upsert\(/,
  /\.delete\(/,
  /\.deleteMany\(/,
  /\$executeRaw/,
];

/**
 * Writing down that the read happened is not the thing this guards against.
 *
 * `org.exportData` hands a workspace its whole GDPR export and records an
 * activity event saying so. That write is the audit trail recording ITSELF —
 * the opposite of the fault here, which is a read quietly changing a customer's
 * records where neither `viewer-readonly` nor `provenance-sweep` will ask about
 * it. Stripping these two before matching keeps the rule narrow enough to mean
 * something: a query that writes anything ELSE alongside its audit line still
 * fails, because only these calls are removed, not the statements around them.
 */
const AUDIT_WRITES = [/recordAudit\([\s\S]*?\)/g, /activityEvent\.create\([\s\S]*?\}\s*\)/g];
const withoutAuditTrail = (src: string) => AUDIT_WRITES.reduce((t, re) => t.replace(re, ''), src);

/**
 * Queries permitted to write, each with the reason. A new entry here is a
 * decision somebody has to defend in review — which is the point, and is why
 * the list is empty: a query that must change a row is a mutation wearing the
 * wrong label, and the fix is to move the write rather than to add a line here.
 */
const ALLOWED: Record<string, string> = {};

type Proc = { _def: { type: string; resolver?: unknown } };
const procedures = (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures;

describe('a query may not write', () => {
  const queries = Object.entries(procedures).filter(([, p]) => p._def.type === 'query');

  it('finds the queries it is meant to be sweeping', () => {
    /**
     * A sweep over an empty list passes silently, reporting success for a
     * question it never asked. Two checks: there are many queries, and the one
     * this sweep was written for is among them.
     */
    expect(queries.length, 'no queries found — the router shape has moved').toBeGreaterThan(30);
    expect(queries.map(([name]) => name)).toContain('sitePack.get');
  });

  it('is true of every query in the router', () => {
    const offenders = queries
      .filter(([name]) => !(name in ALLOWED))
      .filter(([, p]) => {
        const src = withoutAuditTrail(String(p._def.resolver));
        return WRITES.some((re) => re.test(src));
      })
      .map(([name]) => name);

    expect(
      offenders,
      'these are declared as queries and change rows in their own body — so `viewer-readonly` ' +
        'never asks whether a VIEWER may run them, `provenance-sweep` never asks whether they ' +
        'record anything, and the browser’s read-only guard lets them through too. Move the ' +
        'write into a mutation.',
    ).toEqual([]);
  });

  /**
   * The sweep's own teeth, checked rather than assumed. A matcher list that
   * quietly stopped matching would leave the suite green over the exact defect
   * it was written for — the failure `one-engine-sweep` and `cascade` both guard
   * against with a case of this shape.
   */
  it('recognises a write when it sees one', () => {
    const planted = `async ({ ctx, input }) => {
      await ctx.prisma.deal.update({ where: { id: input.id }, data: { postcode: input.postcode } });
      return null;
    }`;
    expect(WRITES.some((re) => re.test(planted)), 'the matchers no longer recognise a prisma write').toBe(true);

    // and it does not fire on an ordinary read, or this test would prove nothing
    const reader = `async ({ ctx, input }) => ctx.prisma.deal.findFirst({ where: { id: input } })`;
    expect(WRITES.some((re) => re.test(reader))).toBe(false);
  });

  /**
   * The audit-trail exemption, held to its own boundary. It must swallow a
   * query that only records itself, and must NOT swallow one that records
   * itself and also changes a row — which is what an exemption written
   * carelessly would do, and would have hidden the `sitePack.get` defect behind
   * a single added audit line.
   */
  it('excuses a query that only records itself, and no more than that', () => {
    const recordsOnly = `async ({ ctx }) => {
      const file = await exportWorkspace(ctx.prisma, orgId);
      await ctx.prisma.activityEvent.create({ data: { orgId, actor: ctx.principal.name, action: 'exported' } });
      return file;
    }`;
    expect(WRITES.some((re) => re.test(withoutAuditTrail(recordsOnly)))).toBe(false);

    const recordsAndWrites = `async ({ ctx, input }) => {
      await ctx.prisma.deal.update({ where: { id: input.id }, data: { postcode: input.postcode } });
      await ctx.prisma.activityEvent.create({ data: { orgId, actor: ctx.principal.name, action: 'looked' } });
      return null;
    }`;
    expect(
      WRITES.some((re) => re.test(withoutAuditTrail(recordsAndWrites))),
      'an audit line would let a query change rows behind it',
    ).toBe(true);
  });
});
