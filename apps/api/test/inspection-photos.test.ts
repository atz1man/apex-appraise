import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * An inspection names the photographs this server holds, and no others.
 *
 * The field app's shutter did `photos + 1`. The viewfinder was a static gradient
 * labelled "CAPTURING · KITCHEN", the thumbnails were decorative gradients from
 * the design tokens, and the inspection reached the workbench reporting "12
 * photos" of a property nobody had photographed — on the record `audit.ts` names
 * a lender's credit committee and an RICS review as the readers of. The upload
 * route it needed already existed and was already tenant-checked and audited
 * (`POST /uploads/photo` → `SitePhoto`); the field app was the one surface in the
 * product that never called it.
 *
 * `Inspection.rooms`' own schema comment has said `{name, condition, photos[],
 * notes}` since the model was written, so the data model always meant the list.
 * Making it a list is only half the fix: a list the server does not CHECK is a
 * nicer-looking tally, so every id is verified against `SitePhoto` on this deal
 * and this org, and a save naming one that is not there is refused whole.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const photoOn = async (dealId: string, orgId: string, caption: string) =>
  prisma.sitePhoto.create({
    data: { orgId, dealId, caption, url: `/uploads/files/${caption}.jpg`, takenAt: new Date(), weekCommencing: new Date() },
  });

const room = (name: string, photos: string[] = []) => ({ name, condition: 3, photos, notes: '' });

const save = (rooms: ReturnType<typeof room>[], extra: Record<string, unknown> = {}) =>
  caller().inspections.save({
    dealId: T.dealId,
    rooms,
    reconciledValue: 450_000,
    approachWeights: { salesComparison: 60, cost: 20, income: 20 },
    status: 'draft',
    ...extra,
  } as never) as Promise<{ id: string; rooms: Array<{ name: string; photos: string[] }>; updatedAt: Date }>;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('InspPhotos');
}, 120_000);

describe('the photographs an inspection carries', () => {
  it('records the ids of photographs that exist', async () => {
    const a = await photoOn(T.dealId, T.orgId, 'kitchen-1');
    const b = await photoOn(T.dealId, T.orgId, 'kitchen-2');
    const saved = await save([room('Kitchen', [a.id, b.id]), room('Exterior')]);
    expect(saved.rooms[0]!.photos).toEqual([a.id, b.id]);
    expect(saved.rooms[1]!.photos, 'a room nobody photographed carries an empty list').toEqual([]);
  });

  /**
   * The whole reason the list is verified. Without this a client could send any
   * ids it liked and the inspection would claim photographs that are not there —
   * the same defect the counter was, wearing a list.
   */
  it('refuses a photograph it does not hold, and saves nothing', async () => {
    const before = await prisma.inspection.findFirstOrThrow({ where: { dealId: T.dealId } });
    await expect(
      save([room('Kitchen', ['sitephoto-that-never-existed'])], { id: before.id, expectedUpdatedAt: before.updatedAt }),
    ).rejects.toThrow(/could not be found on this deal/i);
    const after = await prisma.inspection.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.rooms, 'the inspection was written despite the refusal').toBe(before.rooms);
  });

  /**
   * It refuses rather than dropping the unknown ids. A save that quietly filed
   * eight of the twelve photographs a surveyor took would be the quietest
   * possible way to lose evidence — and the surveyor would have no reason to look.
   */
  it('refuses the whole save, not just the missing one', async () => {
    const good = await photoOn(T.dealId, T.orgId, 'bathroom-1');
    const row = await prisma.inspection.findFirstOrThrow({ where: { dealId: T.dealId } });
    await expect(
      save([room('Bathroom', [good.id, 'missing-one'])], { id: row.id, expectedUpdatedAt: row.updatedAt }),
    ).rejects.toThrow(/1 photograph/);
    const after = await prisma.inspection.findUniqueOrThrow({ where: { id: row.id } });
    expect(JSON.parse(after.rooms).some((r: any) => r.name === 'Bathroom')).toBe(false);
  });

  /**
   * A photograph of ANOTHER deal is refused too. The deal and the photograph are
   * two independent inputs — `auth/owned.ts` — and a kitchen from a different
   * scheme standing in a valuation record is worse than a missing one.
   */
  it('refuses a photograph that belongs to another deal of the same firm', async () => {
    const other = await caller().deals.create({
      name: 'Other scheme', address: '2 Elsewhere', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL',
    } as never) as { id: string };
    const theirs = await photoOn(other.id, T.orgId, 'other-deal-1');
    const row = await prisma.inspection.findFirstOrThrow({ where: { dealId: T.dealId } });
    await expect(
      save([room('Kitchen', [theirs.id])], { id: row.id, expectedUpdatedAt: row.updatedAt }),
    ).rejects.toThrow(/could not be found on this deal/i);
  });

  it('refuses another firm’s photograph', async () => {
    const other = await makeTenant('InspPhotosOther');
    const theirs = await photoOn(other.dealId, other.orgId, 'their-kitchen');
    const row = await prisma.inspection.findFirstOrThrow({ where: { dealId: T.dealId } });
    await expect(
      save([room('Kitchen', [theirs.id])], { id: row.id, expectedUpdatedAt: row.updatedAt }),
    ).rejects.toThrow(/could not be found on this deal/i);
  });

  /** What it claims to have seen is part of the trail, so the count is in it. */
  it('records how many photographs the inspection names', async () => {
    const c = await photoOn(T.dealId, T.orgId, 'loft-1');
    const row = await prisma.inspection.findFirstOrThrow({ where: { dealId: T.dealId } });
    await save([room('Loft', [c.id])], { id: row.id, expectedUpdatedAt: row.updatedAt });
    const events = await prisma.activityEvent.findMany({
      where: { dealId: T.dealId, action: { contains: 'inspection' } },
      orderBy: { at: 'desc' },
      take: 1,
    });
    expect(events[0]!.target).toMatch(/1 photograph\b/);
  });
});

/**
 * Rows written before the photographs were real carry `photos: 12` — a number.
 * It reads as an empty list, which loses nothing: the count was of photographs
 * that were never taken, so there is no id for one to point at. What matters is
 * that opening such an inspection does not throw.
 */
describe('an inspection saved by the old build', () => {
  it('opens, with no photographs rather than an error', async () => {
    const t = await makeTenant('InspLegacy');
    const row = await prisma.inspection.create({
      data: {
        orgId: t.orgId,
        dealId: t.dealId,
        rooms: JSON.stringify([{ name: 'Kitchen', condition: 4, photos: 12, notes: 'as found' }]),
        approachWeights: JSON.stringify({ salesComparison: 60, cost: 20, income: 20 }),
        status: 'submitted',
        inspectedAt: new Date(),
      },
    });
    const got = (await callerFor(t.principal).inspections.get(t.dealId as never)) as {
      rooms: Array<{ name: string; photos: string[]; notes: string }>;
    };
    expect(got.rooms[0]!.photos, 'a count of photographs nobody took is no photographs').toEqual([]);
    expect(got.rooms[0]!.notes, 'the notes a surveyor actually wrote are untouched').toBe('as found');
    expect(row.id).toBeTruthy();
  });
});
