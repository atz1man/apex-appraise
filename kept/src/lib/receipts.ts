import { addDays, daysBetween, fromISODate, startOfDay } from './dates';
import type { Receipt } from './types';

/**
 * Every derived fact about a receipt, computed from stored dates against a
 * caller-supplied `today`. The date is a parameter rather than a `new Date()`
 * inside, because a deadline calculator that cannot be run at an arbitrary
 * date is a deadline calculator that cannot be tested.
 */
export interface DerivedReceipt {
  /** The date the retailer's clock actually started (dispatch, where that differs). */
  windowStart: Date;
  /** The last day the item can go back — inclusive. */
  deadline: Date;
  /** Whole days from today to the deadline. 0 = today is the last day. */
  daysLeft: number;
  /** Days of the window already spent. */
  daysUsed: number;
  expired: boolean;
}

export function derive(r: Receipt, today: Date): DerivedReceipt {
  const windowStart = fromISODate(r.windowStartsOn ?? r.purchasedOn);
  const deadline = addDays(windowStart, r.windowDays);
  const daysLeft = daysBetween(today, deadline);
  const elapsed = daysBetween(windowStart, today);
  return {
    windowStart,
    deadline,
    daysLeft,
    // Clamped: a receipt back-dated by a typo must not report "-4 of 30 days
    // used", and one long past its deadline shows the window as fully spent
    // rather than overflowing the progress ring.
    daysUsed: Math.max(0, Math.min(r.windowDays, elapsed)),
    expired: daysLeft < 0,
  };
}

/** Soonest deadline first — the order every list in the app uses. */
export function byDeadline(today: Date) {
  return (a: Receipt, b: Receipt) => derive(a, today).daysLeft - derive(b, today).daysLeft;
}

export interface Buckets {
  urgent: Receipt[];
  later: Receipt[];
  returned: Receipt[];
}

/**
 * The three home-screen sections. An expired-but-unreturned receipt stays in
 * `urgent`, at the top: the money may still be recoverable under the
 * statutory rights, and silently demoting it would hide the one row the user
 * most needs to see.
 */
export function bucket(receipts: readonly Receipt[], today: Date, urgentDays: number): Buckets {
  const active = receipts.filter((r) => r.status === 'active').sort(byDeadline(today));
  return {
    urgent: active.filter((r) => derive(r, today).daysLeft <= urgentDays),
    later: active.filter((r) => derive(r, today).daysLeft > urgentDays),
    returned: receipts.filter((r) => r.status === 'returned'),
  };
}

/** Receipts whose deadline lands inside the 30-day timeline strip. */
export function timelineDots(receipts: readonly Receipt[], today: Date) {
  return receipts
    .filter((r) => r.status === 'active')
    .map((r) => ({ receipt: r, d: derive(r, today) }))
    .filter(({ d }) => d.daysLeft >= 0 && d.daysLeft <= 30)
    .map(({ receipt, d }) => ({
      store: receipt.store,
      daysLeft: d.daysLeft,
      // Clamped away from the rail's ends so a dot is never half off the strip.
      left: Math.max(2, Math.min(98, Math.round((d.daysLeft / 30) * 100))),
    }));
}

export function makeReceiptId(now: Date = new Date()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `r_${startOfDay(now).getTime().toString(36)}_${rand}`;
}
