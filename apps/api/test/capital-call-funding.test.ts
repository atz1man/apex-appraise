import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A capital call is a demand until somebody says the money arrived.
 *
 * There was no way to say it. A call was a `Cashflow` row with a due date, and
 * the investor portal decided whether the money had moved by comparing that date
 * to today: `openCall` was `date > now` and the payment history was `date <= now`,
 * under a comment calling that list "money that has moved". So on the day a
 * drawdown notice fell due it stopped being an open demand and appeared in the
 * LP's own statement as a payment they had made — whether or not they had paid a
 * penny. A capital call is a legal demand for cash under the LPA, the firm had
 * nowhere to see which were outstanding, and the investor was shown a receipt.
 *
 * `Cashflow.fundedAt` is the fact. The portal reads it instead of the clock, and
 * `investors.fundCashflow` is how a firm records it — both ways, because a call
 * marked funded in error is a receipt for money that never arrived and the only
 * alternative was deleting the notice, which loses the demand with the mistake.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const DAY = 24 * 60 * 60 * 1000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const ahead = (d: number) => new Date(Date.now() + d * DAY);

let investorId = '';

const addCall = (label: string, date: Date) =>
  caller().investors.recordCashflow({
    investorId, dealId: T.dealId, kind: 'call', label, amount: 250_000, date,
  } as never) as Promise<{ id: string; fundedAt: Date | null }>;

const addDist = (label: string, date: Date) =>
  caller().investors.recordCashflow({
    investorId, dealId: T.dealId, kind: 'dist', label, amount: 100_000, date,
  } as never) as Promise<{ id: string }>;

type Position = {
  openCapitalCalls: Array<{ label: string; due: Date; overdue: boolean; amount: number }>;
  cashflows: Array<{ kind: string; label: string; date: Date }>;
};
const position = async (): Promise<Position> => (await caller().investors.get(investorId as never)) as Position;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('CallFunding');
  const inv = (await caller().investors.create({
    name: 'Kestrel Partners LP', contactFirst: 'Dana', sharePct: 40,
  } as never)) as { id: string };
  investorId = inv.id;
  await caller().investors.setHolding({ investorId, dealId: T.dealId, committed: 2_000_000 } as never);
}, 120_000);

describe('an unfunded call is a demand, however old', () => {
  it('is open while it is dated ahead', async () => {
    await addCall('drawdown 1', ahead(14));
    const p = await position();
    expect(p.openCapitalCalls.map((c) => c.label)).toEqual(['drawdown 1']);
    expect(p.openCapitalCalls[0]!.overdue).toBe(false);
  });

  /**
   * The defect, at the procedure. The clock used to decide: the day this notice
   * fell due it left the open list and joined the statement as money sent.
   */
  it('is still open once the due date has passed, and says it is overdue', async () => {
    await addCall('drawdown 2', ago(10));
    const p = await position();
    const overdue = p.openCapitalCalls.find((c) => c.label === 'drawdown 2');
    expect(overdue, 'an overdue call stopped being a demand the day it became one').toBeTruthy();
    expect(overdue!.overdue).toBe(true);
  });

  it('is not in the payment history, because no payment was made', async () => {
    const p = await position();
    expect(
      p.cashflows.map((c) => c.label),
      'an LP was shown a payment they had not made',
    ).not.toContain('drawdown 2');
  });

  /** Several tranches: the portal showed one, chosen by `.find()`. */
  it('shows every outstanding notice, soonest first', async () => {
    await addCall('drawdown 3', ahead(40));
    const p = await position();
    expect(p.openCapitalCalls.map((c) => c.label)).toEqual(['drawdown 2', 'drawdown 1', 'drawdown 3']);
  });
});

describe('once the firm records the money as arrived', () => {
  it('leaves the open list and joins the statement', async () => {
    const before = await position();
    const call = before.openCapitalCalls.find((c) => c.label === 'drawdown 2')!;
    expect(call).toBeTruthy();
    const row = await prisma.cashflow.findFirstOrThrow({ where: { investorId, label: 'drawdown 2' } });
    await caller().investors.fundCashflow({ cashflowId: row.id, funded: true } as never);

    const p = await position();
    expect(p.openCapitalCalls.map((c) => c.label)).not.toContain('drawdown 2');
    expect(p.cashflows.map((c) => c.label), 'a funded call is money that has moved').toContain('drawdown 2');
  });

  /**
   * Dated by when the money ARRIVED, not by when it was demanded. A statement is
   * about when cash moved, and those are different days whenever an LP pays late.
   */
  it('is dated by the funding, not by the demand', async () => {
    const row = await prisma.cashflow.findFirstOrThrow({ where: { investorId, label: 'drawdown 2' } });
    const p = await position();
    const line = p.cashflows.find((c) => c.label === 'drawdown 2')!;
    expect(new Date(line.date).toISOString()).toBe(row.fundedAt!.toISOString());
    expect(new Date(line.date).getTime(), 'the statement is dated by the demand').not.toBe(row.date.getTime());
  });

  it('records it in the audit trail', async () => {
    expect(
      await prisma.activityEvent.count({
        where: { orgId: T.orgId, action: 'recorded a capital call as funded' },
      }),
    ).toBe(1);
  });

  /** A receipt for money that never arrived has to be revocable. */
  it('can be unfunded, and becomes a demand again', async () => {
    const row = await prisma.cashflow.findFirstOrThrow({ where: { investorId, label: 'drawdown 2' } });
    await caller().investors.fundCashflow({ cashflowId: row.id, funded: false } as never);
    const p = await position();
    expect(p.openCapitalCalls.map((c) => c.label)).toContain('drawdown 2');
    expect(p.cashflows.map((c) => c.label)).not.toContain('drawdown 2');
    expect(
      await prisma.activityEvent.count({ where: { orgId: T.orgId, action: 'marked a capital call unfunded' } }),
    ).toBe(1);
  });
});

describe('what funding is not', () => {
  it('refuses a distribution — one is recorded when it is paid', async () => {
    const d = await addDist('Q1 distribution', ago(5));
    await expect(caller().investors.fundCashflow({ cashflowId: d.id, funded: true } as never)).rejects.toThrow(
      /Only a capital call is funded/i,
    );
  });

  it('leaves a distribution in the history on its own date', async () => {
    const p = await position();
    expect(p.cashflows.map((c) => c.label)).toContain('Q1 distribution');
  });

  /** A distribution dated ahead is not money that has moved either. */
  it('keeps a future distribution out of the history', async () => {
    await addDist('Q3 distribution', ahead(30));
    const p = await position();
    expect(p.cashflows.map((c) => c.label)).not.toContain('Q3 distribution');
  });

  it('refuses another firm’s line', async () => {
    const other = await makeTenant('CallFundingOther');
    const theirInv = (await callerFor(other.principal).investors.create({
      name: 'Other LP', contactFirst: 'Sam', sharePct: 10,
    } as never)) as { id: string };
    const theirs = (await callerFor(other.principal).investors.recordCashflow({
      investorId: theirInv.id, dealId: other.dealId, kind: 'call', label: 'their drawdown', amount: 10_000, date: ago(1),
    } as never)) as { id: string };
    await expect(caller().investors.fundCashflow({ cashflowId: theirs.id, funded: true } as never)).rejects.toThrow(
      /NOT_FOUND|not found/i,
    );
    expect(
      (await prisma.cashflow.findUniqueOrThrow({ where: { id: theirs.id } })).fundedAt,
      'another firm’s call was funded',
    ).toBeNull();
  });
});
