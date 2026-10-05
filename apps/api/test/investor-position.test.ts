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
  openCapitalCalls: Array<{ deal: string | null; label: string; amount: number; due: Date; overdue: boolean }>;
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
    data: { investorId: inv.id, dealId: T.dealId, committed: 2_100_000_00n, called: 1_722_000_00n, distributed: 1_800_000_00n, irr: 0.231 },
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
      data: { investorId: inv.id, dealId: other.dealId, committed: 1_000_000_00n, called: 0n, distributed: 0n, irr: null },
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

/**
 * What "outstanding" means, which this file used to get wrong in the one way that
 * costs an investor money.
 *
 * The rule was `date > now`: a notice was open while its due date was ahead, and
 * one of the cases below asserted that in so many words — "drops a notice once
 * its due date has passed, rather than showing it overdue for ever". That read
 * sensibly against a HARDCODED notice, whose fixed date went stale and left every
 * LP of every firm staring at an overdue demand nobody had issued. Against real
 * data it means the opposite: on the day a drawdown notice falls due it leaves the
 * demand panel and joins the LP's own statement, under a comment calling that list
 * "money that has moved". An investor who had paid nothing read a payment they
 * had made, and the firm had nowhere to see what was outstanding.
 *
 * `Cashflow.fundedAt` is the missing fact. A call is a demand until the firm
 * records the money as arrived, overdue if its date has passed, and in the
 * statement only once it is funded — dated by the funding.
 */
describe('the capital call panel', () => {
  it('shows nothing when no notice is outstanding', async () => {
    const p = (await asInvestor().investors.myPosition()) as Position;
    expect(p.openCapitalCalls, 'a demand for money was shown with nothing on the record').toEqual([]);
  });

  it('shows a real notice, its own deal and its own due date', async () => {
    await prisma.cashflow.create({
      data: { investorId, dealId: T.dealId, kind: 'call', label: 'Capital call — drawdown 4', amount: -900_000_00n, date: inDays(30) },
    });
    const p = (await asInvestor().investors.myPosition()) as Position;
    expect(p.openCapitalCalls).toHaveLength(1);
    expect(p.openCapitalCalls[0]!.label).toBe('Capital call — drawdown 4');
    expect(p.openCapitalCalls[0]!.deal).toBe('Fund Wharf');
    // held negative from the LP's side; a demand is shown positive
    expect(p.openCapitalCalls[0]!.amount).toBe(495_000);
    expect(p.openCapitalCalls[0]!.overdue).toBe(false);
  });

  it('keeps an open notice out of the history — a demand is not a payment', async () => {
    // measured on the demo LP: "drawdown 4 · 05 Oct 2026 · −£495k" led the history a month early
    const p = (await asInvestor().investors.myPosition()) as Position & { cashflows: Array<{ label: string; date: Date }> };
    expect(p.openCapitalCalls[0]!.label).toBe('Capital call — drawdown 4');
    expect(p.cashflows.map((c) => c.label)).not.toContain('Capital call — drawdown 4');
    for (const c of p.cashflows) expect(c.date.getTime()).toBeLessThanOrEqual(Date.now());
  });

  /**
   * The case this replaces asserted the opposite, and the replacement is the whole
   * point of the column: an unpaid demand does not become a payment by sitting
   * there. It says overdue instead.
   */
  it('keeps an unpaid notice as a demand once its due date has passed, and says it is overdue', async () => {
    await prisma.cashflow.deleteMany({ where: { investorId, kind: 'call' } });
    await prisma.cashflow.create({
      data: { investorId, dealId: T.dealId, kind: 'call', label: 'Capital call — drawdown 3', amount: -500_000_00n, date: inDays(-30) },
    });
    const p = (await asInvestor().investors.myPosition()) as Position & { cashflows: Array<{ label: string }> };
    expect(p.openCapitalCalls.map((c) => c.label)).toEqual(['Capital call — drawdown 3']);
    expect(p.openCapitalCalls[0]!.overdue).toBe(true);
    expect(
      p.cashflows.map((c) => c.label),
      'an unpaid demand appeared in the statement as a payment',
    ).not.toContain('Capital call — drawdown 3');
  });

  /** And once it IS funded, it is money that moved and leaves the demand panel. */
  it('moves into the statement when the firm records the money as arrived', async () => {
    const row = await prisma.cashflow.findFirstOrThrow({ where: { investorId, kind: 'call' } });
    await callerFor(T.principal).investors.fundCashflow({ cashflowId: row.id, funded: true } as never);
    const p = (await asInvestor().investors.myPosition()) as Position & { cashflows: Array<{ label: string }> };
    expect(p.openCapitalCalls).toEqual([]);
    expect(p.cashflows.map((c) => c.label)).toContain('Capital call — drawdown 3');
  });

  it('shows every outstanding notice, not just the first', async () => {
    await prisma.cashflow.deleteMany({ where: { investorId, kind: 'call' } });
    for (const [label, days] of [['drawdown A', -5], ['drawdown B', 10], ['drawdown C', 40]] as const) {
      await prisma.cashflow.create({
        data: { investorId, dealId: T.dealId, kind: 'call', label, amount: -100_000_00n, date: inDays(days) },
      });
    }
    const p = (await asInvestor().investors.myPosition()) as Position;
    expect(p.openCapitalCalls.map((c) => c.label), 'soonest first').toEqual(['drawdown A', 'drawdown B', 'drawdown C']);
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
    expect(p.openCapitalCalls).toEqual([]);
  });
});
