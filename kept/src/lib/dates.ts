/**
 * Whole-day arithmetic in the user's own timezone.
 *
 * A return deadline is a CALENDAR fact, not a 24-hour countdown: a receipt
 * bought at 23:50 on the 1st with a 14-day window is returnable all of the
 * 15th, and "1 day left" must not flip to "0" because the phone clock passed
 * an arbitrary hour. So every function here collapses to local midnight first
 * and counts date boundaries crossed — and rounds, because a DST transition
 * makes one of those "days" 23 or 25 hours long and a truncating divide would
 * silently lose a day each spring.
 */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_PER_DAY);
}

export function addDays(d: Date, n: number): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** ISO calendar date (YYYY-MM-DD) — how a receipt's dates are stored. */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Parse a stored ISO date as LOCAL midnight. `new Date('2026-08-28')` parses
 * as UTC midnight, which is the previous day everywhere west of Greenwich —
 * that alone would show a UK user the wrong number of days left.
 */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** en-GB short form, as the design shows it: "5 Sep". */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** en-GB long form for legal copy: "5 September 2026". */
export function fmtDateLong(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * "2d ago" / "1w ago" / "3mo ago" — the compact form the policy feed uses.
 * Deliberately coarse: the exact hour a retailer edited its terms is noise,
 * and a chip that reads "47h ago" invites the reader to do arithmetic the
 * label exists to save them.
 */
export function relativeAgo(then: Date, today: Date): string {
  const days = daysBetween(then, today);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Add whole months, clamping to the end of the target month.
 *
 * Warranties are quoted in months and years, never days, and the naive
 * `setMonth(m + n)` overflows: 31 January plus one month becomes 3 March,
 * which would hand someone two days of cover they do not have. The last day
 * of a short month is the honest answer.
 */
export function addMonths(d: Date, months: number): Date {
  const start = startOfDay(d);
  const day = start.getDate();
  const out = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const lastDayOfTarget = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDayOfTarget));
  return out;
}

/**
 * Short form, with the year only when it is not this year.
 *
 * IKEA's 365-day window puts the deadline a year out, and "bought 14 Feb ·
 * return by 14 Feb" reads as the same day when it is twelve months apart. The
 * year earns its space exactly when it disambiguates, and not otherwise.
 */
export function fmtDateNear(d: Date, today: Date): string {
  return d.getFullYear() === today.getFullYear() ? fmtDate(d) : `${fmtDate(d)} ${d.getFullYear()}`;
}
