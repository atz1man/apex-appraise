import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Two valuers adjusting one deal's evidence.
 *
 * Both screens persist on blur and used to send the WHOLE row, so moving one
 * column wrote every other from the copy the page was holding. Ten seats and
 * "one connected workfile" is what this product sells, so two people on one
 * deal is the case it is for, not an edge.
 *
 * The comparables matter most: an adjustment is a judgement a Red Book
 * valuation is defended with, and `applyToAppraisal` writes the supported £/ft²
 * these produce onto every unit cap of the appraisal.
 *
 * Patch rather than a stamp, as in `7dd1415` — two people adjusting DIFFERENT
 * columns should both land, and only the same column is last-write-wins.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Evidence');
}, 180_000);

describe('a comparable adjusted by two people', () => {
  it('keeps both adjustments, instead of the second blur reverting the first', async () => {
    const comp = (await caller().comparables.upsert({
      dealId: T.dealId,
      address: '4 Evidence Row',
      meta: 'Sold Jan',
      basePsf: 500,
      adjSize: 0,
      adjCondition: 0,
      adjDate: 0,
      adjLocation: 0,
    } as never)) as { id: string };

    // the first valuer marks it down for condition
    await caller().comparables.upsert({ id: comp.id, dealId: T.dealId, adjCondition: -7.5 } as never);

    // the second, whose page loaded before that, marks it up for date
    await caller().comparables.upsert({ id: comp.id, dealId: T.dealId, adjDate: 3 } as never);

    const row = await prisma.comparable.findUniqueOrThrow({ where: { id: comp.id } });
    expect(row.adjCondition, 'the first valuer’s condition adjustment was reverted').toBe(-7.5);
    expect(row.adjDate).toBe(3);
    // and nothing they did not touch moved
    expect(row.basePsf).toBe(500);
    expect(row.address).toBe('4 Evidence Row');
    expect(row.meta).toBe('Sold Jan');
  });

  it('records the adjustments the ROW now carries, not the one field it was sent', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: 'edited a comparable' },
      orderBy: { at: 'asc' },
    });
    const latest = events[events.length - 1]!;
    // the input carried only adjDate; the trail still shows the whole picture
    expect(latest.target).toContain('-7.5%');
    expect(latest.target).toContain('+3%');
    expect(latest.target, 'the base £/ft² came from the input, which no longer carries it').toContain('£500');
  });

  it('refuses to create one with no address or base rate', async () => {
    await expect(caller().comparables.upsert({ dealId: T.dealId, meta: 'orphan' } as never)).rejects.toThrow(
      /needs an address and a base/i,
    );
  });
});

describe('a scheme option with two levers moved', () => {
  it('keeps both, and records what the option now says', async () => {
    const opt = (await caller().scenarios.upsert({
      dealId: T.dealId,
      name: 'Option A',
      descriptor: 'Base',
      blendedPsf: 220,
      buildPsf: 105,
      gia: 24_000,
      targetProfitPct: 20,
    } as never)) as { id: string };

    await caller().scenarios.upsert({ id: opt.id, dealId: T.dealId, buildPsf: 118 } as never);
    await caller().scenarios.upsert({ id: opt.id, dealId: T.dealId, blendedPsf: 240 } as never);

    const row = await prisma.scenario.findUniqueOrThrow({ where: { id: opt.id } });
    expect(row.buildPsf, 'the first lever was reverted').toBe(118);
    expect(row.blendedPsf).toBe(240);
    expect(row.gia).toBe(24_000);
    expect(row.name).toBe('Option A');

    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: 'edited a scheme option' },
      orderBy: { at: 'asc' },
    });
    expect(events[events.length - 1]!.target).toContain('£118/ft² build');
  });

  it('refuses to create one without its levers', async () => {
    await expect(caller().scenarios.upsert({ dealId: T.dealId, name: 'Half an option' } as never)).rejects.toThrow(
      /needs a name and all four levers/i,
    );
  });
});
