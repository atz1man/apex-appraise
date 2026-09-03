import { describe, expect, it } from 'vitest';
import { REGIONS, REGION_PROFILES, regionProfile } from '@apex/types/regions';
import { unitsFor } from './region';

/**
 * What a jurisdiction calls things, and the unit it quotes floor areas in.
 *
 * The scope is words and units. Money never changes — a figure is in pounds
 * whichever region is set — and neither does any arithmetic. These are the
 * boundaries where that promise could quietly stop being true.
 */
describe('the region profiles', () => {
  it('gives every region a full vocabulary, so no screen falls back to a blank', () => {
    for (const code of REGIONS) {
      const p = REGION_PROFILES[code];
      expect(p.code).toBe(code);
      expect(p.label.length).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(p.terms)) {
        expect(v.length, `${code}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('claims the SDLT bands and the Red Book only for the UK', () => {
    // the engine's `sdltCommercial` is England & NI statute, and the certificate
    // quotes RICS VPS 4 and names a Registered Valuer. Relabelling either for a
    // region this product has not been written for is the one mistake here that
    // could not be walked back.
    expect(REGION_PROFILES.GB.landTaxModelled).toBe(true);
    expect(REGION_PROFILES.GB.redBook).toBe(true);
    for (const code of REGIONS.filter((c) => c !== 'GB')) {
      expect(REGION_PROFILES[code].landTaxModelled, code).toBe(false);
      expect(REGION_PROFILES[code].redBook, code).toBe(false);
    }
  });

  it('says the words each jurisdiction actually uses', () => {
    expect(REGION_PROFILES.GB.terms.yield).toBe('Yield');
    expect(REGION_PROFILES.GB.terms.gdv).toBe('GDV');
    expect(REGION_PROFILES.GB.terms.landTax).toBe('SDLT');
    // "GDV" and "all-risks yield" are not terms of art in the United States
    expect(REGION_PROFILES.US.terms.yield).toBe('Cap rate');
    expect(REGION_PROFILES.US.terms.gdv).toBe('Gross sellout');
    // Australian vocabulary is UK-descended but not UK
    expect(REGION_PROFILES.AU.terms.gdv).toBe('GRV');
    expect(REGION_PROFILES.AU.terms.exitYield).toBe('Terminal yield');
  });

  it('changes the unit for Australia only', () => {
    expect(REGION_PROFILES.GB.areaUnit).toBe('ft²');
    expect(REGION_PROFILES.US.areaUnit).toBe('ft²');
    expect(REGION_PROFILES.AU.areaUnit).toBe('m²');
  });

  it('falls back to the UK for a workspace that has never chosen', () => {
    expect(regionProfile(undefined).code).toBe('GB');
    expect(regionProfile(null).code).toBe('GB');
    expect(regionProfile('').code).toBe('GB');
    expect(regionProfile('ZZ').code).toBe('GB');
  });
});

describe('printing an area', () => {
  const gb = unitsFor(REGION_PROFILES.GB);
  const au = unitsFor(REGION_PROFILES.AU);

  it('leaves a UK firm exactly where it was — the same strings, to the character', () => {
    expect(gb.unit).toBe('ft²');
    expect(gb.area(18_800)).toBe('18,800 ft²');
    expect(gb.areaNum(18_800)).toBe('18,800');
    expect(gb.rate(214)).toBe('£214/ft²');
    expect(gb.rateNum(214)).toBe('214');
    expect(gb.rateNum(12.5, 2)).toBe('12.50');
  });

  it('converts the pair for a metric firm, never one of them', () => {
    expect(au.unit).toBe('m²');
    expect(au.area(18_800)).toBe('1,747 m²');
    expect(au.rate(214)).toBe('£2,303/m²');
  });
});

describe('an area a valuer can edit', () => {
  const gb = unitsFor(REGION_PROFILES.GB);
  const au = unitsFor(REGION_PROFILES.AU);

  it('does not touch a UK firm\'s stored figures at all — both ways are the identity', () => {
    // this is the property that makes the change safe: no rounding, no
    // conversion, no drift for the firms already using the product
    for (const v of [0, 1, 5000, 18_800, 12.5, 1234.5678]) {
      expect(gb.areaField(v)).toBe(v);
      expect(gb.areaFromField(v)).toBe(v);
      expect(gb.rateField(v)).toBe(v);
      expect(gb.rateFromField(v)).toBe(v);
    }
  });

  it('round-trips what a metric valuer types, to the precision they typed it', () => {
    // they see 464.5, they type 464.5, the scheme holds 464.5 m² of floorspace
    const shown = au.areaField(5000);
    expect(shown).toBe(464.51);
    expect(au.areaField(au.areaFromField(shown))).toBe(shown);
    const rate = au.rateField(15);
    expect(rate).toBe(161.46);
    expect(au.rateField(au.rateFromField(rate))).toBe(rate);
  });

  it('costs a rounding when a converted figure is retyped, and a small one', () => {
    // 5,000 ft² at £15/ft² is £75,000. The same scheme retyped as 464.51 m² at
    // £161.46/m² is £74,999.78 — 22p, because the displayed field carries two
    // decimals. At ONE decimal the same round trip loses £1.83, which is why it
    // carries two. Nothing drifts unless a valuer edits the field, and then the
    // figure they typed is the scheme's figure.
    const area = au.areaFromField(au.areaField(5000));
    const rent = au.rateFromField(au.rateField(15));
    expect(area * rent).toBeCloseTo(74_999.78, 2);
    expect(Math.abs(area * rent - 75_000)).toBeLessThan(0.5);
  });

  it('holds zero at zero, which is what an empty field parses to', () => {
    expect(au.areaField(0)).toBe(0);
    expect(au.areaFromField(0)).toBe(0);
    expect(au.rateFromField(0)).toBe(0);
  });
});
