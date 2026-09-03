import { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * An LP's share is ONE figure, on the investor, and every pooled amount they
 * read is scaled by it — the register says so in as many words, and the
 * portal header prints it.
 *
 * `Holding` carried a `sharePct` of its own. Measured through the real
 * procedures: `setHolding({ sharePct: 20 })` wrote 20 to the row and recorded
 * "updated holding — share", and the position still scaled the holding by the
 * investor's 55% (£550,000 of £1,000,000 committed); `investors.update({
 * sharePct: 40 })` then moved every figure the LP reads to 40% while the row
 * still said 20. A column nothing read, an input that changed nothing, an
 * audit line for a change nobody could see. The column is dropped; the share
 * is the investor's and nowhere else.
 */
let T: Tenant;
type Position = { committed: number; called: number };

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Share');
}, 60_000);

describe('an LP’s share', () => {
  it('is not a field a holding has — in the schema, on the wire, or as an input', async () => {
    const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Holding')!.fields.map((f) => f.name);
    expect(fields).not.toContain('sharePct');
    expect(Prisma.dmmf.datamodel.models.find((m) => m.name === 'Investor')!.fields.map((f) => f.name)).toContain('sharePct');

    const c = callerFor(T.principal);
    const inv = (await c.investors.create({ name: 'Alpha Capital LP', sharePct: 55 })) as { id: string };
    const h = (await c.investors.setHolding({ investorId: inv.id, dealId: T.dealId, committed: 1_000_000, called: 500_000 })) as Record<string, unknown>;
    expect(h).not.toHaveProperty('sharePct');

    // a share sent with the holding is not an input: it changes nothing an LP reads and earns no audit line
    const before = await prisma.activityEvent.count({ where: { orgId: T.orgId } });
    await c.investors.setHolding({ investorId: inv.id, dealId: T.dealId, sharePct: 20 } as never);
    expect(await prisma.activityEvent.count({ where: { orgId: T.orgId } }), 'no audit line for a change nobody can see').toBe(before);
    const p = (await c.investors.get(inv.id)) as { position: Position; holdings: Array<Record<string, unknown>> };
    expect(p.holdings[0]).not.toHaveProperty('sharePct');
    expect(p.position.committed).toBe(550_000);
    expect(p.position.called).toBe(275_000);
  });

  it('is the investor’s, so editing it moves every figure the LP reads and leaves nothing stale', async () => {
    const c = callerFor(T.principal);
    const inv = (await c.investors.list() as Array<{ id: string; name: string }>).find((i) => i.name === 'Alpha Capital LP')!;
    await c.investors.update({ id: inv.id, patch: { sharePct: 40 } });
    const p = (await c.investors.get(inv.id)) as { position: Position };
    expect(p.position.committed).toBe(400_000);
    expect(p.position.called).toBe(200_000);
    const row = (await c.investors.list() as Array<{ id: string; committed: number; called: number }>).find((i) => i.id === inv.id)!;
    expect(row).toMatchObject({ committed: 400_000, called: 200_000 });
    const lp = (await callerFor({ ...T.investorPrincipal, investorId: inv.id }).investors.myPosition()) as { position: Position };
    expect(lp.position.committed).toBe(400_000);
  });
});
