import { describe, expect, it } from 'vitest';
import { situationStatement } from './situation';

/**
 * A signed valuation contradicting itself two pages apart.
 *
 * The certificate disclosed "No inspection is recorded for this property" while
 * the situation panel reported what had been noted on that inspection, and the
 * declaration page assumed the flood position while the situation panel stated
 * it as identified. Both halves were fixed prose, printed for every property.
 */

const nothing = { address: 'West Quay Road, Poole', inspectedOn: null };

describe('with no inspection on file', () => {
  it('does not report what was found on one', () => {
    const s = situationStatement(nothing);
    expect(s, 'the report claimed an inspection finding with no inspection recorded').not.toMatch(/noted on inspection/i);
    expect(s).toMatch(/no inspection is recorded/i);
  });

  it('never names a flood zone nothing checked', () => {
    expect(situationStatement(nothing), 'a flood zone classification was asserted').not.toMatch(/flood zone/i);
  });

  it('refers the flood position to the assumptions, where the report already states it', () => {
    expect(situationStatement(nothing)).toMatch(/flood risk[^.]*general assumptions/i);
  });
});

describe('with an inspection on file', () => {
  const inspected = { ...nothing, inspectedOn: '14 July 2026' };

  it('says it was inspected, and when', () => {
    expect(situationStatement(inspected)).toContain('inspected on 14 July 2026');
  });

  it('still does not put environmental findings into the valuer_s mouth', () => {
    /**
     * An inspection record holds rooms, conditions and notes. It holds nothing
     * about contamination, ground stability or flood, so having attended is not
     * evidence that those were looked at.
     */
    const s = situationStatement(inspected);
    expect(s).not.toMatch(/no adverse environmental factors/i);
    expect(s).not.toMatch(/flood zone/i);
  });

  it('reads the same signal the certificate does, so the two pages cannot disagree', () => {
    /**
     * The certificate's "Inspection date" panel prints `dates.inspection` or
     * discloses the gap. Taking the same value here is what makes "no
     * inspection is recorded" and "was inspected on" impossible to print in
     * the same document.
     */
    expect(situationStatement({ ...inspected, inspectedOn: null })).toMatch(/no inspection is recorded/i);
  });
});

it('still stands up with no address', () => {
  expect(situationStatement({ ...nothing, address: null })).toContain('on the subject site');
  expect(situationStatement({ ...nothing, address: '   ' })).toContain('on the subject site');
});
