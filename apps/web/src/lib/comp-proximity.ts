import { distanceMiles, type LatLng } from '@apex/appraisal-engine';

/**
 * What the Comparables screen may say about how close its evidence is.
 *
 * Measured on the demo workspace: the "Evidence quality" panel — the panel a
 * valuer reads to decide whether the evidence supports the rate they are about
 * to sign — printed the row "Comps within 0.8 mi" as `{comps.length} /
 * {comps.length}`. Every comparable, always, on every deal. Nothing in the
 * repository computed a distance at all; `distanceMiles` was written for this.
 *
 * It is not a cosmetic figure. Proximity is the first thing comparable evidence
 * is argued on, the adjustment grid has a Location column precisely because
 * distance has to be priced, and the panel sat two inches under a map that
 * already knew which comparables were located and said "3 of 5 geolocated". So
 * the screen held the facts, drew them, and asserted something else beside them.
 *
 * THE JUDGEMENT WITH BOUNDARIES, and the reason this is a module rather than a
 * line in the route: **unknown is not far.** The obvious fix counts the comps
 * inside the radius and divides by the total, and that is wrong in the two
 * states where a distance cannot be had — a subject with no usable postcode, and
 * a comparable nobody has geocoded. Both come out as "0 of 5 within 0.8 mi",
 * which a reader takes as "none of your evidence is local" and which is the
 * original defect's mirror image: a confident claim about data that does not
 * exist. Each of those states says what it does not know instead, and a partial
 * measurement names the comparables it left out rather than quietly averaging
 * them in as distant.
 *
 * Deliberately NOT done: folding this into the confidence badge beside it. The
 * grid already has `adjLocation`, where the valuer prices location themselves;
 * a product that asks for that judgement and then silently re-scores it has
 * taken the same fact into account twice, once without saying so.
 */

/** The radius the row has always named. One constant, so the label and the maths cannot disagree. */
export const NEAR_MILES = 0.8;

export type ProximityComp = { address: string; lat?: number | null; lng?: number | null };

export type CompProximity = {
  /** The figure on the right of the row. Never a ratio the data cannot support. */
  value: string;
  /** What the figure does not cover — null only when it covers every comparable. */
  note: string | null;
  /** The furthest located comparable: the outlier a valuer is looking for. */
  furthest: { address: string; miles: number } | null;
  /** False when no distance could be computed at all, so the caller can mute the row. */
  measured: boolean;
};

/** A tenth of a mile is the floor worth printing; below it "0.0 mi" reads as no distance at all. */
export const formatMiles = (m: number): string => (m < 0.1 ? '<0.1 mi' : `${m.toFixed(1)} mi`);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function compProximity(
  subject: LatLng | null,
  comps: readonly ProximityComp[],
  radius = NEAR_MILES,
): CompProximity | null {
  if (comps.length === 0) return null;

  if (!subject) {
    return {
      value: '—',
      note: 'The subject is not located, so no distance can be measured. Add the site postcode on the Site pack.',
      furthest: null,
      measured: false,
    };
  }

  const located = comps.flatMap((c) =>
    c.lat != null && c.lng != null
      ? [{ address: c.address, miles: distanceMiles(subject, { lat: c.lat, lng: c.lng }) }]
      : [],
  );
  const unlocated = comps.length - located.length;

  if (located.length === 0) {
    return {
      value: '—',
      note: `None of the ${comps.length} comparables are geolocated, so their distance from the subject is unknown — not far.`,
      furthest: null,
      measured: false,
    };
  }

  const within = located.filter((c) => c.miles <= radius).length;
  const furthest = located.reduce((a, b) => (b.miles > a.miles ? b : a));

  return {
    value: `${within} / ${located.length}`,
    note:
      unlocated > 0
        ? `${plural(unlocated, 'comparable', 'comparables')} not geolocated and left out of this count — distance unknown, not far.`
        : null,
    furthest,
    measured: true,
  };
}
