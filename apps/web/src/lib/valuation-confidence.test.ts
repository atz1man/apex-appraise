import { describe, expect, it } from 'vitest';
import { valuationConfidence } from './valuation-confidence';

/**
 * What a signed valuation is entitled to claim about its own certainty.
 *
 * With no comparables on file the certificate printed an "Indicated value
 * range" of ±2.5% of GDV — a band as tight as a well-evidenced valuation's, and
 * typeset identically to one — and stated that confidence was "assessed as
 * medium under the RICS confidence framework". Neither had anything behind it.
 *
 * `238d265` already fixed this report's sibling claim, where the narrative
 * declared an evidence base "adequate for the class" on any comparable count
 * above zero. A reader who cannot tell a supported figure from an unsupported
 * one cannot discount it, which is what makes this worse than saying nothing.
 */

const withComps = {
  marketValue: 3_150_000,
  compRange: { lo: 380, hi: 440 },
  netInternalArea: 7_500,
  avgGrossAdjustment: 6.2,
  compCount: 4,
};

describe('with comparable evidence', () => {
  it('takes the range from the comparables, not from a percentage of the answer', () => {
    const v = valuationConfidence(withComps);
    expect(v.range).toEqual({ lo: 2_850_000, hi: 3_300_000 });
  });

  it('grades on how far the comparables had to be adjusted', () => {
    expect(valuationConfidence(withComps).confidence).toBe('High');
    expect(valuationConfidence({ ...withComps, avgGrossAdjustment: 11 }).confidence).toBe('Medium');
    expect(valuationConfidence({ ...withComps, avgGrossAdjustment: 18 }).confidence).toBe('Low');
  });

  it('places the opinion inside its own range, and never off the end of the bar', () => {
    expect(valuationConfidence(withComps).marker).toBeGreaterThan(5);
    expect(valuationConfidence(withComps).marker).toBeLessThan(95);
    // an opinion below its own evidence range still renders on the bar
    const below = valuationConfidence({ ...withComps, marketValue: 1_000_000 });
    expect(below.marker).toBe(5);
  });

  it('says what the grade rests on', () => {
    expect(valuationConfidence(withComps).note).toContain('4 comparable sales');
    expect(valuationConfidence({ ...withComps, compCount: 1 }).note).toContain('1 comparable sale');
  });
});

describe('with no comparable evidence', () => {
  const none = { ...withComps, compRange: null, compCount: 0 };

  it('states no range at all, rather than one derived from the answer', () => {
    const v = valuationConfidence(none);
    expect(v.range, 'a range was printed with nothing supporting it').toBeNull();
    expect(v.marker).toBeNull();
  });

  it('withholds the confidence grade rather than asserting one', () => {
    const v = valuationConfidence(none);
    expect(v.confidence, 'a RICS confidence grade was asserted with no market evidence').toBeNull();
    expect(v.note).toMatch(/no comparable evidence/i);
    expect(v.note).not.toMatch(/\b(high|medium|low)\b/i);
  });

  it('withholds it for a comparable set that cannot produce a range either', () => {
    // a floor area of zero cannot turn £/ft² into a value, so the range it
    // would produce is not evidence of anything
    expect(valuationConfidence({ ...withComps, netInternalArea: 0 }).confidence).toBeNull();
  });
});
