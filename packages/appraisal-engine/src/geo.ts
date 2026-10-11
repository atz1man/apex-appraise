/**
 * How far apart two points on the ground are.
 *
 * This is the engine's because it is a DERIVED QUANTITY printed on more than one
 * surface, which is the rule `one-engine-sweep` keeps. It arrived for the
 * narrower reason recorded in `apps/web/src/lib/comp-proximity.ts`: the
 * Comparables screen's "Evidence quality" panel asserted "Comps within 0.8 mi"
 * and rendered `comps.length / comps.length` — a hardcoded hundred per cent,
 * beside a map that already knew which comparables were located and said so.
 * Nothing in this repository computed a distance at all.
 *
 * Great-circle, not driving distance, and the distinction matters for what the
 * number is FOR: a sales comparison is argued on where the evidence sits
 * relative to the subject, not on how long it takes to drive there, and RICS
 * guidance on comparable evidence is about location rather than journey time. A
 * straight line is also the only one computable from two postcodes with no
 * routing service, which is what this product has.
 */

/** Mean Earth radius in statute miles. */
const EARTH_MILES = 3958.7613;

export type LatLng = { lat: number; lng: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in statute miles.
 *
 * Haversine rather than the spherical law of cosines, which is the same
 * arithmetic rearranged and loses precision at small separations — exactly the
 * range this is used over, where two comparables on the same street are a few
 * hundredths of a mile apart and the answer must not come back zero.
 */
export function distanceMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}
