import { color } from '../tokens';

export type UrgencyLevel = 'expired' | 'critical' | 'soon' | 'relaxed';

export interface Urgency {
  level: UrgencyLevel;
  /** Chip background. */
  bg: string;
  /** Chip text. */
  fg: string;
  label: string;
  /** The dot/accent colour used on the timeline and the hero count. */
  dot: string;
}

/** The default "soon" threshold; the user can widen or tighten it in Settings. */
export const DEFAULT_URGENT_DAYS = 7;

/**
 * The urgency ladder, in one place because four surfaces read it — the row
 * chip, the timeline dot, the hero count and the countdown ring — and a
 * receipt that is red on one screen and yellow on the next is worse than
 * either.
 *
 * `expired` has no equivalent in the prototype, whose day-counts were frozen
 * constants that could never reach zero. Real receipts do, and a closed
 * window must say so rather than render "-3 days left".
 */
export function urgency(daysLeft: number, urgentDays: number = DEFAULT_URGENT_DAYS): Urgency {
  if (daysLeft < 0) {
    return { level: 'expired', bg: color.dangerChipBg, fg: color.danger, label: 'window closed', dot: color.dangerDot };
  }
  if (daysLeft <= 3) {
    return {
      level: 'critical',
      bg: color.dangerChipBg,
      fg: color.danger,
      label: daysLeft === 0 ? 'today ⚠' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} ⚠`,
      dot: color.dangerDot,
    };
  }
  if (daysLeft <= urgentDays) {
    return { level: 'soon', bg: color.yellowLight, fg: color.ink, label: `${daysLeft} days left`, dot: color.yellow };
  }
  return { level: 'relaxed', bg: color.creamAlt, fg: color.body, label: `${daysLeft} days left`, dot: color.fainter };
}

/** The hero's headline number and the word beside it. */
export function heroCount(daysLeft: number): { count: string; word: string } {
  if (daysLeft < 0) return { count: 'Gone', word: 'the window closed on your' };
  if (daysLeft === 0) return { count: 'Today', word: 'is the last day to return your' };
  if (daysLeft === 1) return { count: '1', word: 'day left to return your' };
  return { count: String(daysLeft), word: 'days left to return your' };
}
