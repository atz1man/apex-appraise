import { addDays, addMonths, daysBetween, fromISODate, startOfDay } from './dates';
import type { Receipt } from './types';

/**
 * Every derived fact about a receipt, computed from stored dates against a
 * caller-supplied `today`. The date is a parameter rather than a `new Date()`
 * inside, because a deadline calculator that cannot be run at an arbitrary
 * date is a deadline calculator that cannot be tested.
 */
export interface DerivedWarranty {
  /** The quoted length. Zero means a note with no clock behind it. */
  months: number;
  /** Last day of cover, inclusive. */
  ends: Date;
  daysLeft: number;
  expired: boolean;
  /** Remaining cover, said the way a person would: "2 years", "5 months", "9 days". */
  label: string;
}

/**
 * Warranties are long, so days are the wrong unit for most of one and the
 * right unit for the end of it. "638 days" tells you nothing; "1y 9m" tells
 * you not to worry, and "9 days" tells you to hurry.
 */
function humaniseRemaining(today: Date, ends: Date): string {
  const days = daysBetween(today, ends);
  if (days < 0) return '';
  if (days < 45) return `${days} ${days === 1 ? 'day' : 'days'}`;
  let months = 0;
  while (addMonths(today, months + 1).getTime() <= ends.getTime()) months += 1;
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (rest === 0) return `${years} ${years === 1 ? 'year' : 'years'}`;
  return `${years}y ${rest}m`;
}

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
  /** Present only when the receipt carries a warranty. */
  warranty?: DerivedWarranty;
}

/**
 * The warranty clock runs from PURCHASE, not from the dispatch date a shop may
 * use for returns: a manufacturer's cover starts when the thing was bought,
 * whatever the retailer counts its own window from.
 */
function deriveWarranty(r: Receipt, today: Date): DerivedWarranty | undefined {
  if (!r.warranty) return undefined;
  const ends = addMonths(fromISODate(r.purchasedOn), r.warranty.months);
  const daysLeft = daysBetween(today, ends);
  return {
    months: r.warranty.months,
    ends,
    daysLeft,
    expired: daysLeft < 0,
    label: humaniseRemaining(today, ends),
  };
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
    warranty: deriveWarranty(r, today),
  };
}

/**
 * Soonest deadline first — the order every list in the app uses.
 *
 * Pair each receipt with its derived form ONCE, then sort on the number. Used
 * as a bare comparator this derives twice per comparison, which on a few
 * hundred receipts is thousands of redundant date parses to establish an
 * order that was already knowable.
 */
function sortByDeadline(receipts: readonly Receipt[], today: Date): DerivedPair[] {
  return receipts
    .map((r) => ({ receipt: r, derived: derive(r, today) }))
    .sort((a, b) => a.derived.daysLeft - b.derived.daysLeft);
}

export interface DerivedPair {
  receipt: Receipt;
  derived: DerivedReceipt;
}

export interface Buckets {
  /** The shop's window has already shut. Still the top of the list. */
  closed: Receipt[];
  urgent: Receipt[];
  later: Receipt[];
  returned: Receipt[];
}

/**
 * The four home-screen sections.
 *
 * An expired-but-unreturned receipt stays at the top — the money may still be
 * recoverable under the statutory rights, and demoting it would hide the row
 * a person most needs to see. It used to sit inside `urgent`, under the
 * heading "GO NOW OR LOSE IT", which is the one thing that cannot be done
 * about something already lost. On a library with a backlog that heading led
 * a screen of rows all reading "window closed".
 *
 * Its own section instead: same position, and a name that says what the row
 * actually is and what is left to try.
 */
export function bucket(receipts: readonly Receipt[], today: Date, urgentDays: number): Buckets {
  const active = sortByDeadline(receipts.filter((r) => r.status === 'active'), today);
  return {
    closed: active.filter((x) => x.derived.daysLeft < 0).map((x) => x.receipt),
    urgent: active.filter((x) => x.derived.daysLeft >= 0 && x.derived.daysLeft <= urgentDays).map((x) => x.receipt),
    later: active.filter((x) => x.derived.daysLeft > urgentDays).map((x) => x.receipt),
    returned: receipts.filter((r) => r.status === 'returned'),
  };
}

/** Receipts whose deadline lands inside the 30-day timeline strip. */
export function timelineDots(receipts: readonly Receipt[], today: Date) {
  return receipts
    .filter((r) => r.status === 'active')
    .map((r) => ({ receipt: r, derived: derive(r, today) }))
    .filter(({ derived }) => derived.daysLeft >= 0 && derived.daysLeft <= 30)
    .map(({ receipt, derived }) => ({
      store: receipt.store,
      daysLeft: derived.daysLeft,
      // Clamped away from the rail's ends so a dot is never half off the strip.
      left: Math.max(2, Math.min(98, Math.round((derived.daysLeft / 30) * 100))),
    }));
}

export function makeReceiptId(now: Date = new Date()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `r_${startOfDay(now).getTime().toString(36)}_${rand}`;
}
