import { describe, expect, it } from 'vitest';
import { NEAR_MILES, compProximity, formatMiles, type ProximityComp } from './comp-proximity';

const SUBJECT = { lat: 50.7192, lng: -1.8808 }; // Bournemouth

/** A comparable `miles` roughly west of the subject — longitude only, so the offset is predictable. */
const west = (address: string, miles: number): ProximityComp => ({
  address,
  lat: SUBJECT.lat,
  lng: SUBJECT.lng - miles / (69.17 * Math.cos((SUBJECT.lat * Math.PI) / 180)),
});

const nowhere = (address: string): ProximityComp => ({ address, lat: null, lng: null });

describe('compProximity', () => {
  it('counts what is actually inside the radius', () => {
    const p = compProximity(SUBJECT, [west('A', 0.2), west('B', 0.5), west('C', 4)]);
    expect(p?.value).toBe('2 / 3');
    expect(p?.measured).toBe(true);
    expect(p?.note, 'everything was counted, so there is nothing to caveat').toBeNull();
  });

  /**
   * The defect this module was written for. The old row was
   * `{comps.length} / {comps.length}` — every comparable, always — so a file of
   * evidence twenty miles away read as entirely local on the panel a valuer
   * reads to decide whether it supports the rate.
   */
  it('finds what it is meant to find: evidence that is not near at all', () => {
    const comps = [west('A', 14), west('B', 20), west('C', 31)];
    const p = compProximity(SUBJECT, comps);
    expect(p?.value, 'the old behaviour would be 3 / 3').toBe('0 / 3');
    expect(p?.furthest?.address).toBe('C');
    expect(p?.furthest?.miles).toBeGreaterThan(30);
  });

  /**
   * UNKNOWN IS NOT FAR — the whole reason this is a module. A subject with no
   * usable postcode cannot be measured from, and the obvious implementation
   * (count inside the radius, divide by the total) answers "0 of 5", which a
   * reader takes as "none of your evidence is local". That is the original
   * defect's mirror image: a confident claim about data that does not exist.
   */
  it('refuses to measure when the subject is not located', () => {
    const p = compProximity(null, [west('A', 0.1), west('B', 0.2)]);
    expect(p?.value, 'a ratio here is a claim the data cannot support').toBe('—');
    expect(p?.measured).toBe(false);
    expect(p?.note).toMatch(/subject is not located/i);
    expect(p?.furthest).toBeNull();
  });

  it('says so when no comparable is geolocated, rather than reporting none nearby', () => {
    const p = compProximity(SUBJECT, [nowhere('A'), nowhere('B')]);
    expect(p?.value).toBe('—');
    expect(p?.measured).toBe(false);
    expect(p?.note, 'the distinction is the point').toMatch(/unknown — not far/i);
  });

  /**
   * A PARTIAL measurement names what it left out. Dividing by the full count
   * would quietly score an ungeocoded comparable as distant; dividing by the
   * located ones without saying so hides that the panel is answering about a
   * subset of the file.
   */
  it('counts over the located comparables and names the ones it could not place', () => {
    const p = compProximity(SUBJECT, [west('A', 0.2), nowhere('B'), nowhere('C')]);
    expect(p?.value).toBe('1 / 1');
    expect(p?.note).toMatch(/2 comparables not geolocated/i);
    expect(p?.measured).toBe(true);
  });

  it('writes one comparable in the singular', () => {
    const p = compProximity(SUBJECT, [west('A', 0.2), nowhere('B')]);
    expect(p?.note).toMatch(/^1 comparable not geolocated/);
  });

  /** The boundary itself is INSIDE: a comp at exactly the radius is near, not far. */
  it('treats a comparable exactly on the radius as within it', () => {
    const onIt: ProximityComp = { address: 'On it', lat: SUBJECT.lat, lng: SUBJECT.lng };
    const p = compProximity(SUBJECT, [onIt], 0);
    expect(p?.value).toBe('1 / 1');
  });

  it('says nothing at all when there is no evidence to say it about', () => {
    expect(compProximity(SUBJECT, [])).toBeNull();
    expect(compProximity(null, [])).toBeNull();
  });

  /** The radius the row names and the radius it counts are one constant. */
  it('counts over the radius the label prints', () => {
    const just_in = west('in', NEAR_MILES - 0.05);
    const just_out = west('out', NEAR_MILES + 0.05);
    expect(compProximity(SUBJECT, [just_in, just_out])?.value).toBe('1 / 2');
  });
});

describe('formatMiles', () => {
  /** Below a tenth of a mile "0.0 mi" reads as no distance at all. */
  it('does not print a real separation as zero', () => {
    expect(formatMiles(0.04)).toBe('<0.1 mi');
    expect(formatMiles(0)).toBe('<0.1 mi');
  });

  it('prints one decimal above that', () => {
    expect(formatMiles(0.8)).toBe('0.8 mi');
    expect(formatMiles(14.26)).toBe('14.3 mi');
  });
});
