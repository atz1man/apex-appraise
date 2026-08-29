import { describe, expect, it } from 'vitest';
import { addDays, toISODate } from '../src/lib/dates';
import { toPence } from '../src/lib/money';
import { bucket, derive, timelineDots } from '../src/lib/receipts';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);
const ago = (n: number) => toISODate(addDays(TODAY, -n));

function receipt(over: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1', store: 'Currys', item: 'Headphones', cat: 'audio',
    amount: toPence(89), purchasedOn: ago(12), windowDays: 14,
    policy: 'p', distance: false, status: 'active',
    ...over,
  };
}

describe('derive', () => {
  it('counts days left from the stored purchase date', () => {
    expect(derive(receipt(), TODAY).daysLeft).toBe(2);
  });

  it('reports the deadline as an inclusive calendar date', () => {
    expect(toISODate(derive(receipt(), TODAY).deadline)).toBe('2026-08-30');
  });

  it('counts from dispatch when the retailer does', () => {
    // Ordered 15 days ago, dispatched 13. The window hangs off the dispatch
    // date, not the order — which is what makes the deadline shown on the
    // detail screen the shop's own answer rather than a guess from the order
    // confirmation.
    const zara = receipt({ purchasedOn: ago(15), windowStartsOn: ago(13), windowDays: 30 });
    expect(derive(zara, TODAY).daysLeft).toBe(17);
    expect(toISODate(derive(zara, TODAY).windowStart)).toBe(ago(13));
    expect(derive({ ...zara, windowStartsOn: undefined }, TODAY).daysLeft).toBe(15);
  });

  it('marks a passed deadline expired rather than negative-and-fine', () => {
    const d = derive(receipt({ purchasedOn: ago(20), windowDays: 14 }), TODAY);
    expect(d.daysLeft).toBe(-6);
    expect(d.expired).toBe(true);
  });

  it('never reports more days used than the window holds', () => {
    const d = derive(receipt({ purchasedOn: ago(400), windowDays: 30 }), TODAY);
    expect(d.daysUsed).toBe(30);
  });

  it('never reports negative days used for a future-dated purchase', () => {
    const d = derive(receipt({ purchasedOn: toISODate(addDays(TODAY, 3)) }), TODAY);
    expect(d.daysUsed).toBe(0);
  });
});

describe('bucketing', () => {
  const set: Receipt[] = [
    receipt({ id: 'urgent', purchasedOn: ago(12), windowDays: 14 }),   // 2 left
    receipt({ id: 'later', purchasedOn: ago(21), windowDays: 30 }),    // 9 left
    receipt({ id: 'expired', purchasedOn: ago(40), windowDays: 14 }),  // -26
    receipt({ id: 'done', status: 'returned' }),
  ];

  it('splits on the urgent threshold', () => {
    const b = bucket(set, TODAY, 7);
    expect(b.urgent.map((r) => r.id)).toContain('urgent');
    expect(b.later.map((r) => r.id)).toEqual(['later']);
    expect(b.returned.map((r) => r.id)).toEqual(['done']);
  });

  it('keeps an expired receipt in view instead of hiding it', () => {
    // The money may still be recoverable under the statutory rights; silently
    // demoting the row would hide the one the user most needs to act on.
    expect(bucket(set, TODAY, 7).urgent.map((r) => r.id)).toContain('expired');
  });

  it('sorts soonest deadline first, expired at the very top', () => {
    expect(bucket(set, TODAY, 7).urgent.map((r) => r.id)).toEqual(['expired', 'urgent']);
  });

  it('moves the threshold when the user widens it', () => {
    expect(bucket(set, TODAY, 14).later).toHaveLength(0);
  });
});

describe('timeline', () => {
  it('shows only deadlines inside the next 30 days', () => {
    const set = [
      receipt({ id: 'in', purchasedOn: ago(12), windowDays: 14 }),
      receipt({ id: 'far', purchasedOn: ago(10), windowDays: 365 }),
      receipt({ id: 'gone', purchasedOn: ago(40), windowDays: 14 }),
    ];
    expect(timelineDots(set, TODAY).map((d) => d.daysLeft)).toEqual([2]);
  });

  it('keeps every dot on the rail', () => {
    const set = [receipt({ purchasedOn: ago(14), windowDays: 14 })]; // 0 days left
    const [dot] = timelineDots(set, TODAY);
    expect(dot.left).toBeGreaterThanOrEqual(2);
    expect(dot.left).toBeLessThanOrEqual(98);
  });
});

describe('the warranty clock', () => {
  const withWarranty = (months: number, boughtDaysAgo: number) =>
    derive(receipt({ purchasedOn: ago(boughtDaysAgo), warranty: { months } }), TODAY);

  it('is absent when the receipt carries no warranty', () => {
    expect(derive(receipt(), TODAY).warranty).toBeUndefined();
  });

  it('runs from the purchase date, not the retailer’s dispatch clock', () => {
    // Zara counts returns from dispatch; a manufacturer's cover starts when the
    // thing was bought, whatever the shop counts its own window from — so the
    // two-day gap must not shift the warranty's end date.
    const shared = { purchasedOn: ago(30), warranty: { months: 24 } } as const;
    const plain = derive(receipt(shared), TODAY);
    const dispatched = derive(receipt({ ...shared, windowStartsOn: ago(28) }), TODAY);
    expect(toISODate(dispatched.warranty!.ends)).toBe(toISODate(plain.warranty!.ends));
    // ...while the RETURN deadline does move with dispatch.
    expect(dispatched.daysLeft).not.toBe(plain.daysLeft);
  });

  it('expires on the right day two years out', () => {
    const d = withWarranty(24, 12); // bought 16 Aug 2026
    expect(toISODate(d.warranty!.ends)).toBe('2028-08-16');
    expect(d.warranty!.expired).toBe(false);
  });

  it('knows when cover has run out', () => {
    const d = withWarranty(12, 400);
    expect(d.warranty!.expired).toBe(true);
    expect(d.warranty!.daysLeft).toBeLessThan(0);
  });

  it('is still live on its last day', () => {
    const d = withWarranty(12, 365);
    expect(d.warranty!.daysLeft).toBe(0);
    expect(d.warranty!.expired).toBe(false);
  });

  it('says years when there are years left', () => {
    expect(withWarranty(120, 0).warranty!.label).toBe('10 years');
  });

  it('says years and months when the remainder matters', () => {
    expect(withWarranty(24, 90).warranty!.label).toBe('1y 9m');
  });

  it('drops to months in the last year', () => {
    expect(withWarranty(12, 200).warranty!.label).toBe('5 months');
  });

  it('drops to days at the end, when the unit starts to matter', () => {
    expect(withWarranty(12, 356).warranty!.label).toBe('9 days');
  });

  it('uses the singular on the last day', () => {
    expect(withWarranty(12, 364).warranty!.label).toBe('1 day');
  });

  it('carries a note with no clock, for a warranty imported as prose', () => {
    const d = derive(receipt({ warranty: { months: 0, note: '2-year manufacturer warranty' } }), TODAY);
    expect(d.warranty!.months).toBe(0);
  });
});
