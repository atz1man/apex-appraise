import { addDays, daysBetween, fmtDate, fromISODate } from './dates';
import type { Receipt } from './types';

/**
 * The statutory clock, stated in the words a person could actually use at a
 * counter. This is guidance, not legal advice — the disclaimer in Settings
 * says so, and every string here stays descriptive of the two rights the app
 * tracks rather than telling anyone what will happen in their case.
 *
 * Two separate rights, and the app only ever shows the one the purchase
 * carries:
 *  - 30 days to reject FAULTY goods for a full refund (Consumer Rights Act
 *    2015, s.22), counted from delivery;
 *  - 14 days to cancel a DISTANCE purchase for any reason at all (Consumer
 *    Contracts Regulations 2013), also counted from delivery.
 *
 * The prototype's wording had these crossed: a live 14-day cooling-off period
 * rendered as "ended". Corrected here — telling someone a right they still
 * hold has expired is the one failure mode this screen must not have.
 */
export interface LegalRight {
  chip: string;
  body: string;
  /** True while the statutory clock is still running. */
  live: boolean;
}

export function legalRight(r: Receipt, today: Date, storeWindowOpen: boolean): LegalRight {
  const bought = fromISODate(r.purchasedOn);
  const ends = addDays(bought, r.legalDays);
  const daysLeft = daysBetween(today, ends);
  const live = daysLeft >= 0;

  if (r.legalDays === 30) {
    return {
      chip: 'Consumer Rights Act',
      live,
      body: live
        ? `30-day right to reject faulty goods for a full refund — ends ${fmtDate(ends)} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left).`
        : 'The 30-day window to reject faulty goods has passed — you can still ask for a free repair or replacement if a fault appears, for up to six years in England and Wales.',
    };
  }

  return {
    chip: 'Consumer Contracts Regs',
    live,
    body: live
      ? `14-day cooling-off on distance purchases — you can cancel for any reason until ${fmtDate(ends)} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left), then 14 more days to send it back.`
      : storeWindowOpen
        ? 'The 14-day cooling-off period has passed — the shop’s own window above is still open, so use that.'
        : 'The 14-day cooling-off period has passed. If the item turns out to be faulty, you keep the right to a repair or replacement.',
  };
}

export const LEGAL_DISCLAIMER = 'Guidance, not legal advice.';
