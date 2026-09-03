/**
 * en-GB formatting — applied at the edge only (DESIGN_SYSTEM.md §3 / CALCULATIONS.md §13).
 * Negative numbers use a true minus sign (−), never a hyphen.
 *
 * Money is always pounds. Floor AREA is not always square feet — Australian
 * practice quotes areas and rates in square metres without exception — so the
 * area helpers at the foot of this file take the unit and do the conversion,
 * rather than each screen dividing by a constant of its own.
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

// ---- Floor area ------------------------------------------------------------

/**
 * The conversion, once.
 *
 * It was written twice at the same value: in `engine.ts`, where `cilCharge`
 * turns a GIA in square feet into the square metres CIL is levied on, and again
 * in `RedBookReport.tsx`, which prints both units on the certificate. Two copies
 * of a constant is not a defect until one of them is corrected — 10.764 is
 * itself a rounding of 10.7639104 — and then a certificate states an area the
 * levy was not computed on.
 *
 * The value is the ENGINE'S, unchanged, and it must stay that way: the golden
 * Bournemouth fixture is locked to the penny through `cilCharge`, and a more
 * precise constant is a different CIL charge and a different residual. Making it
 * exact is a change to the arithmetic and belongs with a version bump, not here.
 */
export const SQFT_PER_SQM = 10.764;

/** The unit a jurisdiction quotes floor areas in — see `@apex/types/regions`. */
export type AreaUnit = 'ft²' | 'm²';

/** A square-foot area in the unit asked for. */
export function areaIn(sqft: number, unit: AreaUnit): number {
  return unit === 'm²' ? sqft / SQFT_PER_SQM : sqft;
}

/**
 * A rate per square foot in the unit asked for.
 *
 * Note the direction, which is the opposite of the area's. A square metre is
 * the BIGGER unit, so the same floorspace is a smaller NUMBER of them and each
 * one costs more: areas divide, rates multiply. Getting the pair backwards is
 * wrong by a factor of 116 and reads as a typo rather than a bug, which is why
 * it is written down once instead of at each site.
 */
export function ratePerAreaIn(perSqft: number, unit: AreaUnit): number {
  return unit === 'm²' ? perSqft * SQFT_PER_SQM : perSqft;
}

/** "18,800 ft²" / "1,747 m²". */
export function formatArea(sqft: number, unit: AreaUnit): string {
  return `${gb(areaIn(sqft, unit))} ${unit}`;
}

/** "£214/ft²" / "£2,303/m²" — the rate converted, not just relabelled. */
export function formatRatePerArea(perSqft: number, unit: AreaUnit, dp = 0): string {
  const v = ratePerAreaIn(perSqft, unit);
  const sign = v < 0 ? MINUS : '';
  const abs = Math.abs(v);
  return `${sign}£${dp > 0 ? abs.toFixed(dp) : gb(abs)}/${unit}`;
}
