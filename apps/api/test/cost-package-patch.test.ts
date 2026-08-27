import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Choosing a contractor, and the four money figures that used to go with it.
 *
 * `cost.upsertPackage` took the WHOLE row — name, budget, committed, spent,
 * forecast, progress, contractor — and the cost monitor has exactly one call
 * site for it: the contractor dropdown, rendered on every package row. So
 * picking a groundworker posted back four money figures from whatever copy the
 * browser was holding.
 *
 * This firm is not the only writer. `syncXero` updates `committed` and `spent`
 * on `source: 'xero'` packages from the customer's accounting ledger, and the
 * dropdown is rendered on those rows too. A sync landing between the page
 * loading and somebody choosing a contractor therefore reverted it — and
 * `a68f459` made this screen's variance real, so the reverted figure is the one
 * a lender pack reports.
 *
 * The siblings in this class (appraisal, inspections, sales, engagement, firm
 * policy) got an optimistic stamp. This one gets patch semantics, which is the
 * better answer where it applies: a stamp DETECTS the clobber and asks the user
 * to reload; not sending the fields means there is nothing to clobber.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);
const row = () => prisma.costPackage.findFirstOrThrow({ where: { dealId: T.dealId } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Cost');
  await caller().cost.upsertPackage({
    dealId: T.dealId,
    name: 'Substructure',
    budget: 400_000,
    committed: 100_000,
    spent: 50_000,
    forecast: 410_000,
    progressPct: 20,
  } as never);
}, 180_000);

describe('assigning a contractor', () => {
  it('leaves the figures the accounting feed brought in exactly where they were', async () => {
    const pkg = await row();
    const contractor = await prisma.contractor.create({
      data: { orgId: T.orgId, name: 'Deep Foundations Ltd', trade: 'Groundworks', weeks: '[]' },
    });

    // the ledger sync moves committed and spent, as syncXero does
    await prisma.costPackage.update({
      where: { id: pkg.id },
      data: { committed: 380_000_00n, spent: 310_000_00n },
    });

    // the browser is still holding the figures from before that, and sends only
    // what the user actually changed
    await caller().cost.upsertPackage({ id: pkg.id, dealId: T.dealId, contractorId: contractor.id } as never);

    const after = await row();
    expect(Number(after.committed), 'the synced committed figure was reverted').toBe(380_000_00);
    expect(Number(after.spent), 'the synced spent figure was reverted').toBe(310_000_00);
    expect(after.contractorId, 'the change the user actually made did not land').toBe(contractor.id);
    // and nothing else moved
    expect(Number(after.budget)).toBe(400_000_00);
    expect(after.progressPct).toBe(20);
  });

  it('still writes a figure when a figure is what was sent', async () => {
    const pkg = await row();
    await caller().cost.upsertPackage({ id: pkg.id, dealId: T.dealId, forecast: 455_000 } as never);
    const after = await row();
    expect(Number(after.forecast)).toBe(455_000_00);
    expect(Number(after.committed), 'a targeted write moved something it was not given').toBe(380_000_00);
  });

  it('refuses to create a package with no budget or forecast, rather than booking a £0 line', async () => {
    /**
     * The figures are optional so an UPDATE can be partial. Creating is the
     * other case: defaulting a missing budget to zero would put a £0 line into
     * the variance the cost report is built from, which reads as a package
     * miraculously on budget.
     */
    await expect(caller().cost.upsertPackage({ dealId: T.dealId, name: 'Roofing' } as never)).rejects.toThrow(/needs a name, a budget and a forecast/i);
    await expect(
      caller().cost.upsertPackage({ dealId: T.dealId, name: 'Roofing', budget: 90_000, forecast: 95_000 } as never),
    ).resolves.toBeTruthy();
  });

  it('records what it actually wrote, not what the caller happened to send', async () => {
    const pkg = await row();
    await caller().cost.upsertPackage({ id: pkg.id, dealId: T.dealId, progressPct: 55 } as never);
    const events = await prisma.activityEvent.findMany({ where: { orgId: T.orgId, action: 'updated cost package' } });
    const latest = events[events.length - 1]!;
    // the forecast is not in that input at all; the event still names the row's
    expect(latest.target).toContain('£455,000');
  });
});
