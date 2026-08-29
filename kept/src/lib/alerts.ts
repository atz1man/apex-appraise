import { fmtDate } from './dates';
import { money } from './money';
import { derive } from './receipts';
import type { Receipt } from './types';

/**
 * Which deadlines deserve to interrupt someone today.
 *
 * "Pings you before either clock runs out" was the promise on the landing
 * page, and a switch in Settings that did nothing. This is the part that
 * decides — pure, so it can be tested at any date, and separate from the
 * delivery mechanism, which differs by platform and will change.
 *
 * The hard requirement is restraint. An app that says the same thing every
 * morning gets its notifications switched off within a week, and then it
 * cannot tell you the one thing that mattered. So a receipt raises each rung
 * of the ladder at most once, ever, and a phone left in a drawer through
 * several rungs still yields one alert: the most urgent.
 */

export type AlertRung = 'week' | 'soon' | 'today' | 'closed';

export interface DeadlineAlert {
  receiptId: string;
  rung: AlertRung;
  /** Stable dedup key — one per receipt per rung, for the life of the receipt. */
  key: string;
  title: string;
  body: string;
}

export const alertKey = (receiptId: string, rung: AlertRung) => `${receiptId}:${rung}`;

const LADDER: AlertRung[] = ['week', 'soon', 'today', 'closed'];

/** The most urgent rung this receipt has reached, or null if it is not close yet. */
function rungFor(daysLeft: number, urgentDays: number): AlertRung | null {
  if (daysLeft < 0) return 'closed';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= 3) return 'soon';
  if (daysLeft <= urgentDays) return 'week';
  return null;
}

function copyFor(rung: AlertRung, r: Receipt, daysLeft: number, deadline: Date): { title: string; body: string } {
  const what = `${r.store} · ${r.item}`;
  switch (rung) {
    case 'week':
      return {
        title: `${money(r.amount)} still returnable`,
        body: `${what} — ${daysLeft} days left, until ${fmtDate(deadline)}.`,
      };
    case 'soon':
      return {
        title: 'Go now or lose it',
        body: `${what} — ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left. ${money(r.amount)} back if it goes back.`,
      };
    case 'today':
      return {
        title: 'Today is the last day',
        body: `${what} — ${money(r.amount)} back, but only if it goes back today.`,
      };
    case 'closed':
      return {
        title: 'That window has closed',
        body: `${what} — the shop’s window has passed. If it turns out to be faulty, you still have rights.`,
      };
  }
}

/**
 * @param sent Dedup keys already delivered. Everything in here stays silent.
 */
export function dueAlerts(
  receipts: readonly Receipt[],
  today: Date,
  urgentDays: number,
  sent: ReadonlySet<string>,
): DeadlineAlert[] {
  const out: DeadlineAlert[] = [];
  for (const r of receipts) {
    if (r.status !== 'active') continue;
    /*
     * Never about the demo set.
     *
     * A notification is not a demonstration. The five receipts a fresh install
     * arrives with are labelled "sample" on the list and cost nothing against
     * the free tier, and this was the one place they still behaved as real:
     * grant permission and the phone says "Go now or lose it — Currys · JBL
     * Tune 770NC headphones — 2 days left. £89.00 back if it goes back", on a
     * lock screen, indistinguishable from a real one, about £89 nobody spent.
     *
     * The urgency is already demonstrated where it can be seen for what it is:
     * the home screen leads with that same receipt and its two days. An
     * interruption carrying a money figure is a different thing from a card.
     */
    if (r.demo) continue;
    const { daysLeft, deadline } = derive(r, today);
    const rung = rungFor(daysLeft, urgentDays);
    if (!rung) continue;
    const key = alertKey(r.id, rung);
    if (sent.has(key)) continue;
    out.push({ receiptId: r.id, rung, key, ...copyFor(rung, r, daysLeft, deadline) });
  }
  // Soonest first: when several fire at once, the one that matters most is the
  // one that gets read.
  const order: Record<AlertRung, number> = { today: 0, soon: 1, closed: 2, week: 3 };
  return out.sort((a, b) => order[a.rung] - order[b.rung]);
}

/**
 * Keys for rungs this receipt has already passed through.
 *
 * Marked delivered without ever being shown, so a phone left in a drawer for a
 * fortnight does not open into four notifications about the same coat. The
 * receipt is at its most urgent rung; the gentler ones it skipped are history,
 * and history is not worth an interruption.
 */
export function supersededKeys(alert: DeadlineAlert): string[] {
  return LADDER.slice(0, LADDER.indexOf(alert.rung)).map((rung) => alertKey(alert.receiptId, rung));
}

/**
 * Drops keys belonging to receipts that no longer exist, so the sent-list does
 * not grow without bound on a device that adds and returns receipts for years.
 */
export function pruneSent(sent: readonly string[], receipts: readonly Receipt[]): string[] {
  const live = new Set(receipts.map((r) => r.id));
  return sent.filter((k) => live.has(k.slice(0, k.lastIndexOf(':'))));
}
