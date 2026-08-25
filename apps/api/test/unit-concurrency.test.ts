import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Two agents on one plot — or one flat.
 *
 * upsertUnit writes EVERY field of the row from a single drawer — agreed value,
 * buyer, solicitor, incentive, progress — so with no check the second save
 * reverts the first. Unlike the appraisal there is no version history to
 * recover from and no review status to notice it: the agreed value simply reads
 * as whatever the last person to press Save had on their screen when they
 * opened it.
 *
 * That figure goes into a memorandum of sale. A plot reverting from £455,000 to
 * £450,000 because a colleague was editing the buyer's solicitor at the same
 * time is a commercial error that reaches a contract, and nobody would know to
 * look for it.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const plot = (over: Record<string, unknown> = {}) => ({
  dealId: T.dealId,
  name: 'Plot 11',
  spec: '3-bed semi',
  level: 0,
  appraisedValue: 450_000,
  agreedValue: null,
  buyerName: null,
  buyerSolicitor: null,
  leadSource: null,
  incentive: null,
  progress: 0,
  stalled: false,
  ...over,
});

const rowOf = (id: string) => prisma.unit.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Sales');
}, 120_000);

const tenancy = (over: Record<string, unknown> = {}) => ({
  dealId: T.dealId,
  name: 'Apt 4',
  spec: '1-bed',
  level: 0,
  ervPcm: 1_450,
  agreedRentPcm: null,
  tenantName: null,
  leadSource: null,
  incentive: null,
  progress: 0,
  stalled: false,
  ...over,
});

describe('two agents on one plot', () => {
  it('refuses the stale copy rather than reverting the agreed value', async () => {
    const created = (await caller().sales.upsertUnit(plot() as never)) as { id: string; updatedAt: Date };

    // both drawers are open on this stamp
    const opened = created.updatedAt;

    // one agent records the negotiated uplift
    await caller().sales.upsertUnit(
      plot({ id: created.id, agreedValue: 455_000, buyerName: 'A. Chen', progress: 1, expectedUpdatedAt: opened }) as never,
    );

    // @updatedAt has millisecond resolution
    await new Promise((r) => setTimeout(r, 5));

    /**
     * The other agent presses Save on the copy they opened before that, having
     * only added the solicitor. Their form still carries the appraised figure
     * as the agreed one, because that is what the plot said when they opened it.
     */
    await expect(
      caller().sales.upsertUnit(
        plot({ id: created.id, buyerSolicitor: 'Hale & Co', progress: 1, expectedUpdatedAt: opened }) as never,
      ),
    ).rejects.toThrow(/plot .*Plot 11.* was saved.*after you opened it/s);

    const row = await rowOf(created.id);
    expect(row.agreedValue, 'the agreed value was reverted by the stale save').toBe(45_500_000n);
    expect(row.buyerName).toBe('A. Chen');
    // and the refusal did not half-apply
    expect(row.buyerSolicitor).toBeNull();
  });

  it('tells a caller that forgot the stamp what to send', async () => {
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 12' }) as never)) as { id: string };
    await expect(
      caller().sales.upsertUnit(plot({ id: made.id, name: 'Plot 12', agreedValue: 1 }) as never),
    ).rejects.toThrow(/expectedUpdatedAt/);
  });

  it('needs no stamp to add a plot that does not exist yet', async () => {
    // nothing to overwrite, so nothing to check
    await expect(caller().sales.upsertUnit(plot({ name: 'Plot 13' }) as never)).resolves.toBeTruthy();
  });

  it('hands back a stamp that works for the next save', async () => {
    // a second edit in the same drawer must not depend on the refetch landing
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 14' }) as never)) as { id: string; updatedAt: Date };
    const again = (await caller().sales.upsertUnit(
      plot({ id: made.id, name: 'Plot 14', agreedValue: 460_000, expectedUpdatedAt: made.updatedAt }) as never,
    )) as { updatedAt: Date };

    await expect(
      caller().sales.upsertUnit(
        plot({ id: made.id, name: 'Plot 14', agreedValue: 462_000, expectedUpdatedAt: again.updatedAt }) as never,
      ),
    ).resolves.toBeTruthy();
    expect((await rowOf(made.id)).agreedValue).toBe(46_200_000n);
  });

  it('holds a letting to the same rule, because it is the same drawer', async () => {
    // the sales and lettings modes are one screen and one form; a guard on half
    // of it is the half somebody relies on. An agreed rent is a tenancy term.
    const made = (await caller().sales.upsertTenancy(tenancy() as never)) as { id: string; updatedAt: Date };
    const opened = made.updatedAt;

    await caller().sales.upsertTenancy(
      tenancy({ id: made.id, agreedRentPcm: 1_525, tenantName: 'R. Okafor', progress: 4, expectedUpdatedAt: opened }) as never,
    );
    await new Promise((r) => setTimeout(r, 5));

    await expect(
      caller().sales.upsertTenancy(tenancy({ id: made.id, incentive: 'One month free', expectedUpdatedAt: opened }) as never),
    ).rejects.toThrow(/tenancy .*Apt 4.* was saved.*after you opened it/s);

    const row = await prisma.tenancy.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.agreedRentPcm, 'the agreed rent was reverted by the stale save').toBe(152_500n);
    expect(row.tenantName).toBe('R. Okafor');
    expect(row.incentive).toBeNull();
  });

  it('publishes the stamp on both lists the drawer loads from', async () => {
    // the web holds what these hand it; if the field stops being returned every
    // in-place save fails on a missing stamp instead
    const units = (await caller().sales.units(T.dealId as never)) as { units: Array<{ updatedAt: Date }> };
    expect(units.units.length).toBeGreaterThan(0);
    for (const u of units.units) expect(u.updatedAt).toBeInstanceOf(Date);

    const lets = (await caller().sales.tenancies(T.dealId as never)) as { tenancies: Array<{ updatedAt: Date }> };
    expect(lets.tenancies.length).toBeGreaterThan(0);
    for (const t of lets.tenancies) expect(t.updatedAt).toBeInstanceOf(Date);
  });

  it('advancing a milestone moves the stamp, so a drawer left open cannot undo it', async () => {
    // advanceMilestone writes progress, status, agreedValue and reservedAt
    // without a stamp of its own — one button, one field each. An edit built on
    // the pre-advance copy would put every one of them back.
    const made = (await caller().sales.upsertUnit(plot({ name: 'Plot 15' }) as never)) as { id: string; updatedAt: Date };
    const before = made.updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    await caller().sales.advanceMilestone(made.id as never);

    await expect(
      caller().sales.upsertUnit(plot({ id: made.id, name: 'Plot 15', expectedUpdatedAt: before }) as never),
    ).rejects.toThrow(/after you opened it/);

    const row = await rowOf(made.id);
    expect(row.progress).toBe(1);
    expect(row.status).toBe('RESERVED');
  });
});
