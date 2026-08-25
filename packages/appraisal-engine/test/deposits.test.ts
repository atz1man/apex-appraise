import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPOSIT_TERMS, depositSchedule, depositsDueBy, depositsHeldAt } from '../src/deposits.js';

/**
 * The deposit rule, which used to be five rules.
 *
 * The one that mattered: on the buyer's own portal the developer's "Deposit
 * held" read £39,200 while the receipts directly beneath it showed £2,000 and
 * £39,200, both PAID. Whatever else these tests check, they check that those
 * two numbers are the same number.
 */

const plot = { agreedValue: 392_000, appraisedValue: 385_000 };

describe('the schedule', () => {
  it('is a reservation fee and ten per cent on exchange', () => {
    expect(depositSchedule(plot)).toEqual([
      { kind: 'Reservation fee', amount: 2_000, dueAtProgress: 1 },
      { kind: 'Exchange deposit (10%)', amount: 39_200, dueAtProgress: 5 },
    ]);
  });

  it('takes the ten per cent off the AGREED price, not the asking price', () => {
    // the whole point of an agreed value is that it is what was agreed
    expect(depositSchedule(plot)[1]!.amount).toBe(39_200);
    expect(depositSchedule({ ...plot, agreedValue: 400_000 })[1]!.amount).toBe(40_000);
  });

  it('estimates from the asking price while nothing is agreed, rather than saying nothing is owed', () => {
    // the portal's version returned £0 here, printed beside a Pay button
    const row = depositSchedule({ agreedValue: null, appraisedValue: 385_000 })[1]!;
    expect(row.amount).toBe(38_500);
    expect(row.amount).not.toBe(0);
  });

  it('rounds to the penny it would actually be invoiced for', () => {
    expect(depositSchedule({ agreedValue: 392_505, appraisedValue: 0 })[1]!.amount).toBe(39_251);
  });
});

describe('what has fallen due', () => {
  it('is nothing at all on an available plot', () => {
    expect(depositsDueBy(0, plot)).toEqual([]);
    expect(depositsHeldAt(0, plot)).toBe(0);
  });

  it('is the reservation fee from the moment it is reserved', () => {
    for (const progress of [1, 2, 3, 4]) {
      expect(depositsHeldAt(progress, plot), `progress ${progress}`).toBe(2_000);
    }
  });

  it('adds the exchange deposit on exchange, and does not replace the fee with it', () => {
    // this is the defect: the firm's figure was the 10% ALONE, so a buyer's
    // reservation fee vanished from the statement of their own money
    expect(depositsHeldAt(5, plot)).toBe(41_200);
    expect(depositsHeldAt(5, plot)).not.toBe(39_200);
  });

  it('does not go backwards through completion and handover', () => {
    expect(depositsHeldAt(6, plot)).toBe(41_200);
    expect(depositsHeldAt(7, plot)).toBe(41_200);
  });

  it('always equals the sum of the rows a buyer can see', () => {
    // the invariant the portal contradicted, stated directly
    for (const progress of [0, 1, 3, 5, 7]) {
      const rows = depositsDueBy(progress, plot);
      expect(depositsHeldAt(progress, plot), `progress ${progress}`).toBe(rows.reduce((a, r) => a + r.amount, 0));
    }
  });
});

describe('terms a firm might set differently', () => {
  it('carries the fee and the percentage through', () => {
    const terms = { reservationFee: 500, exchangePct: 5 };
    expect(depositsHeldAt(5, plot, terms)).toBe(500 + 19_600);
    expect(depositSchedule(plot, terms)[1]!.kind).toBe('Exchange deposit (5%)');
  });

  it('defaults to what a buyer is actually charged today', () => {
    expect(DEFAULT_DEPOSIT_TERMS).toEqual({ reservationFee: 2_000, exchangePct: 10 });
  });
});
