import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';
import type { Principal } from '../src/context.js';
import { anonymous, callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The investor register: putting an LP on the record at all.
 *
 * The portal has worked for a long time — an LP's position, the cashflow list,
 * the capital-call panel, and `portalAccess.inviteInvestor` to issue the login.
 * What did not exist was any way to CREATE an investor, a holding or a cashflow
 * line: outside the demo seed, nothing wrote those three tables. So on a real
 * workspace the Portal access picker was empty and "Buyer + investor portals",
 * a Growth line on the pricing page, could not be given to a single person.
 *
 * The first test below is the measurement: a fresh tenant has nobody to invite,
 * and a walk of every resolver in the router finds exactly one that can change
 * that. The rest drive a workspace from nothing to an LP reading their own
 * figures, without the seed.
 */

let A: Tenant;
let B: Tenant;

const analyst = (t: Tenant) => callerFor({ ...t.principal, role: 'ANALYST' });
const admin = (t: Tenant) => callerFor({ ...t.principal, role: 'ADMIN' });
const viewer = (t: Tenant) => callerFor({ ...t.principal, role: 'VIEWER' });

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

/** the principal the invited person signs in as */
const principalFor = async (email: string): Promise<Principal> => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return {
    userId: u.id, orgId: u.orgId, principalType: u.principalType as Principal['principalType'], role: u.role,
    name: u.name, initials: u.initials, investorId: u.investorId, buyerUnitId: u.buyerUnitId,
  };
};

type Position = {
  position: { committed: number; called: number; distributed: number; portfolioIrr: number | null; dpi: number | null };
  holdings: Array<{ dealName: string; committed: number; irr: number | null }>;
  cashflows: Array<{ kind: string; label: string; amount: number }>;
  openCapitalCall: { deal: string | null; label: string; amount: number; due: Date } | null;
};

/** every procedure whose resolver writes a create on the named model */
const creatorsOf = (model: string) =>
  Object.entries((appRouter as unknown as { _def: { procedures: Record<string, { _def: { resolver?: unknown } }> } })._def.procedures)
    .filter(([, p]) => new RegExp(`prisma\\.${model}\\.create\\(`).test(String(p._def.resolver ?? '')))
    .map(([path]) => path)
    .sort();

let investorId: string;
let secondDeal: string;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Fund');
  B = await makeTenant('Rival');
  await prisma.organisation.updateMany({ data: { plan: 'ENTERPRISE' } });
  secondDeal = (
    await prisma.deal.create({
      data: { orgId: A.orgId, name: 'Fund Quay', address: '2 Fund Road', assetType: 'RESIDENTIAL', stage: 'CONSTRUCTION' },
    })
  ).id;
}, 120_000);

describe('the defect, measured', () => {
  it('a fresh workspace has nobody to invite', async () => {
    const c = (await admin(A).portalAccess.candidates()) as { investors: unknown[] };
    expect(c.investors).toEqual([]);
    expect(await analyst(A).investors.list()).toEqual([]);
  });

  it('exactly one procedure can put an investor on the record, and one a holding, and one a statement line', () => {
    // the register IS the writer. Before it, each of these lists was empty and
    // the only creator anywhere was the demo seed.
    expect(creatorsOf('investor')).toEqual(['investors.create']);
    expect(creatorsOf('holding')).toEqual(['investors.setHolding']);
    expect(creatorsOf('cashflow')).toEqual(['investors.recordCashflow']);
  });
});

describe('from nothing to an LP reading their own position, without the seed', () => {
  it('records the investor, their holding and two statement lines', async () => {
    const inv = (await analyst(A).investors.create({ name: 'Meridian Capital LP', contactFirst: 'Lena', sharePct: 55 })) as {
      id: string; initials: string; sharePct: number;
    };
    investorId = inv.id;
    expect(inv.initials).toBe('MC');
    expect(inv.sharePct).toBe(55);

    const h = (await analyst(A).investors.setHolding({
      investorId, dealId: A.dealId, committed: 2_000_000, called: 1_000_000, distributed: 300_000,
    })) as { committed: number; called: number; irr: number | null };
    // pounds out, whatever the row holds
    expect(h.committed).toBe(2_000_000);
    expect(h.called).toBe(1_000_000);
    // no IRR was recorded, so none is claimed
    expect(h.irr).toBeNull();
    // the share is the investor's — a holding carries none of its own
    expect(h).not.toHaveProperty('sharePct');

    await analyst(A).investors.recordCashflow({
      investorId, dealId: A.dealId, kind: 'dist', label: 'Profit distribution', amount: 300_000, date: inDays(-10),
    });
    const call = (await analyst(A).investors.recordCashflow({
      investorId, dealId: A.dealId, kind: 'call', label: 'Capital call — drawdown 2', amount: 500_000, date: inDays(30),
    })) as { amount: number };
    // held with the LP's sign: a call is money going out
    expect(call.amount).toBe(-500_000);
  });

  it('is now somebody the portal can be given to, and they read their own figures', async () => {
    const c = (await admin(A).portalAccess.candidates()) as { investors: Array<{ id: string; name: string }> };
    expect(c.investors.map((i) => i.id)).toContain(investorId);

    await admin(A).portalAccess.inviteInvestor({ investorId, name: 'Lena Fischer', email: 'lena@meridian.test' } as never);
    const p = (await callerFor(await principalFor('lena@meridian.test')).investors.myPosition()) as Position;

    // scaled to 55%, to the penny
    expect(p.position.committed).toBe(1_100_000);
    expect(p.position.called).toBe(550_000);
    expect(p.position.distributed).toBe(165_000);
    expect(p.position.dpi).toBeCloseTo(0.3, 10);
    // nothing recorded, so no portfolio return is claimed
    expect(p.position.portfolioIrr).toBeNull();
    expect(p.holdings[0]!.irr).toBeNull();
    // the history is money that has MOVED: the distribution ten days ago, and not
    // the drawdown notice still ahead of its date, which is the open demand below
    expect(p.cashflows.map((c) => c.label)).toEqual(['Profit distribution']);
    // the drawdown notice still ahead of its date is the open demand, shown positive
    expect(p.openCapitalCall).toMatchObject({ label: 'Capital call — drawdown 2', amount: 275_000 });
  });

  it('shows the firm the same figures the LP reads', async () => {
    const rows = (await analyst(A).investors.list()) as Array<{
      id: string; committed: number; called: number; distributed: number; holdings: number; cashflows: number; logins: number;
    }>;
    const row = rows.find((r) => r.id === investorId)!;
    expect(row).toMatchObject({ committed: 1_100_000, called: 550_000, distributed: 165_000, holdings: 1, cashflows: 2, logins: 1 });
  });
});

describe('the recorded IRR', () => {
  const position = async () => (await callerFor(await principalFor('lena@meridian.test')).investors.myPosition()) as Position;

  it('is sent on its own when the deal closes, and nothing else moves', async () => {
    const before = await prisma.holding.findFirstOrThrow({ where: { investorId, dealId: A.dealId } });
    // a LOSS — the figure the old zero-sentinel column could not carry
    const h = (await analyst(A).investors.setHolding({ investorId, dealId: A.dealId, irr: -0.12 })) as { committed: number; irr: number | null };
    expect(h.irr).toBe(-0.12);
    expect(h.committed).toBe(2_000_000);
    const after = await prisma.holding.findFirstOrThrow({ where: { investorId, dealId: A.dealId } });
    expect(after.committed).toBe(before.committed);
    expect(after.called).toBe(before.called);
    expect(after.distributed).toBe(before.distributed);
    // and the portfolio figure carries the loss rather than hiding it
    expect((await position()).position.portfolioIrr).toBeCloseTo(-0.12, 10);
  });

  it('distinguishes a return of nothing from nothing recorded', async () => {
    await analyst(A).investors.setHolding({ investorId, dealId: A.dealId, irr: 0 });
    // zero is an answer
    expect((await position()).position.portfolioIrr).toBe(0);
    await analyst(A).investors.setHolding({ investorId, dealId: A.dealId, irr: null });
    // null is the absence of one
    expect((await position()).position.portfolioIrr).toBeNull();
  });
});

describe('one position per investor per deal', () => {
  it('setting the holding again changes the row rather than adding a second', async () => {
    await analyst(A).investors.setHolding({ investorId, dealId: A.dealId, committed: 3_000_000 });
    const rows = await prisma.holding.findMany({ where: { investorId, dealId: A.dealId } });
    expect(rows).toHaveLength(1);
    // the LP reads £3m × 55%, not £5m × 55%
    const p = (await callerFor(await principalFor('lena@meridian.test')).investors.myPosition()) as Position;
    expect(p.position.committed).toBe(1_650_000);
  });

  it('the database holds that even if the procedure did not', async () => {
    await expect(
      prisma.holding.create({ data: { investorId, dealId: A.dealId, committed: 1n } }),
    ).rejects.toThrow(/unique/i);
  });

  it('a new holding needs a committed amount', async () => {
    await expect(analyst(A).investors.setHolding({ investorId, dealId: secondDeal, irr: 0.2 })).rejects.toThrow(/committed amount/);
    expect(await prisma.holding.count({ where: { investorId, dealId: secondDeal } })).toBe(0);
  });
});

describe('an update is a patch', () => {
  it('writes only the keys it was sent, and the initials follow the name', async () => {
    await analyst(A).investors.update({ id: investorId, patch: { contactFirst: 'Lena F.' } });
    let row = await prisma.investor.findUniqueOrThrow({ where: { id: investorId } });
    expect(row).toMatchObject({ name: 'Meridian Capital LP', sharePct: 55, contactFirst: 'Lena F.' });

    await analyst(A).investors.update({ id: investorId, patch: { name: 'Meridian Growth LP' } });
    row = await prisma.investor.findUniqueOrThrow({ where: { id: investorId } });
    expect(row.initials).toBe('MG');
    expect(row.sharePct).toBe(55);
  });
});

describe('what cannot be undone is refused', () => {
  it('an investor with money moved cannot be removed, nor their holding', async () => {
    await expect(analyst(A).investors.delete({ id: investorId })).rejects.toThrow(/called or distributed/);
    await expect(analyst(A).investors.removeHolding({ investorId, dealId: A.dealId })).rejects.toThrow(/called or distributed/);
    expect(await prisma.investor.findUnique({ where: { id: investorId } })).not.toBeNull();
    // and the login they were given still works
    expect(await prisma.user.findUnique({ where: { email: 'lena@meridian.test' } })).not.toBeNull();
  });

  it('once the lines are withdrawn and the holding cleared, removal works and takes the login with it', async () => {
    const rec = (await analyst(A).investors.record(investorId)) as { cashflows: Array<{ id: string }> };
    for (const c of rec.cashflows) await analyst(A).investors.deleteCashflow({ cashflowId: c.id });
    await analyst(A).investors.setHolding({ investorId, dealId: A.dealId, called: 0, distributed: 0 });
    await analyst(A).investors.removeHolding({ investorId, dealId: A.dealId });

    const res = await analyst(A).investors.delete({ id: investorId });
    expect(res).toEqual({ ok: true, portalLogins: 1 });
    expect(await prisma.investor.findUnique({ where: { id: investorId } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: 'lena@meridian.test' } })).toBeNull();
    expect(await prisma.holding.count({ where: { investorId } })).toBe(0);
  });
});

describe('ownership', () => {
  let bInvestor: string;
  let bCashflow: string;
  let aInvestor: string;

  beforeAll(async () => {
    bInvestor = (await analyst(B).investors.create({ name: 'Rival LP' }) as { id: string }).id;
    await analyst(B).investors.setHolding({ investorId: bInvestor, dealId: B.dealId, committed: 100_000 });
    bCashflow = (await analyst(B).investors.recordCashflow({
      investorId: bInvestor, dealId: B.dealId, kind: 'dist', label: 'Rival dist', amount: 1_000, date: inDays(-1),
    }) as { id: string }).id;
    aInvestor = (await analyst(A).investors.create({ name: 'Fund LP' }) as { id: string }).id;
  });

  it('refuses another firm’s investor, deal and statement line at every door', async () => {
    const before = JSON.stringify(
      [
        await prisma.investor.findMany({ where: { orgId: B.orgId } }),
        await prisma.holding.findMany({ where: { investor: { orgId: B.orgId } } }),
        await prisma.cashflow.findMany({ where: { investor: { orgId: B.orgId } } }),
      ],
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    const a = analyst(A);
    await expectDenied('own investor, their deal', () => a.investors.setHolding({ investorId: aInvestor, dealId: B.dealId, committed: 1 }));
    await expectDenied('their investor, own deal', () => a.investors.setHolding({ investorId: bInvestor, dealId: A.dealId, committed: 1 }));
    await expectDenied('their investor, a line', () =>
      a.investors.recordCashflow({ investorId: bInvestor, dealId: null, kind: 'dist', label: 'x', amount: 1, date: new Date() }),
    );
    await expectDenied('own investor, their deal, a line', () =>
      a.investors.recordCashflow({ investorId: aInvestor, dealId: B.dealId, kind: 'dist', label: 'x', amount: 1, date: new Date() }),
    );
    await expectDenied('their line', () => a.investors.deleteCashflow({ cashflowId: bCashflow }));
    await expectDenied('their investor, update', () => a.investors.update({ id: bInvestor, patch: { name: 'Taken' } }));
    await expectDenied('their investor, delete', () => a.investors.delete({ id: bInvestor }));
    await expectDenied('their holding', () => a.investors.removeHolding({ investorId: bInvestor, dealId: B.dealId }));
    await expectDenied('their record', () => a.investors.record(bInvestor));
    await expectDenied('their position', () => a.investors.get(bInvestor));

    const after = JSON.stringify(
      [
        await prisma.investor.findMany({ where: { orgId: B.orgId } }),
        await prisma.holding.findMany({ where: { investor: { orgId: B.orgId } } }),
        await prisma.cashflow.findMany({ where: { investor: { orgId: B.orgId } } }),
      ],
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(after, 'B’s register changed while A was calling').toBe(before);
  });

  it('a view-only member and an outsider are refused', async () => {
    await expectDenied('viewer creating', () => viewer(A).investors.create({ name: 'Viewer LP' }));
    await expectDenied('anonymous creating', () => anonymous().investors.create({ name: 'Nobody LP' }));
    await expectDenied('anonymous listing', () => anonymous().investors.list());
    // but a view-only member reads the register like a colleague
    expect(await viewer(A).investors.list()).toEqual(await analyst(A).investors.list());
  });
});

describe('provenance', () => {
  it('every write left an event naming who did it', async () => {
    const events = await prisma.activityEvent.findMany({ where: { orgId: A.orgId }, orderBy: { at: 'asc' } });
    const actions = events.map((e) => e.action);
    for (const expected of [
      'added an investor',
      'added a holding',
      'recorded a distribution',
      'issued a capital call',
      'updated holding — recorded IRR',
      'updated holding — committed',
      'updated investor — contact',
      'updated investor — name',
      'withdrew a capital call',
      'deleted a distribution line',
      'removed a holding',
      'removed an investor',
    ]) {
      expect(actions, `no event for "${expected}"`).toContain(expected);
    }
    for (const e of events.filter((e) => /investor|holding|distribution|capital call/.test(e.action))) {
      expect(e.actor).toBe(A.principal.name);
    }
    // the demand for money says how much and when it is due
    const call = events.find((e) => e.action === 'issued a capital call')!;
    expect(call.target).toMatch(/£500,000/);
    expect(call.dealId).toBe(A.dealId);
  });
});
