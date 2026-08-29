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

function shortTermRejectRight(bought: Date, today: Date): LegalRight {
  const ends = addDays(bought, REJECT_DAYS);
  const left = daysBetween(today, ends);
  return {
    chip: 'Consumer Rights Act',
    live: left >= 0,
    body:
      left >= 0
        ? `30-day right to reject faulty goods for a full refund — ends ${fmtDate(ends)} (${days(left)} left). This one applies wherever you bought it.`
        : 'The 30-day window to reject faulty goods has passed — you can still ask for a free repair or replacement if a fault appears, for up to six years in England and Wales.',
  };
}

function coolingOffRight(bought: Date, today: Date, storeWindowOpen: boolean): LegalRight {
  const ends = addDays(bought, COOLING_OFF_DAYS);
  const left = daysBetween(today, ends);
  return {
    chip: 'Consumer Contracts Regs',
    live: left >= 0,
    body:
      left >= 0
        ? `14-day cooling-off on distance purchases — you can cancel for any reason until ${fmtDate(ends)} (${days(left)} left), then 14 more days to send it back.`
        : storeWindowOpen
          ? 'The 14-day cooling-off period has passed — the shop’s own window above is still open, so use that.'
          : 'The 14-day cooling-off period has passed. You keep the rights above for anything that turns out to be faulty.',
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
  const bought = fromISODate(r.purchasedOn);
  const reject = shortTermRejectRight(bought, today);
  if (!r.distance) return [reject];

  const coolingOff = coolingOffRight(bought, today, storeWindowOpen);
  return coolingOff.live ? [coolingOff, reject] : [reject, coolingOff];
}

export const LEGAL_DISCLAIMER = 'Guidance, not legal advice.';
