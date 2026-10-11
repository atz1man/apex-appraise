import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

let tenant: Tenant;
beforeAll(async () => { resetDatabase(); tenant = await makeTenant('EvidenceEntry'); });
const input = () => ({ dealId: tenant.dealId, address: '12 Recorded Road', basePsf: 220, meta: 'Recorded sale evidence' });

describe('recording comparable evidence', () => {
  it('accepts a recorded positive rate and trims the entered address', async () => {
    const row = await callerFor(tenant.principal).comparables.upsert({ ...input(), address: ' 12 Recorded Road ' });
    expect(row).toMatchObject({ address: '12 Recorded Road', basePsf: 220, meta: 'Recorded sale evidence' });
    expect(await prisma.activityEvent.count({ where: { dealId: tenant.dealId, action: 'added a comparable' } })).toBe(1);
  });

  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`refuses ${String(rate)} instead of letting it contribute to a valuation`, async () => {
      const count = await prisma.comparable.count({ where: { dealId: tenant.dealId } });
      await expect(callerFor(tenant.principal).comparables.upsert({ ...input(), basePsf: rate })).rejects.toThrow();
      expect(await prisma.comparable.count({ where: { dealId: tenant.dealId } })).toBe(count);
    });
  }

  it('refuses an address containing only spaces', async () => {
    await expect(callerFor(tenant.principal).comparables.upsert({ ...input(), address: '   ' })).rejects.toThrow();
  });

  it('does not allow a patch to replace an existing evidence rate with zero', async () => {
    const row = await prisma.comparable.findFirstOrThrow({ where: { dealId: tenant.dealId } });
    await expect(callerFor(tenant.principal).comparables.upsert({ id: row.id, dealId: tenant.dealId, basePsf: 0 })).rejects.toThrow();
    expect((await prisma.comparable.findUniqueOrThrow({ where: { id: row.id } })).basePsf).toBe(220);
  });
});
