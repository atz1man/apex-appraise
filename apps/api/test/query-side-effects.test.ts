import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The two queries that wrote, driven rather than read.
 *
 * `no-query-writes.test.ts` asks the whole router the static question and is
 * what found these. This is the other half: what a VIEWER could actually DO
 * through them, and what concurrency actually produced — because a static rule
 * proves the shape is gone, not that the hole is closed.
 */

let A: Tenant;
beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('SideEffects');
}, 120_000);

const viewer = () => callerFor({ ...A.principal, role: 'VIEWER' });

/**
 * `sitePack.get` persisted whatever postcode it was passed. Measured before the
 * fix, as a VIEWER, on a deal set to BH15 1JF:
 *
 *     >>> call SUCCEEDED
 *     >>> postcode now: SW1A 1AA
 *     >>> activity events: 0
 *
 * The address on a valuation workfile is not cosmetic — `deals.update`'s own
 * comment says comparables, the site pack and the Red Book all read it.
 */
describe('looking up a site pack', () => {
  it('does not adopt the postcode it was asked about', async () => {
    await prisma.deal.update({ where: { id: A.dealId }, data: { postcode: 'BH15 1JF' } });
    await callerFor(A.principal).sitePack.get({ dealId: A.dealId, postcode: 'SW1A 1AA' } as never);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: A.dealId } });
    expect(after.postcode, 'a lookup rewrote the deal it was reading').toBe('BH15 1JF');
  });

  it('does not let a VIEWER move a scheme to another postcode', async () => {
    await prisma.deal.update({ where: { id: A.dealId }, data: { postcode: 'BH15 1JF' } });
    // the call itself may succeed — it is a read — but it must change nothing
    await viewer().sitePack.get({ dealId: A.dealId, postcode: 'SW1A 1AA' } as never).catch(() => undefined);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: A.dealId } });
    expect(after.postcode, 'a read-only account moved the scheme').toBe('BH15 1JF');
  });

  /**
   * And the postcode is still settable — by the mutation that guards and
   * records it. A fix that only removed the write would have left a screen with
   * no way to save a postcode at all, which is the shape `documents.shareWithBuyer`
   * was added to repair one commit earlier.
   */
  it('leaves the postcode settable through the mutation that records it', async () => {
    await callerFor(A.principal).deals.update({ id: A.dealId, patch: { postcode: 'SW1A 1AA' } } as never);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: A.dealId } });
    expect(after.postcode).toBe('SW1A 1AA');
    const events = await prisma.activityEvent.findMany({ where: { dealId: A.dealId, action: 'edited deal details' } });
    expect(events.length, 'the postcode moved with no record of who moved it').toBeGreaterThan(0);
  });
});

/**
 * `integrations.list` backfilled a placeholder row per self-serve provider,
 * inside a read. Measured against the real router before the fix:
 *
 *     three concurrent integrations.list() -> Companies House: 2 rows
 *     one call as a VIEWER                 -> 2 rows created
 */
describe('listing integrations', () => {
  const rowsFor = () => prisma.integrationConnection.findMany({ where: { orgId: A.orgId } });

  it('creates nothing, however many callers ask at once', async () => {
    await prisma.integrationConnection.deleteMany({ where: { orgId: A.orgId } });
    const c = callerFor(A.principal);
    await Promise.all([c.integrations.list(), c.integrations.list(), c.integrations.list()]);
    expect(await rowsFor(), 'a read created rows for a workspace that had none').toHaveLength(0);
  });

  it('creates nothing when a VIEWER asks', async () => {
    await prisma.integrationConnection.deleteMany({ where: { orgId: A.orgId } });
    await viewer().integrations.list();
    expect(await rowsFor(), 'a read-only account created rows').toHaveLength(0);
  });

  /**
   * The rows were never needed. A provider with no row reads as NOT_CONNECTED on
   * the screen already — so connecting has to work from nothing, or removing the
   * backfill would have broken every Connect button on a provider nobody had
   * touched.
   */
  it('still lets a firm connect a provider it has no row for', async () => {
    await prisma.integrationConnection.deleteMany({ where: { orgId: A.orgId } });
    await callerFor(A.principal).integrations.connect('Ordnance Survey' as never);
    const rows = await rowsFor();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('CONNECTED');
    // and it appears in the list, which is what the screen reads
    const listed = (await callerFor(A.principal).integrations.list()) as {
      connections: Array<{ provider: string }>;
      selfServe: Record<string, unknown>;
    };
    expect(listed.connections.map((r) => r.provider)).toContain('Ordnance Survey');
  });

  /**
   * Whether a provider takes the workspace's own API key travels with the
   * CATALOGUE, not with a row.
   *
   * It used to be attached to each row, so it existed only for a provider the
   * workspace happened to have a row for — survivable only while the query
   * backfilled a row for everything. Companies House is not in the demo seed,
   * and was in no seed of any workspace that registered before it was added, so
   * removing the backfill left the credentials drawer — the only way to give
   * this product a Companies House key — unable to open at all. CI caught it in
   * `e2e/screens.spec.ts`; this is the API-side pin, because a browser test is
   * a slow way to learn the shape of a response.
   */
  it('says which providers take a key, for a workspace with no rows at all', async () => {
    await prisma.integrationConnection.deleteMany({ where: { orgId: A.orgId } });
    const listed = (await callerFor(A.principal).integrations.list()) as {
      connections: unknown[];
      selfServe: Record<string, { fields: Array<{ key: string; label: string }>; signupUrl: string } | undefined>;
    };
    expect(listed.connections, 'the fixture is not actually empty, so this proves nothing').toHaveLength(0);
    expect(
      listed.selfServe['Companies House'],
      'a workspace with no rows cannot be told Companies House takes a key — the drawer never opens',
    ).toBeTruthy();
    expect(listed.selfServe['Companies House']!.fields.map((f) => f.label)).toEqual(['API key']);
    expect(listed.selfServe['EPC Register']).toBeTruthy();
    // and a provider that does NOT take a key is absent, or every card would open a drawer
    expect(listed.selfServe['HM Land Registry']).toBeFalsy();
  });

  /**
   * The composite key, which is what makes a double-click harmless now that a
   * write can happen from two places. Without it, `connect` racing itself would
   * reproduce exactly the duplication the query used to cause — and duplicates
   * matter because `getIntegrationCreds` resolves a provider with `findFirst`.
   */
  it('keeps one row per provider when connect races itself, and refuses nobody', async () => {
    await prisma.integrationConnection.deleteMany({ where: { orgId: A.orgId } });
    const c = callerFor(A.principal);
    const outcomes = await Promise.allSettled([
      c.integrations.connect('BCIS' as never),
      c.integrations.connect('BCIS' as never),
      c.integrations.connect('BCIS' as never),
    ]);

    const rows = (await rowsFor()).filter((r) => r.provider === 'BCIS');
    expect(rows, 'a provider ended up with two rows — a saved key can be read from the wrong one').toHaveLength(1);

    /**
     * And every caller succeeded. The row count alone measures the unique KEY,
     * not the upsert: a read-then-create would also leave one row, because the
     * loser's insert is rejected by the constraint — it just fails in the user's
     * face. Measured: a mutation swapping the upsert for findFirst-then-create
     * passed this test until this assertion existed. Pressing Connect twice is
     * not an error.
     */
    const refused = outcomes.filter((o) => o.status === 'rejected');
    expect(
      refused.map((o) => String((o as PromiseRejectedResult).reason).slice(0, 120)),
      'a second Connect was refused rather than being a no-op',
    ).toEqual([]);
  });

  /**
   * WHAT THIS SUITE CANNOT PROVE, asserted from the source instead — the same
   * concession, for the same reason, that `appraisal-first-version.test.ts`
   * makes about `isolationLevel: 'Serializable'`.
   *
   * The race above does not reproduce on SQLite: Prisma holds one connection,
   * so each read completes before the next write and a read-then-create never
   * loses. Measured — a mutation swapping the upsert for findFirst-then-create
   * passes every behavioural case in this file. Under Postgres it would not:
   * two callers both find nothing, both insert, and the loser takes a P2002 in
   * the user's face on a button that should be idempotent.
   *
   * A presence check is weak on its own. What gives this one teeth is the
   * composite key beside it — `@@unique([orgId, provider])` is what makes the
   * upsert atomic rather than hopeful, and it is asserted behaviourally above
   * by the row count.
   */
  it('connects through an upsert, which SQLite cannot demonstrate', async () => {
    const { appRouter } = await import('../src/router.js');
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { resolver: unknown } }> } })
      ._def.procedures;
    const src = String(procedures['integrations.connect']!._def.resolver);
    expect(src, 'connect reads then writes — under Postgres the loser of a double-click gets a 500').toMatch(
      /integrationConnection\.upsert\(/,
    );
    expect(src, 'the upsert is not keyed on the composite unique key, so it cannot be atomic').toMatch(
      /orgId_provider/,
    );
  });
});
