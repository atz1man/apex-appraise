import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * An LP's own position page.
 *
 * Two of the five headline figures were CONSTANTS in the router —
 * `netIrr: 0.214, netMoic: 1.42` — printed for every investor of every firm,
 * with the real numbers sitting two lines above in the same function. Measured
 * on the demo workspace: called £3,788,400, distributed £2,640,000. That LP had
 * 0.70× of their money back and was being told 1.42×.
 *
 * And the whole "Capital call open" panel was hardcoded: one deal name, one
 * amount, one due date, for everybody. By the time anybody looked, that fixed
 * date had passed — so an LP was reading an OVERDUE demand for £495,000 that
 * nobody had issued. A capital call is a legal demand for cash under the LPA.
 */

let T: Tenant;
let investorId: string;
let userId: string;

const asInvestor = () =>
  callerFor({
    userId,
    orgId: T.orgId,
    principalType: 'investor',
    role: 'VIEWER',
    name: 'Meridian LP',
    initials: 'ML',
    investorId,
    buyerUnitId: null,
  } as never);

type Position = {
  position: { committed: number; called: number; distributed: number; portfolioIrr: number | null; dpi: number | null };
  holdings: Array<{ committed: number; irr: number | null }>;
  openCapitalCall: { deal: string | null; label: string; amount: number; due: Date } | null;
};

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Fund');
  const inv = await prisma.investor.create({
    data: { orgId: T.orgId, name: 'Meridian Capital LP', sharePct: 55 },
  });
  investorId = inv.id;
  // one realised deal, one still in construction with no IRR recorded
  await prisma.holding.create({
    data: { investorId: inv.id, dealId: T.dealId, sharePct: 55, committed: 2_100_000_00n, called: 1_722_000_00n, distributed: 1_800_000_00n, irr: 0.231 },
  });
  const user = await prisma.user.create({
    data: {
      orgId: T.orgId, email: 'lp@fund.test', password: 'x', name: 'Meridian LP',
      initials: 'ML', role: 'VIEWER', principalType: 'investor', investorId: inv.id,
    },
  });
  userId = user.id;
}, 120_000);

describe('the headline figures', () => {
  it('are computed from this investor’s own money, not printed', async () => {
    const p = (await asInvestor().investors.myPosition()) as Position;
    // 55% of £1.8m distributed over 55% of £1.722m called
    expect(p.position.dpi).toBeCloseTo(1_800_000 / 1_722_000, 6);
    expect(p.position.dpi).not.toBe(1.42);
    expect(p.position.portfolioIrr).toBeCloseTo(0.231, 6);
    expect(p.position.portfolioIrr).not.toBe(0.214);
  });

  it('say nothing rather than a number when nothing has been drawn', async () => {
    const other = await makeTenant('New fund');
    const inv = await prisma.investor.create({ data: { orgId: other.orgId, name: 'Fresh LP', sharePct: 100 } });
    await prisma.holding.create({
      data: { investorId: inv.id, dealId: other.dealId, sharePct: 100, committed: 1_000_000_00n, called: 0n, distributed: 0n, irr: null },
    });
    const user = await prisma.user.create({
      data: {
        orgId: other.orgId, email: 'fresh@fund.test', password: 'x', name: 'Fresh LP',
        initials: 'FL', role: 'VIEWER', principalType: 'investor', investorId: inv.id,
      },
    });
    const p = (await callerFor({
      userId: user.id, orgId: other.orgId, principalType: 'investor', role: 'VIEWER',
      name: 'Fresh LP', initials: 'FL', investorId: inv.id, buyerUnitId: null,
    } as never).investors.myPosition()) as Position;

    // 0.00× beside "Distributed £0" reads as a loss; there is simply no ratio yet
    expect(p.position.dpi).toBeNull();
    expect(p.position.portfolioIrr).toBeNull();
  });

  it('scale to the penny, so an export does not carry binary noise', async () => {
    // £900,000 × 0.55 is 495000.00000000006 in floating point
    const p = (await asInvestor().investors.myPosition()) as Position;
    for (const h of p.holdings) {
      expect(Math.round(h.committed * 100) / 100, 'a scaled figure carried more than pennies').toBe(h.committed);
    }
  });
});

describe('the capital call panel', () => {
  it('shows nothing when no notice is outstanding', async () => {
    const p = (await asInvestor().investors.myPosition()) as Position;
    expect(p.openCapitalCall, 'a demand for money was shown with nothing on the record').toBeNull();
  });

  it('shows a real notice, its own deal and its own due date', async () => {
    await prisma.cashflow.create({
      data: { investorId, dealId: T.dealId, kind: 'call', label: 'Capital call — drawdown 4', amount: -900_000_00n, date: inDays(30) },
    });
    const p = (await asInvestor().investors.myPosition()) as Position;
    expect(p.openCapitalCall).toBeTruthy();
    expect(p.openCapitalCall!.label).toBe('Capital call — drawdown 4');
    expect(p.openCapitalCall!.deal).toBe('Fund Wharf');
    // held negative from the LP's side; a demand is shown positive
    expect(p.openCapitalCall!.amount).toBe(495_000);
    expect(p.openCapitalCall!.due.getTime()).toBeGreaterThan(Date.now());
  });

  it('drops a notice once its due date has passed, rather than showing it overdue for ever', async () => {
    // the hardcoded one had a fixed due date, so it went overdue and stayed there
    await prisma.cashflow.deleteMany({ where: { investorId, kind: 'call' } });
    await prisma.cashflow.create({
      data: { investorId, dealId: T.dealId, kind: 'call', label: 'Capital call — drawdown 3', amount: -500_000_00n, date: inDays(-30) },
    });
    const p = (await asInvestor().investors.myPosition()) as Position;
    expect(p.openCapitalCall).toBeNull();
  });

  it('never shows one investor’s notice to another', async () => {
    const other = await prisma.investor.create({ data: { orgId: T.orgId, name: 'Rival LP', sharePct: 20 } });
    await prisma.cashflow.create({
      data: { investorId, dealId: T.dealId, kind: 'call', label: 'Meridian only', amount: -100_000_00n, date: inDays(20) },
    });
    const user = await prisma.user.create({
      data: {
        orgId: T.orgId, email: 'rival@fund.test', password: 'x', name: 'Rival LP',
        initials: 'RL', role: 'VIEWER', principalType: 'investor', investorId: other.id,
      },
    });
    const p = (await callerFor({
      userId: user.id, orgId: T.orgId, principalType: 'investor', role: 'VIEWER',
      name: 'Rival LP', initials: 'RL', investorId: other.id, buyerUnitId: null,
    } as never).investors.myPosition()) as Position;
    expect(p.openCapitalCall).toBeNull();
  });
});
