import { SQFT_PER_SQM, areaIn, formatArea, formatRatePerArea, ratePerAreaIn } from '@apex/appraisal-engine';
import { regionProfile, type RegionProfile } from '@apex/types/regions';
import { trpc } from './trpc';
import { n0 } from './format';

/**
 * The firm's jurisdiction, for a screen that prints an area or names a yield.
 *
 * WORDS AND UNITS ONLY. Money is always pounds and no figure is computed
 * differently — the engine is the engine wherever the firm is. What changes is
 * that an Australian valuer reads square metres and a "terminal yield", and an
 * American reads "cap rate" and "gross sellout", instead of a screen that only
 * knows how to be British.
 *
 * It hangs off `org.policy`, which is the firm's house style and is already
 * fetched by the report and terms surfaces; React Query dedupes it to one
 * request per screen and it is held stale for five minutes, because a setting
 * an admin changes twice a year does not need refetching on every focus.
 *
 * Internal surfaces only. `org.policy` is an internal procedure, so the buyer
 * and investor portals cannot call this — which costs nothing today, because
 * neither portal prints a floor area.
 */
export function useRegion(): RegionProfile {
  const { data } = trpc.org.policy.useQuery(undefined, { staleTime: 5 * 60_000 });
  return regionProfile(data?.region);
}

export interface RegionUnits {
  profile: RegionProfile;
  /** 'ft²' | 'm²' — for a column heading, where the number is in the cell below */
  unit: string;
  /**
   * 'sq ft' | 'sq m' — the same unit for a screen reader and for prose.
   * A superscript two is read aloud as "squared" at best and skipped at worst,
   * so an aria-label saying "area ft²" is worse than one saying "area sq ft".
   */
  unitSpoken: string;
  /** the words: yield, GDV, NOI, SDLT, CIL — see `@apex/types/regions` */
  terms: RegionProfile['terms'];
  /** "18,800 ft²" */
  area: (sqft: number) => string;
  /** "18,800" — the number alone, for a cell under a unit-bearing heading */
  areaNum: (sqft: number) => string;
  /** "£214/ft²" */
  rate: (perSqft: number, dp?: number) => string;
  /** "214" — the number alone */
  rateNum: (perSqft: number, dp?: number) => string;

  /**
   * An EDITABLE area or rate, and the way back.
   *
   * A field a valuer types into has to round-trip: what they type is what the
   * scheme holds. Areas are stored in square feet whatever the firm reads, so a
   * metric firm's input is converted on the way in and on the way out, and the
   * displayed value is rounded to what a person would actually type — two
   * decimals for both an area in m² and a rate in £/m².
   *
   * That rounding is not free, and the size of it is the reason for two
   * decimals rather than one. RETYPING a converted figure unchanged does not
   * give back the identical money: 5,000 ft² at £15/ft² is £75,000, and the
   * same scheme retyped as 464.51 m² at £161.46/m² is £74,999.78. Measured, at
   * one decimal it is £74,998.17 — a drift of £1.83 rather than 22p. It only
   * happens where a valuer actually edits the field, and then their figure is
   * the truth; it is a rounding a metric valuer would make on paper too.
   *
   * In square feet BOTH functions are the identity, with no rounding at all: a
   * British firm's every stored figure is untouched by this, which is the
   * property that makes the change safe.
   */
  areaField: (sqft: number) => number;
  areaFromField: (shown: number) => number;
  rateField: (perSqft: number) => number;
  rateFromField: (shown: number) => number;
}

/**
 * Areas, rates and the words, ready to print.
 *
 * One object rather than a set of loose calls so a screen cannot half-convert
 * itself: the failure mode that matters here is a page showing an area in
 * square metres beside a rate still per square foot, which is not a smaller
 * version of the feature but a wrong number on a valuation.
 *
 * Pure, and separate from the hook, so its boundaries can be tested — the
 * round trip through an editable field above all.
 */
export function unitsFor(profile: RegionProfile): RegionUnits {
  const u = profile.areaUnit;
  return {
    profile,
    unit: u,
    unitSpoken: u === 'm²' ? 'sq m' : 'sq ft',
    terms: profile.terms,
    area: (sqft) => formatArea(sqft, u),
    areaNum: (sqft) => n0(areaIn(sqft, u)),
    rate: (perSqft, dp) => formatRatePerArea(perSqft, u, dp),
    rateNum: (perSqft, dp) => (dp && dp > 0 ? ratePerAreaIn(perSqft, u).toFixed(dp) : n0(ratePerAreaIn(perSqft, u))),
    areaField: (sqft) => (u === 'm²' ? Math.round(areaIn(sqft, u) * 100) / 100 : sqft),
    areaFromField: (shown) => (u === 'm²' ? shown * SQFT_PER_SQM : shown),
    rateField: (perSqft) => (u === 'm²' ? Math.round(ratePerAreaIn(perSqft, u) * 100) / 100 : perSqft),
    rateFromField: (shown) => (u === 'm²' ? shown / SQFT_PER_SQM : shown),
  };
}

/** The same, for the firm this browser is signed in to. */
export function useUnits(): RegionUnits {
  return unitsFor(useRegion());
}
