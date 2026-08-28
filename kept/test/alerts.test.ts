import { describe, expect, it } from 'vitest';
import { alertKey, dueAlerts, pruneSent, supersededKeys } from '../src/lib/alerts';
import { addDays, toISODate } from '../src/lib/dates';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);
const URGENT = 7;

/** A receipt whose window closes in exactly `daysLeft` days. */
function closingIn(daysLeft: number, over: Partial<Receipt> = {}): Receipt {
  const windowDays = 30;
  return {
    id: 'r1', store: 'Zara', item: 'Wool coat', cat: 'clothing', amount: toPence(34.99),
    purchasedOn: toISODate(addDays(TODAY, -(windowDays - daysLeft))),
    windowDays, policy: 'p', legalDays: 14, status: 'active',
    ...over,
  };
}

const none = new Set<string>();

describe('which deadlines are worth an interruption', () => {
  it('says nothing about a deadline that is still far off', () => {
    expect(dueAlerts([closingIn(20)], TODAY, URGENT, none)).toEqual([]);
  });

  it('raises the week rung as the deadline enters the urgent window', () => {
    expect(dueAlerts([closingIn(7)], TODAY, URGENT, none)[0]).toMatchObject({ rung: 'week' });
    expect(dueAlerts([closingIn(8)], TODAY, URGENT, none)).toEqual([]);
  });

  it.each([
    [3, 'soon'],
    [1, 'soon'],
    [0, 'today'],
    [-1, 'closed'],
  ])('puts a deadline %i days out on the %s rung', (days, rung) => {
    expect(dueAlerts([closingIn(days)], TODAY, URGENT, none)[0]).toMatchObject({ rung });
  });

  it('follows the user’s own urgent threshold', () => {
    expect(dueAlerts([closingIn(12)], TODAY, URGENT, none)).toEqual([]);
    expect(dueAlerts([closingIn(12)], TODAY, 14, none)[0]).toMatchObject({ rung: 'week' });
  });

  it('never interrupts about a receipt already returned', () => {
    expect(dueAlerts([closingIn(0, { status: 'returned' })], TODAY, URGENT, none)).toEqual([]);
  });

  it('counts from dispatch when the retailer does', () => {
    // The alert has to agree with the screen, or one of them is lying.
    const zara = closingIn(10, { windowStartsOn: toISODate(addDays(TODAY, -27)) });
    expect(dueAlerts([zara], TODAY, URGENT, none)[0]).toMatchObject({ rung: 'soon' });
  });
});

describe('restraint', () => {
  it('says a thing once, then never again', () => {
    const r = closingIn(2);
    const first = dueAlerts([r], TODAY, URGENT, none);
    expect(first).toHaveLength(1);
    expect(dueAlerts([r], TODAY, URGENT, new Set([first[0].key]))).toEqual([]);
  });

  it('still speaks up when the receipt reaches a more urgent rung', () => {
    const sent = new Set([alertKey('r1', 'week')]);
    expect(dueAlerts([closingIn(2)], TODAY, URGENT, sent)[0]).toMatchObject({ rung: 'soon' });
  });

  it('raises one alert, not four, for a phone left in a drawer', () => {
    // Opened after two weeks: the coat crossed week, soon and today on the way.
    const alerts = dueAlerts([closingIn(-1)], TODAY, URGENT, none);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].rung).toBe('closed');
    // The rungs it skipped are marked delivered so they cannot fire later.
    expect(supersededKeys(alerts[0]).sort()).toEqual([
      alertKey('r1', 'soon'), alertKey('r1', 'today'), alertKey('r1', 'week'),
    ].sort());
  });

  it('supersedes nothing at the gentlest rung', () => {
    expect(supersededKeys(dueAlerts([closingIn(7)], TODAY, URGENT, none)[0])).toEqual([]);
  });

  it('puts the most urgent first when several fire at once', () => {
    const set = [
      closingIn(6, { id: 'week-one' }),
      closingIn(-2, { id: 'closed-one' }),
      closingIn(0, { id: 'today-one' }),
      closingIn(2, { id: 'soon-one' }),
    ];
    expect(dueAlerts(set, TODAY, URGENT, none).map((a) => a.receiptId)).toEqual([
      'today-one', 'soon-one', 'closed-one', 'week-one',
    ]);
  });
});

describe('the copy people actually see', () => {
  it('names the shop, the item and the money', () => {
    const a = dueAlerts([closingIn(2)], TODAY, URGENT, none)[0];
    expect(a.title).toBe('Go now or lose it');
    expect(a.body).toContain('Zara · Wool coat');
    expect(a.body).toContain('£34.99');
    expect(a.body).toContain('2 days left');
  });

  it('uses the singular on the last-but-one day', () => {
    expect(dueAlerts([closingIn(1)], TODAY, URGENT, none)[0].body).toContain('1 day left');
  });

  it('gives the deadline date on the gentle rung, when there is still time to plan', () => {
    expect(dueAlerts([closingIn(7)], TODAY, URGENT, none)[0].body).toContain('4 Sep');
  });

  it('stays useful rather than scolding once the window has closed', () => {
    const a = dueAlerts([closingIn(-1)], TODAY, URGENT, none)[0];
    expect(a.body).toContain('still have rights');
  });
});

describe('the sent list does not grow forever', () => {
  it('forgets keys for receipts that no longer exist', () => {
    const kept = closingIn(2, { id: 'still-here' });
    const sent = [alertKey('still-here', 'week'), alertKey('deleted', 'week'), alertKey('deleted', 'soon')];
    expect(pruneSent(sent, [kept])).toEqual([alertKey('still-here', 'week')]);
  });

  it('does not trip over an id containing a colon', () => {
    const odd = closingIn(2, { id: 'r:1:2' });
    expect(pruneSent([alertKey('r:1:2', 'soon')], [odd])).toEqual(['r:1:2:soon']);
  });
});
