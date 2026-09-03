import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Four things this product let a firm create and never take back.
 *
 * Measured across the whole router: five entities had a create-shaped mutation
 * and nothing that removed one — comparables, scenarios, site photos, tasks and
 * deals — while `sales` and `investors` beside them have `deleteUnit`,
 * `deleteTenancy`, `delete`, `removeHolding` and `deleteCashflow`. So deleting
 * properly is the product's own convention and these were omissions, not a
 * stance.
 *
 * The four here are the ones with no cascade to reason about. What made them
 * worth fixing is what the only available alternative WAS in each case: an
 * `upsert` that overwrites the mistake with a different record, or a `toggle`
 * that retires a task by claiming the work happened.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Removals');
}, 180_000);

/**
 * The LATEST event of that action, not the first.
 *
 * `findFirst` without an order returned the earliest matching row, so the second
 * removal in a file was checked against the trail of the first — a test that
 * passes or fails on which case ran before it.
 */
const audit = (dealId: string, action: string) =>
  prisma.activityEvent.findFirst({ where: { orgId: T.orgId, dealId, action }, orderBy: { at: 'desc' } });

describe('a comparable', () => {
  it('can be withdrawn, and the supported rate is recalculated without it', async () => {
    const c = caller();
    // two comps a long way apart, so the supported rate cannot fail to move
    await c.comparables.upsert({ dealId: T.dealId, address: '1 Cheap Street', basePsf: 200 } as never);
    const dear = (await c.comparables.upsert({ dealId: T.dealId, address: '2 Dear Street', basePsf: 600 } as never)) as { id: string };

    const before = (await c.comparables.list(T.dealId as never)) as { comps: unknown[]; summary: { supportedPsf: number } };
    expect(before.comps).toHaveLength(2);

    await c.comparables.remove(dear.id as never);

    const after = (await c.comparables.list(T.dealId as never)) as { comps: unknown[]; summary: { supportedPsf: number } };
    expect(after.comps).toHaveLength(1);
    /*
     * The point of the whole fix. Overwriting the row — the only thing possible
     * before — would have left it weighing on this figure, and this figure is
     * what a Red Book valuation is defended with.
     */
    expect(after.summary.supportedPsf).toBeLessThan(before.summary.supportedPsf);
    expect(after.summary.supportedPsf).toBe(200);
  });

  it('records who withdrew it, and what it was', async () => {
    const c = caller();
    const comp = (await c.comparables.upsert({ dealId: T.dealId, address: '9 Recorded Row', basePsf: 333 } as never)) as { id: string };
    await c.comparables.remove(comp.id as never);
    const e = await audit(T.dealId, 'removed a comparable');
    expect(e, 'a change to the evidence with no trail is the defect the upsert audit exists to prevent').toBeTruthy();
    expect(e!.target).toContain('9 Recorded Row');
    expect(e!.target).toContain('333');
  });

  it('refuses another firm’s comparable with a 404, not a 403', async () => {
    const other = await makeTenant('Other firm');
    const theirs = (await callerFor(other.principal).comparables.upsert({
      dealId: other.dealId,
      address: 'Not yours',
      basePsf: 250,
    } as never)) as { id: string };
    // NOT_FOUND rather than FORBIDDEN: "you may not touch this" confirms it exists
    await expect(caller().comparables.remove(theirs.id as never)).rejects.toThrow(/NOT_FOUND|not found/i);
    expect(await prisma.comparable.findUnique({ where: { id: theirs.id } })).toBeTruthy();
  });
});

describe('a scheme option', () => {
  it('can be taken off the table, and stops being compared', async () => {
    const c = caller();
    const opt = (await c.scenarios.upsert({
      dealId: T.dealId,
      name: 'Option Z — never meant to propose',
      blendedPsf: 240,
      buildPsf: 105,
      gia: 20_000,
      targetProfitPct: 20,
    } as never)) as { id: string };
    expect(((await c.scenarios.list(T.dealId as never)) as unknown[]).length).toBe(1);

    await c.scenarios.remove(opt.id as never);
    expect(((await c.scenarios.list(T.dealId as never)) as unknown[]).length).toBe(0);
    const e = await audit(T.dealId, 'removed a scheme option');
    expect(e!.target).toContain('Option Z');
  });
});

describe('a site photo', () => {
  it('can be taken down, and the audit trail keeps the fact that it was', async () => {
    const c = caller();
    const ph = (await c.photos.add({
      dealId: T.dealId,
      caption: 'Wrong site entirely',
      contractorId: null,
      takenAt: '2026-05-04',
    } as never)) as { id: string };
    expect(((await c.photos.list(T.dealId as never)) as unknown[]).length).toBe(1);

    await c.photos.remove(ph.id as never);
    expect(((await c.photos.list(T.dealId as never)) as unknown[]).length).toBe(0);
    // the row goes and the record that it went stays, which is the whole point
    // of an audit trail on a deletion
    const e = await audit(T.dealId, 'removed a site photo');
    expect(e!.target).toContain('Wrong site entirely');
    expect(e!.target).toContain('2026-05-04');
  });
});

describe('a task', () => {
  it('can be deleted rather than falsely ticked', async () => {
    const c = caller();
    const t = (await c.tasks.create({ dealId: T.dealId, title: 'Raised on the wrong deal', aspect: 'Planning' } as never)) as { id: string };
    await c.tasks.remove(t.id as never);
    expect(((await c.tasks.list({ dealId: T.dealId } as never)) as unknown[]).length).toBe(0);
    const e = await audit(T.dealId, 'deleted a task');
    expect(e!.target).toContain('Raised on the wrong deal');
  });

  it('says so when it was already ticked, because that is a different fact', async () => {
    const c = caller();
    const t = (await c.tasks.create({ dealId: T.dealId, title: 'Done then deleted', aspect: 'Planning' } as never)) as { id: string };
    await c.tasks.toggle(t.id as never);
    await c.tasks.remove(t.id as never);
    const e = await prisma.activityEvent.findFirst({
      where: { orgId: T.orgId, action: 'deleted a task', target: { contains: 'Done then deleted' } },
    });
    expect(e!.target).toContain('was done');
  });
});
