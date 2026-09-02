import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * When each deal was last worked — `deals.list` answers it so the home screen
 * can say which deal the firm is ON (`web/src/lib/working-deal.ts`).
 *
 * The three screens that needed the answer had the demo scheme's name spelled
 * into them, with "the highest probability" as the fallback — where every
 * finished scheme sits at 100. A row's `updatedAt` is not the answer either:
 * terms saved or a document filed on a deal never touch the deal row. The
 * audit trail is, because the mutations that matter write an event carrying
 * the deal id.
 */
let T: Tenant;
let other: Tenant;
type Listed = { id: string; lastWorkedAt: Date };

const terms = () => ({
  clientName: 'Worked Estates Ltd', clientAddress: '1 Client Road, London', otherUsers: 'None', purpose: 'Secured lending',
  interest: 'Freehold', basisOfValue: 'Market Value', valuationDate: '2026-06-30', extentOfInvestigation: 'Desktop with site inspection',
  sourcesOfInformation: 'Client-supplied plans', assumptions: 'Standard RICS assumptions apply.', specialAssumptions: 'None.',
  reportFormat: 'Red Book Global', restrictionsOnUse: 'For the addressee only.', feeBasis: 'Fixed fee', liabilityCap: 250_000,
  complaintsProcedure: 'Available on request.', aiUse: 'Used for extraction only.', valuerName: 'A Valuer MRICS', valuerReg: '1234567',
});

const listed = async (dealId: string) => {
  const { deals } = (await callerFor(T.principal).deals.list({})) as { deals: Listed[] };
  return deals.find((d) => d.id === dealId)!;
};

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Worked');
  other = await makeTenant('Elsewhere');
}, 60_000);

describe('deals.list · lastWorkedAt', () => {
  it('is the row’s own stamp for a deal nothing has happened to', async () => {
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });
    const d = await listed(T.dealId);
    expect(d.lastWorkedAt).toBeInstanceOf(Date);
    expect(d.lastWorkedAt.getTime()).toBe(row.updatedAt.getTime());
  });

  it('is never pulled backwards by an event older than the row’s own stamp', async () => {
    const fresh = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Worked Older', address: '3 Worked Road', assetType: 'RESIDENTIAL', stage: 'SOURCING' },
    });
    await prisma.activityEvent.create({
      data: { orgId: T.orgId, dealId: fresh.id, actor: 'x', action: 'filed', target: 'd', at: new Date(fresh.updatedAt.getTime() - 3_600_000) },
    });
    expect((await listed(fresh.id)).lastWorkedAt.getTime()).toBe(fresh.updatedAt.getTime());
  });

  it('moves to the latest audit event on the deal — terms of engagement saved on it, which never touch the row', async () => {
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });
    await callerFor(T.principal).engagement.save({ dealId: T.dealId, terms: terms() } as never);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });
    expect(after.updatedAt.getTime(), 'the deal row itself is untouched by saving terms').toBe(before.updatedAt.getTime());
    const ev = await prisma.activityEvent.findFirstOrThrow({ where: { orgId: T.orgId, dealId: T.dealId }, orderBy: { at: 'desc' } });
    expect(ev.at.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    const d = await listed(T.dealId);
    expect(d.lastWorkedAt.getTime()).toBe(ev.at.getTime());
  });

  it('is the LATEST event, per deal — a later event on a neighbour moves the neighbour only', async () => {
    const hour = 3_600_000;
    const at1 = new Date(Date.now() + 1 * hour);
    const at3 = new Date(Date.now() + 3 * hour);
    const neighbour = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Worked Neighbour', address: '2 Worked Road', assetType: 'RESIDENTIAL', stage: 'OFFER' },
    });
    await prisma.activityEvent.create({ data: { orgId: T.orgId, dealId: T.dealId, actor: 'x', action: 'filed', target: 'a', at: at1 } });
    await prisma.activityEvent.create({ data: { orgId: T.orgId, dealId: neighbour.id, actor: 'x', action: 'filed', target: 'b', at: at3 } });
    expect((await listed(T.dealId)).lastWorkedAt.getTime()).toBe(at1.getTime());
    expect((await listed(neighbour.id)).lastWorkedAt.getTime()).toBe(at3.getTime());
  });

  it('counts only the firm’s own events — another firm’s event naming this deal is not evidence', async () => {
    const own = (await listed(T.dealId)).lastWorkedAt;
    await prisma.activityEvent.create({
      data: { orgId: other.orgId, dealId: T.dealId, actor: 'x', action: 'filed', target: 'c', at: new Date(own.getTime() + 3_600_000) },
    });
    expect((await listed(T.dealId)).lastWorkedAt.getTime()).toBe(own.getTime());
  });
});
