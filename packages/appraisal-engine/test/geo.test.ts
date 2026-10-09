import { describe, expect, it } from 'vitest';
import { distanceMiles } from '../src/index.js';

/**
 * Distance is checked against KNOWN separations, not against itself.
 *
 * A haversine is four lines and every wrong version of it is also four lines —
 * degrees where radians belong, a missing `cos(lat)` on the longitude term, the
 * wrong Earth radius — and each produces a plausible number rather than an
 * error. So every case here is a pair whose real separation is published, with a
 * tolerance tight enough to fail each of those mistakes.
 */

const LONDON = { lat: 51.5074, lng: -0.1278 };   // Charing Cross
const EDINBURGH = { lat: 55.9533, lng: -3.1883 };
const BOURNEMOUTH = { lat: 50.7192, lng: -1.8808 };
const POOLE = { lat: 50.7150, lng: -1.9872 };

describe('distanceMiles', () => {
  /** ~332 statute miles; a degrees-for-radians slip lands nowhere near it. */
  it('agrees with a published long separation', () => {
    expect(distanceMiles(LONDON, EDINBURGH)).toBeCloseTo(331.6, 0);
  });

  /**
   * Bournemouth to Poole is about 4.7 miles, and it is almost due WEST — so the
   * separation is carried by the longitude term, where dropping `cos(lat)`
   * inflates it by about a third (4.7 → 7.4). That is the mutant this case is
   * here for; the long pair above survives it far less visibly.
   */
  it('scales the longitude term by latitude', () => {
    expect(distanceMiles(BOURNEMOUTH, POOLE)).toBeCloseTo(4.7, 1);
  });

  it('is zero for a point against itself, and never NaN', () => {
    expect(distanceMiles(LONDON, LONDON)).toBe(0);
    expect(Number.isFinite(distanceMiles(LONDON, { ...LONDON }))).toBe(true);
  });

  it('is symmetric', () => {
    expect(distanceMiles(LONDON, BOURNEMOUTH)).toBeCloseTo(distanceMiles(BOURNEMOUTH, LONDON), 10);
  });

  /**
   * The range this is actually used over: two comparables on the same street.
   * The spherical law of cosines loses precision here and can answer 0 for a
   * real separation — a comparable next door must not read as the subject.
   */
  it('resolves a separation of a few hundred feet', () => {
    const a = { lat: 50.7192, lng: -1.8808 };
    const b = { lat: 50.7192, lng: -1.8790 }; // ~0.078 mi east
    const d = distanceMiles(a, b);
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.1);
  });

  /** Antipodal points clamp rather than producing NaN out of a sqrt rounding past 1. */
  it('clamps at the far side of the world instead of answering NaN', () => {
    const d = distanceMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(Math.PI * 3958.7613, 0);
  });
});
