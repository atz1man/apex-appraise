import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';
import { anonymous, callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The contractor register: putting a subcontractor on the record at all.
 *
 * The cost monitor has always rendered contractors — cards with contract value,
 * retention, certificates and a weekly timesheet — and every package row has a
 * dropdown to assign one. Nothing could create one: outside the demo seed and
 * the sample-data generator, the only writer was `logTimesheetWeek`, which
 * needs a row to exist first. A real workspace read "No contractors in your
 * organisation yet" with no way past it, and the dropdown on every package was
 * permanently empty.
 */

let A: Tenant;
let B: Tenant;

const analyst = (t: Tenant) => callerFor({ ...t.principal, role: 'ANALYST' });
const viewer = (t: Tenant) => callerFor({ ...t.principal, role: 'VIEWER' });

const creatorsOf = (model: string) =>
  Object.entries((appRouter as unknown as { _def: { procedures: Record<string, { _def: { resolver?: unknown } }> } })._def.procedures)
    .filter(([, p]) => new RegExp(`prisma\\.${model}\\.create\\(`).test(String(p._def.resolver ?? '')))
    .map(([path]) => path)
    .sort();

type Row = {
  id: string; name: string; trade: string; timesheetRate: number | null; operatives: number | null;
  weeks: number[]; contractValue: number; retention: number; certificates: number;
};

let contractorId: string;
let packageId: string;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Site');
  B = await makeTenant('Rival');
}, 120_000);

describe('the defect, measured', () => {
  it('a fresh workspace has no contractor and nothing but this register can add one', async () => {
    expect(await analyst(A).cost.contractors()).toEqual([]);
    // the one-click sample deal plants a contractor of its own; the register is
    // the only way a firm records a real one
    expect(creatorsOf('contractor')).toEqual(['cost.createContractor', 'org.loadSampleDeal']);
  });
});

describe('from nothing to a contractor on a package', () => {
  it('creates one, with the day rate in pounds on the way out', async () => {
    const c = (await analyst(A).cost.createContractor({
      name: 'Kingsmead Plant Ltd', trade: 'Groundworks', timesheetRate: 340, operatives: 6,
    })) as Row;
    contractorId = c.id;
    // £340/day is 34000 on the row; the sweep for money-out would catch a bigint,
    // but a number in pence would pass it and be wrong by a hundred
    expect(c.timesheetRate).toBe(340);
    expect(c.weeks).toEqual([]);
    expect(c.contractValue).toBe(0);
    expect(c.retention).toBe(0);
    expect(c.certificates).toBe(0);

    const list = (await analyst(A).cost.contractors()) as Row[];
    expect(list.map((r) => r.id)).toEqual([contractorId]);
  });

  it('is assignable to a package, and the engine’s totals follow', async () => {
    const pk = (await analyst(A).cost.upsertPackage({
      dealId: A.dealId, name: 'Substructure', budget: 300_000, forecast: 300_000, committed: 250_000, contractorId,
    } as never)) as { id: string };
    packageId = pk.id;
    const [c] = (await analyst(A).cost.contractors()) as Row[];
    expect(c!.contractValue).toBe(250_000);
    // nothing certified yet, so nothing withheld
    expect(c!.retention).toBe(0);
  });

  it('and the timesheet that needed a row to exist now has one', async () => {
    const r = (await analyst(A).cost.logTimesheetWeek({ contractorId, hours: 42 })) as { weeks: number[]; timesheetRate: number | null };
    expect(r.weeks).toEqual([42]);
    expect(r.timesheetRate).toBe(340);
  });
});

describe('an update is a patch', () => {
  it('writes only the keys it was sent', async () => {
    const r = (await analyst(A).cost.updateContractor({ id: contractorId, patch: { timesheetRate: 360 } })) as Row;
    expect(r.timesheetRate).toBe(360);
    expect(r.name).toBe('Kingsmead Plant Ltd');
    expect(r.operatives).toBe(6);
    // totals come back on the write too, so a screen need not refetch to keep them
    expect(r.contractValue).toBe(250_000);
    const row = await prisma.contractor.findUniqueOrThrow({ where: { id: contractorId } });
    expect(row.timesheetRate).toBe(36_000n);
    expect(row.weeks).toBe('[42]');
  });

  it('can clear the day rate rather than only change it', async () => {
    const r = (await analyst(A).cost.updateContractor({ id: contractorId, patch: { timesheetRate: null } })) as Row;
    expect(r.timesheetRate).toBeNull();
    await analyst(A).cost.updateContractor({ id: contractorId, patch: { timesheetRate: 340 } });
  });
});

describe('removal', () => {
  it('is refused while a package holds money against them', async () => {
    await expect(analyst(A).cost.deleteContractor({ id: contractorId })).rejects.toThrow(/Substructure.*committed or certified/);
    expect(await prisma.contractor.findUnique({ where: { id: contractorId } })).not.toBeNull();
  });

  it('detaches an empty package and a site photo rather than refusing on them', async () => {
    await analyst(A).cost.upsertPackage({ id: packageId, dealId: A.dealId, committed: 0 } as never);
    await analyst(A).photos.add({ dealId: A.dealId, caption: 'Slab pour', contractorId, takenAt: '2026-06-30' });

    const res = await analyst(A).cost.deleteContractor({ id: contractorId });
    expect(res).toEqual({ ok: true, detachedPackages: 1, detachedPhotos: 1 });
    expect(await prisma.contractor.findUnique({ where: { id: contractorId } })).toBeNull();
    // the package and the photograph survive the firm that did the work
    expect((await prisma.costPackage.findUniqueOrThrow({ where: { id: packageId } })).contractorId).toBeNull();
    const photos = await prisma.sitePhoto.findMany({ where: { dealId: A.dealId } });
    expect(photos).toHaveLength(1);
    expect(photos[0]!.contractorId).toBeNull();
  });
});

describe('ownership', () => {
  let bContractor: string;
  beforeAll(async () => {
    bContractor = (await analyst(B).cost.createContractor({ name: 'Rival Build', trade: 'Frame' }) as Row).id;
  });

  it('refuses another firm’s contractor at every door, and leaves it as it was', async () => {
    const before = JSON.stringify(await prisma.contractor.findMany({ where: { orgId: B.orgId } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    await expectDenied('update', () => analyst(A).cost.updateContractor({ id: bContractor, patch: { name: 'Taken' } }));
    await expectDenied('delete', () => analyst(A).cost.deleteContractor({ id: bContractor }));
    await expectDenied('timesheet', () => analyst(A).cost.logTimesheetWeek({ contractorId: bContractor, hours: 1 }));
    const after = JSON.stringify(await prisma.contractor.findMany({ where: { orgId: B.orgId } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(after).toBe(before);
    expect(((await analyst(A).cost.contractors()) as Row[]).map((c) => c.name)).not.toContain('Rival Build');
  });

  it('a view-only member and an outsider are refused', async () => {
    await expectDenied('viewer creating', () => viewer(A).cost.createContractor({ name: 'Viewer Ltd', trade: 'x' }));
    await expectDenied('anonymous creating', () => anonymous().cost.createContractor({ name: 'Nobody Ltd', trade: 'x' }));
  });
});

describe('provenance', () => {
  it('every write left an event naming who did it', async () => {
    const events = await prisma.activityEvent.findMany({ where: { orgId: A.orgId } });
    const actions = events.map((e) => e.action);
    for (const expected of ['added a contractor', 'updated contractor — day rate', 'removed a contractor']) {
      expect(actions, `no event for "${expected}"`).toContain(expected);
    }
    const gone = events.find((e) => e.action === 'removed a contractor')!;
    expect(gone.actor).toBe(A.principal.name);
    expect(gone.target).toMatch(/Kingsmead Plant Ltd.*1 package detached/);
  });
});
