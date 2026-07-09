/**
 * en-GB formatting — applied at the edge only (DESIGN_SYSTEM.md §3 / CALCULATIONS.md §13).
 * Negative numbers use a true minus sign (−), never a hyphen.
 */

const MINUS = '−';

const gb = (n: number) => Math.round(n).toLocaleString('en-GB');

/** Full money: £625,000 (detailed tables). */
export function formatMoneyFull(pounds: number): string {
  const sign = pounds < 0 ? MINUS : '';
  return `${sign}£${gb(Math.abs(pounds))}`;
}

/** Abbreviated money: £1.24m / £625k. */
export function formatMoney(pounds: number): string {
  const sign = pounds < 0 ? MINUS : '';
  const abs = Math.abs(pounds);
  if (abs >= 1e6) return `${sign}£${(abs / 1e6).toFixed(2)}m`;
  return `${sign}£${gb(abs / 1000)}k`;
}

/** Rent: £1,475 pcm. */
export function formatRent(pcm: number): string {
  return `${formatMoneyFull(pcm)} pcm`;
}

/** Percent: ratios whole (25%), rates one-dp (7.5%). Pass a fraction (0.25). */
export function formatPct(fraction: number, dp = 1): string {
  const v = fraction * 100;
  const sign = v < 0 ? MINUS : '';
  return `${sign}${Math.abs(v).toFixed(dp)}%`;
}

/** Signed delta: +£26k / −£24k / — for zero-ish. */
export function formatDelta(pounds: number): string {
  if (Math.round(pounds) === 0) return '—';
  const abbr = formatMoney(Math.abs(pounds));
  return pounds > 0 ? `+${abbr}` : `${MINUS}${abbr}`;
}

/** Point delta: +4pp. */
export function formatPp(points: number): string {
  if (points === 0) return '—';
  const sign = points > 0 ? '+' : MINUS;
  return `${sign}${Math.abs(points)}pp`;
}

/** Signed full money (prototype fSigned): −£123,456. */
export function formatSigned(pounds: number): string {
  return `${pounds < 0 ? MINUS : ''}£${gb(Math.abs(pounds))}`;
}

/** Pence (bigint or number) → £ number for engine input. */
export function penceToPounds(pence: bigint | number): number {
  return typeof pence === 'bigint' ? Number(pence) / 100 : pence / 100;
}

/** £ → integer pence for the DB/API boundary. */
export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}
