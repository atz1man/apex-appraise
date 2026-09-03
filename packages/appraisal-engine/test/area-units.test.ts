import { describe, expect, it } from 'vitest';
import { SQFT_PER_SQM, areaIn, cilCharge, formatArea, formatRatePerArea, ratePerAreaIn } from '../src/index.js';

/**
 * Floor area in the unit a jurisdiction quotes it in.
 *
 * Money never changes — every figure this product reports is in pounds — but
 * area does: Australian practice quotes floor areas and rates in square metres
 * without exception. The conversion is here rather than at each of the hundred
 * or so screens that print an area, and these are its boundaries.
 */
describe('floor area in the unit asked for', () => {
  it('leaves square feet alone', () => {
    expect(areaIn(18_800, 'ft²')).toBe(18_800);
    expect(ratePerAreaIn(214, 'ft²')).toBe(214);
    expect(formatArea(18_800, 'ft²')).toBe('18,800 ft²');
    expect(formatRatePerArea(214, 'ft²')).toBe('£214/ft²');
  });

  it('converts areas DOWN and rates UP — the pair, not one of them', () => {
    // the trap: relabelling an area "m²" without dividing overstates a scheme
    // by a factor of ten, and converting the area but not the rate loses the
    // same factor off the value
    expect(areaIn(18_800, 'm²')).toBeCloseTo(1746.56, 2);
    expect(ratePerAreaIn(214, 'm²')).toBeCloseTo(2303.5, 1);
    // and the product of the two is the same money either way, which is the
    // property that actually matters
    expect(areaIn(18_800, 'm²') * ratePerAreaIn(214, 'm²')).toBeCloseTo(18_800 * 214, 6);
  });

  it('formats a converted figure, not a relabelled one', () => {
    expect(formatArea(18_800, 'm²')).toBe('1,747 m²');
    expect(formatRatePerArea(214, 'm²')).toBe('£2,303/m²');
    expect(formatRatePerArea(12.5, 'm²', 2)).toBe('£134.55/m²');
    expect(formatRatePerArea(-214, 'm²')).toBe('−£2,303/m²'); // a true minus, as everywhere else
  });

  it('is the constant the engine levies CIL on, not a second copy of it', () => {
    // `cilCharge` is inside the golden Bournemouth fixture, locked to the penny.
    // If this constant ever drifts from the one the levy uses, a certificate
    // states an area the charge was not computed on.
    expect(SQFT_PER_SQM).toBe(10.764);
    expect(cilCharge(18_800, 40)).toBeCloseTo(40 * areaIn(18_800, 'm²'), 9);
  });

  it('is safe on the degenerate cases a scheme actually produces', () => {
    expect(formatArea(0, 'm²')).toBe('0 m²');
    expect(areaIn(0, 'm²')).toBe(0);
    expect(ratePerAreaIn(0, 'm²')).toBe(0);
  });
});
