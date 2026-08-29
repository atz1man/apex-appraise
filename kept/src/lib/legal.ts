import { addDays, daysBetween, fmtDate, fromISODate } from './dates';
import type { Receipt } from './types';

/**
 * The statutory clocks, stated in the words a person could actually use at a
 * counter. This is guidance, not legal advice — the disclaimer in Settings
 * says so, and every string here stays descriptive of the rights the app
 * tracks rather than telling anyone what will happen in their case.
 *
 * Two rights, and the important thing about them is that they are CUMULATIVE:
 *
 *  - 30 days to reject FAULTY goods for a full refund (Consumer Rights Act
 *    2015, s.22). Every purchase carries this, in a shop or online.
 *  - 14 days to cancel a DISTANCE or off-premises purchase for any reason at
 *    all (Consumer Contracts (Information, Cancellation and Additional
 *    Charges) Regulations 2013, reg. 29-30), then 14 more days to send it
 *    back. This one is additional, and it does not exist for something bought
 *    over a counter.
 *
 * This file previously chose ONE of them from a `legalDays: 14 | 30` field,
 * which was wrong in both directions and wrong for money. A receipt marked 14
 * — which was every receipt the add screen created — was never told about the
 * 30-day right to reject that it also had, and if it had been bought in a shop
 * it was told about a cooling-off period that does not exist there. Someone
 * acting on either is someone turned away at a counter, or someone who let a
 * refund lapse believing they only had a repair coming.
 *
 * The prototype's wording had a third fault, kept fixed here: a live 14-day
 * cooling-off period rendered as "ended". Telling someone a right they still
 * hold has expired is the one failure mode this screen must not have.
 *
 * Which is also why the DATE these clocks run from is stated rather than
 * quietly assumed. Both of them legally start the day the goods came into the
 * buyer's hands, not the day they were paid for. On a counter purchase those
 * are the same day and the arithmetic below is exact. On a distance purchase
 * they are not, and the app does not know when the parcel landed — so what it
 * computes from the order date is the EARLIEST the right could end, and it
 * says so. The old comment here claimed "counted from delivery" while the code
 * counted from purchase, which is how a screen ends up asserting a right has
 * expired on a day it may well still be live.
 */
export interface LegalRight {
  /** Which statute, for the chip. */
  chip: string;
  body: string;
  /** True while this statutory clock is still running. */
  live: boolean;
}

/** Consumer Rights Act 2015, s.22 — every purchase, faulty goods only. */
const REJECT_DAYS = 30;
/** Consumer Contracts Regs 2013 — distance and off-premises only, any reason. */
const COOLING_OFF_DAYS = 14;

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** What a computed end date is worth when the arrival date is unknown. */
const AFTER_ARRIVAL = 'The clock starts the day it arrived, so a parcel that came later runs later.';
const CHECK_ARRIVAL = 'but it starts the day the parcel arrived, so check that date';

/**
 * The extension nobody is told about, said where it is worth money.
 *
 * Regulation 31 of the 2013 Regulations: if the trader did not give the
 * consumer the cancellation information the Regulations require, the
 * cancellation period does not simply end. Supply it late and the period runs
 * 14 days from then; never supply it and the period ends twelve months after
 * it otherwise would have. So an expired cooling-off is not always an expired
 * cooling-off, and the app was closing the door on it.
 *
 * Stated only in the EXPIRED case, and as something to check rather than a
 * conclusion, because whether the shop gave that information is a fact only
 * the buyer has. While the right is plainly live there is nothing here worth
 * the words.
 */
const UNTOLD_EXTENSION =
  'If the shop never told you about this right in writing, the law can extend it by up to a year — worth checking what came with the order.';

/** @param hedged True when the arrival date is unknown, so the end is a floor. */
function shortTermRejectRight(bought: Date, today: Date, hedged: boolean): LegalRight {
  const ends = addDays(bought, REJECT_DAYS);
  const left = daysBetween(today, ends);
  // Both jurisdictions, because the app is sold UK-wide and a Scottish reader
  // given only "six years in England and Wales" is given no number at all.
  // The periods are the Limitation Act 1980's six years and the Prescription
  // and Limitation (Scotland) Act 1973's five.
  const repair =
    'you can still ask for a free repair or replacement if a fault appears, for up to six years in England and Wales, five in Scotland.';
  return {
    chip: 'Consumer Rights Act',
    live: left >= 0,
    body:
      left >= 0
        ? hedged
          ? `30-day right to reject faulty goods for a full refund — at least until ${fmtDate(ends)} (${days(left)} left). ${AFTER_ARRIVAL}`
          : `30-day right to reject faulty goods for a full refund — ends ${fmtDate(ends)} (${days(left)} left). This one applies wherever you bought it.`
        : hedged
          ? `Counting from your order, the 30-day window to reject faulty goods has run out — ${CHECK_ARRIVAL}. Once it has, ${repair}`
          : `The 30-day window to reject faulty goods has passed — ${repair}`,
  };
}

function coolingOffRight(bought: Date, today: Date, storeWindowOpen: boolean, hedged: boolean): LegalRight {
  const ends = addDays(bought, COOLING_OFF_DAYS);
  const left = daysBetween(today, ends);
  const shopStillOpen = storeWindowOpen ? ' The shop’s own window above is still open either way.' : '';
  return {
    chip: 'Consumer Contracts Regs',
    live: left >= 0,
    body:
      left >= 0
        ? hedged
          ? `14-day cooling-off on distance purchases — you can cancel for any reason until at least ${fmtDate(ends)} (${days(left)} left), then 14 more days to send it back. ${AFTER_ARRIVAL}`
          : `14-day cooling-off on distance purchases — you can cancel for any reason until ${fmtDate(ends)} (${days(left)} left), counting from the day it arrived, then 14 more days to send it back.`
        : hedged
          ? `Counting from your order, the 14-day cooling-off has run out — ${CHECK_ARRIVAL}.${shopStillOpen || ' You keep the rights above for anything that turns out to be faulty.'} ${UNTOLD_EXTENSION}`
          : `The 14-day cooling-off has passed, counting from the day it arrived.${shopStillOpen || ' You keep the rights above for anything that turns out to be faulty.'} ${UNTOLD_EXTENSION}`,
  };
}

/**
 * Every statutory right this purchase carries, most powerful first.
 *
 * Returns one entry for something bought over a counter and two for a distance
 * purchase — never a choice between them. The order is deliberate: cancelling
 * for any reason is the stronger right while it lasts, so it leads when it is
 * live and follows the always-applicable one once it has run out.
 */
export function legalRights(r: Receipt, today: Date, storeWindowOpen: boolean): LegalRight[] {
  // The day the goods came into the buyer's hands, which is where both clocks
  // legally start. A counter purchase is handed over when it is paid for; a
  // delivered one is only known once someone says so, and until then the
  // dates are the earliest they could be and say so.
  const known = !r.distance || r.arrivedOn !== undefined;
  const from = fromISODate(r.arrivedOn ?? r.purchasedOn);

  const reject = shortTermRejectRight(from, today, !known);
  if (!r.distance) return [reject];

  const coolingOff = coolingOffRight(from, today, storeWindowOpen, !known);
  return coolingOff.live ? [coolingOff, reject] : [reject, coolingOff];
}

export const LEGAL_DISCLAIMER = 'Guidance, not legal advice.';
