import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';
import { callerFor, makeTenant, prisma, resetDatabase } from './harness.js';

/**
 * Exactly one row per deal may be current, and the FIRST version is the path
 * nobody had guarded.
 *
 * `b39f174` fixed this for branching and `50ca9fc` for restoring, both with a
 * compare-and-set — the demote only counts if this call is the one that found
 * the row current. On this path there is no row to compare against: two callers
 * both read `existing` as null and both created.
 *
 * Measured before the fix, two concurrent `appraisal.save` calls on a fresh
 * deal:
 *
 *     >>> rows current: 2   total: 2
 *
 * and the outcome varied between runs. With two rows current, "the current
 * appraisal" is whichever the database happens to return — and the fourteen
 * places that ask resolve it in three different ways, so the Red Book, the deal
 * card and `appraisal.getCurrent` can each report a different version.
 *
 * WHAT THIS SUITE CAN AND CANNOT PROVE. It runs on SQLite, which has one
 * isolation level, so it proves the transaction is there and that the loser is
 * refused rather than admitted. It CANNOT tell `Serializable` from a weaker
 * level, because SQLite has no weaker level to offer — under Postgres READ
 * COMMITTED both transactions would miss each other's uncommitted row and both
 * commit, which is the trap `50ca9fc` recorded. The isolation level is asserted
 * separately below, and SQLite refuses any other value outright, so it cannot
 * be quietly downgraded.
 */

const INPUT = {
  units: [{ label: '2-bed apartments', count: 8, area: 750, cap: 420 }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate: 118 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

/**
 * The database is reset once; each test takes a NEW tenant, which brings its own
 * deal with no appraisal on it. Resetting per test deletes the SQLite file under
 * the open connection and every write then fails "readonly database".
 */
beforeAll(() => resetDatabase(), 120_000);
const freshDeal = () => makeTenant('FirstVersion');

describe('the first version of an appraisal', () => {
  it('leaves exactly one row current when two saves arrive at once', async () => {
    const T = await freshDeal();
    const c = callerFor(T.principal);
    const outcomes = await Promise.allSettled([
      c.appraisal.save({ dealId: T.dealId, input: INPUT, label: 'A' } as never),
      c.appraisal.save({ dealId: T.dealId, input: INPUT, label: 'B' } as never),
    ]);

    const current = await prisma.appraisal.count({ where: { dealId: T.dealId, isCurrent: true } });
    expect(current, 'two rows marked current — "the current appraisal" is now whichever one the database returns').toBe(1);

    /**
     * One winner, and the loser refused rather than admitted. A run where both
     * are fulfilled and only one row is current would mean the second silently
     * did nothing, which is worse than a refusal: the analyst would believe
     * their figures were saved.
     */
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.appraisal.count({ where: { dealId: T.dealId } })).toBe(1);
  });

  it('tells the loser what happened, in the words the other two paths use', async () => {
    const T = await freshDeal();
    const c = callerFor(T.principal);
    const outcomes = await Promise.allSettled([
      c.appraisal.save({ dealId: T.dealId, input: INPUT, label: 'A' } as never),
      c.appraisal.save({ dealId: T.dealId, input: INPUT, label: 'B' } as never),
    ]);
    const loser = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(loser, 'nobody lost — the race did not happen and this test proves nothing').toBeTruthy();
    expect((loser.reason as { code?: string }).code, 'a conflict reached the user as a server fault').toBe('CONFLICT');
    expect(String((loser.reason as Error).message)).toMatch(/saved the first version.*a moment ago/i);
  });

  it('still saves normally when nobody is racing', async () => {
    // the guard has to leave the ordinary case alone, which is the half a
    // concurrency fix usually breaks
    const T = await freshDeal();
    const c = callerFor(T.principal);
    const saved = (await c.appraisal.save({ dealId: T.dealId, input: INPUT, label: 'Base' } as never)) as {
      id: string;
      updatedAt: Date;
    };
    expect(saved.id).toBeTruthy();
    expect(await prisma.appraisal.count({ where: { dealId: T.dealId, isCurrent: true } })).toBe(1);

    /**
     * A second ordinary save edits that version rather than raising another.
     * It carries the stamp, because `b39f174` requires one for an in-place edit
     * — a fixture that skips it is not exercising the procedure a person uses.
     */
    await c.appraisal.save({
      dealId: T.dealId,
      input: INPUT,
      label: 'Base',
      expectedUpdatedAt: saved.updatedAt,
    } as never);
    expect(await prisma.appraisal.count({ where: { dealId: T.dealId } })).toBe(1);
    expect(await prisma.appraisal.count({ where: { dealId: T.dealId, isCurrent: true } })).toBe(1);
  });

  it('asks for Serializable, which is the whole point of the transaction', () => {
    /**
     * Asserted from the source because SQLite cannot demonstrate it: it has one
     * isolation level, so the behavioural tests above pass at any level it
     * would accept. Under Postgres READ COMMITTED the two transactions miss
     * each other's uncommitted row and both commit — the exact failure
     * `50ca9fc` recorded, and the reason this line is not decoration.
     *
     * A presence check is weak on its own; what makes this one hold is that
     * SQLite REFUSES any other level ("Failed to convert JavaScript value
     * `Undefined` into rust type `String`" for ReadCommitted), so a downgrade
     * cannot pass this suite quietly either way.
     */
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { resolver: unknown } }> } })
      ._def.procedures;
    const src = String(procedures['appraisal.save']!._def.resolver);
    expect(src, 'the first-version create is not in a transaction at all').toMatch(/\$transaction/);
    expect(src, 'the transaction runs at a level that cannot hold this invariant on Postgres').toMatch(
      /isolationLevel:\s*['"]Serializable['"]/,
    );
  });
});

/**
 * The abort the database makes to stay serialisable, and what the save does with it.
 *
 * Postgres does not block the loser of a serialisable conflict; it aborts one
 * with SQLSTATE 40001, which Prisma reports as P2034. This path used to read
 * that abort as proof somebody else had saved the first version — true when
 * there WAS somebody else, wrong the rest of the time. SSI aborts on the
 * possibility of a cycle rather than a proven one, so two saves on two unrelated
 * deals abort each other under load.
 *
 * CI found it. A browser test created a deal of its own, saved the first
 * appraisal on it, and was told somebody had got there first — on an id no other
 * test had ever seen, so no transaction existed that could have raced it.
 *
 * SQLite never raises P2034, so the abort is injected: `$transaction` is made to
 * throw it once, and only for the serialisable call this path makes. Retrying is
 * safe because the read that decides "nobody else has one" is inside the
 * transaction — a retry takes a fresh snapshot and refuses properly if a genuine
 * winner committed — and the test above still proves the loser of a real race is
 * refused.
 */
describe('a serialisation abort from the database', () => {
  it('is retried rather than reported as somebody else winning', async () => {
    const T = await makeTenant('Retry');
    const deal = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Aborted Once', address: '1 Retry Row', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });

    const realTx = prisma.$transaction.bind(prisma);
    let injected = 0;
    // only the serialisable call this path makes; every other transaction in the
    // save must run untouched or the test proves nothing about this one
    (prisma as unknown as { $transaction: unknown }).$transaction = ((...args: unknown[]) => {
      const opts = args[1] as { isolationLevel?: string } | undefined;
      if (opts?.isolationLevel === 'Serializable' && injected === 0) {
        injected++;
        return Promise.reject(Object.assign(new Error('write conflict'), { code: 'P2034' }));
      }
      return (realTx as (...a: unknown[]) => unknown)(...args);
    }) as never;

    try {
      const saved = await callerFor(T.principal).appraisal.save({ dealId: deal.id, input: INPUT, label: 'Base' } as never);
      expect(saved, 'the save gave up on an abort the database asked it to retry').toBeTruthy();
      expect(injected, 'the abort was never injected — this test proved nothing').toBe(1);
    } finally {
      (prisma as unknown as { $transaction: unknown }).$transaction = realTx as never;
    }

    // and exactly one row is current, which is the invariant the retry must not cost
    const rows = await prisma.appraisal.findMany({ where: { dealId: deal.id } });
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  /**
   * And when the retries run out, the caller still gets a refusal it can act on.
   *
   * Whether the cause was contention or a real winner, the answer to the person
   * saving is the same — reload and try again — so the exhausted case must not
   * escape as a raw driver error and become a 500. A save that fails should not
   * look like the server falling over.
   */
  it('refuses properly when the aborts never stop, rather than throwing a 500', async () => {
    const T = await makeTenant('Exhausted');
    const deal = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Aborted Always', address: '2 Retry Row', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });

    const realTx = prisma.$transaction.bind(prisma);
    let injected = 0;
    (prisma as unknown as { $transaction: unknown }).$transaction = ((...args: unknown[]) => {
      const opts = args[1] as { isolationLevel?: string } | undefined;
      if (opts?.isolationLevel === 'Serializable') {
        injected++;
        return Promise.reject(Object.assign(new Error('write conflict'), { code: 'P2034' }));
      }
      return (realTx as (...a: unknown[]) => unknown)(...args);
    }) as never;

    try {
      await expect(
        callerFor(T.principal).appraisal.save({ dealId: deal.id, input: INPUT, label: 'Base' } as never),
      ).rejects.toThrow(/saved the first version/i);
      // every attempt was spent, not just the first
      expect(injected).toBeGreaterThan(1);
    } finally {
      (prisma as unknown as { $transaction: unknown }).$transaction = realTx as never;
    }
  });
});
