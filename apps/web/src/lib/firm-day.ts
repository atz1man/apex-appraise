import { DOC_TIMEZONE } from '../components/paper';

/**
 * Which day a stored date falls on, decided in the firm's timezone.
 *
 * A task due date is a CALENDAR DATE, not an instant. The picker sends
 * `2026-06-30`, and `tasks.create` stores `new Date(input.due)` — which parses a
 * date-only string as UTC midnight, `2026-06-30T00:00:00.000Z`. That is the
 * ordinary way to hold a date-only value in a DateTime column and it is not the
 * problem.
 *
 * The problem was reading it back with the reader's own clock. Calendar.tsx
 * bucketed and compared with local `getFullYear/getMonth/getDate`, under a
 * header comment declaring the convention: "all local-time; en-GB". Measured:
 *
 *     user picks       2026-06-30
 *     API stores       2026-06-30T00:00:00.000Z
 *
 *     TZ=Europe/London     grid renders on 2026-06-30   overdue? false
 *     TZ=America/New_York  grid renders on 2026-06-29   overdue? true
 *
 * So west of Greenwich every task sat one square early and a task due TODAY
 * showed as overdue. In the UK the two agree, which is why it survived.
 *
 * `paper.tsx` already decided this question for the printed documents and wrote
 * down the reasoning: Europe/London "because the figures, the conventions and
 * the regulator are all UK — a report produced at 00:30 BST on the 5th is dated
 * the 5th, which is the day the valuer would say they produced it." A UK firm's
 * task is due on a UK day for the same reason, so this screen now follows the
 * decision the documents already follow rather than a second one.
 *
 * Everything here works in 'YYYY-MM-DD' keys rather than timestamps. They
 * compare chronologically as plain strings, and a key carries no time of day for
 * a zone to shift.
 */

const KEY_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: DOC_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'YYYY-MM-DD' for the day `d` falls on in the firm's timezone. */
export function firmDayKey(d: Date | string): string {
  const parts = KEY_PARTS.formatToParts(new Date(d));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today, in the firm's timezone. Injectable so a test does not depend on the day it runs. */
export const firmToday = (now: Date = new Date()) => firmDayKey(now);

/** 'Mon 30 Jun' — the due-date label, in the same timezone it was bucketed by. */
const LABEL = new Intl.DateTimeFormat('en-GB', {
  timeZone: DOC_TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
export const firmDayLabel = (d: Date | string) => LABEL.format(new Date(d));

/** Build a key from the parts of a month grid, with no Date in the way. */
export const keyOf = (year: number, month1: number, day: number) =>
  `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The year and 0-based month a key belongs to, for the grid's own arithmetic. */
export function viewOf(key: string): { y: number; m: number } {
  const [y, m] = key.split('-').map(Number);
  return { y: y!, m: m! - 1 };
}

/** Whole days from `from` to `to`, both keys. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const at = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

export interface DueTask {
  done: boolean;
  due: Date | null;
}

/**
 * Split open tasks into the four buckets the task board shows.
 *
 * Lifted out of the component because this is the judgement the timezone bug
 * actually corrupted — "overdue" and "due today" are decisions, and a decision
 * living inside a 460-line screen is one nothing can test at its boundaries. A
 * task with no due date is not late; it groups last, which is what `Infinity`
 * stands in for.
 */
export function groupByDue<T extends DueTask>(tasks: T[], todayKey: string) {
  const open = tasks.filter((t) => !t.done);
  const away = (t: T) => (t.due ? daysBetween(todayKey, firmDayKey(t.due)) : Infinity);
  const byDue = (a: T, b: T) => away(a) - away(b);
  return {
    overdue: open.filter((t) => away(t) < 0).sort(byDue),
    dueToday: open.filter((t) => away(t) === 0),
    thisWeek: open.filter((t) => away(t) > 0 && away(t) <= 7).sort(byDue),
    later: open.filter((t) => away(t) > 7).sort(byDue),
    done: tasks.filter((t) => t.done),
  };
}
