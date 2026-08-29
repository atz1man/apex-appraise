import { describe, expect, it } from 'vitest';
import { dpi, weightedIrr } from '../src/lp.js';

/**
 * The two numbers an LP looks at first, which were constants.
 */

describe('DPI', () => {
  it('is cash back per pound drawn', () => {
    // the measured case: this LP was shown 1.42×
    expect(dpi(2_640_000, 3_788_400)).toBeCloseTo(0.6969, 4);
  });

  it('is null before anything is called, not zero', () => {
    // 0.00× beside "Distributed £0" reads as a loss; there is simply no ratio yet
    expect(dpi(0, 0)).toBeNull();
    expect(dpi(500_000, 0)).toBeNull();
  });

  it('passes one when the money is exactly back', () => {
    expect(dpi(1_000_000, 1_000_000)).toBe(1);
  });
});

describe('the portfolio IRR', () => {
  it('weights by capital, not by deal count', () => {
    // £3m at 10% and £1m at 30% is 15%, not the 20% a plain average gives
    expect(weightedIrr([
      { committed: 3_000_000, irr: 0.1 },
      { committed: 1_000_000, irr: 0.3 },
    ])).toBeCloseTo(0.15, 10);
  });

  it('leaves out a deal with nothing recorded rather than counting it as zero', () => {
    /**
     * The measured portfolio: two realised schemes at 23.1% and 19.8%, and
     * Harbour Reach still in construction with no IRR. Counting the third as 0%
     * would report roughly 12% for an investor whose realised deals both
     * returned around 20%.
     */
    const withUnrealised = weightedIrr([
      { committed: 2_585_000, irr: 0 },
      { committed: 1_155_000, irr: 0.231 },
      { committed: 880_000, irr: 0.198 },
    ]);
    const realisedOnly = weightedIrr([
      { committed: 1_155_000, irr: 0.231 },
      { committed: 880_000, irr: 0.198 },
    ]);
    expect(withUnrealised).toBe(realisedOnly);
    expect(withUnrealised!).toBeGreaterThan(0.2);
  });

  it('is null when nothing has returned yet, so the page can say so', () => {
    expect(weightedIrr([{ committed: 1_000_000, irr: 0 }])).toBeNull();
    expect(weightedIrr([])).toBeNull();
  });

  /**
   * Note what this does and does not prove. Deleting the `h.committed > 0`
   * clause from the filter leaves every result below unchanged — a zero-capital
   * holding contributes zero to the numerator and zero to the denominator, and
   * an all-zero portfolio is caught by the `capital <= 0` guard underneath. The
   * clause is a readable statement of intent, not load-bearing, and this case
   * holds the ARITHMETIC (weights, not counts) rather than the clause. It is
   * left here labelled rather than deleted so nobody reads it as cover for a
   * guard it cannot fail on.
   */
  it('ignores a holding with no capital behind it', () => {
    expect(weightedIrr([
      { committed: 0, irr: 0.9 },
      { committed: 1_000_000, irr: 0.2 },
    ])).toBeCloseTo(0.2, 10);
  });

  /**
   * Absence is not zero — and a bad number is not an absence.
   *
   * The filter read `h.irr > 0`, which drops a recorded LOSS along with the
   * unrecorded holdings it was written to drop, so the portfolio figure was an
   * average over the winners. These cases pin both halves of the distinction at
   * once, because `> 0` and `!== 0` differ only on the negative: the unrecorded
   * case above must keep passing, and the loss must now count.
   */
  it('counts a recorded loss instead of deleting it', () => {
    const half = weightedIrr([
      { committed: 1_000_000, irr: 0.23 },
      { committed: 1_000_000, irr: -0.4 },
    ]);
    // equal capital either side: the honest answer is the midpoint, and it is
    // negative. Reporting +23% here is reporting the portfolio without its loss.
    expect(half).toBeCloseTo((0.23 - 0.4) / 2, 10);
    expect(half!).toBeLessThan(0);
  });

  it('lets a loss drag the portfolio down in proportion to its capital', () => {
    const small = weightedIrr([
      { committed: 3_000_000, irr: 0.2 },
      { committed: 1_000_000, irr: -0.4 },
    ])!;
    const large = weightedIrr([
      { committed: 1_000_000, irr: 0.2 },
      { committed: 3_000_000, irr: -0.4 },
    ])!;
    // same two deals, capital swapped: weighting must move the answer, and a
    // filter that dropped the loss would return 0.2 for both
    expect(small).toBeCloseTo(0.05, 10);
    expect(large).toBeCloseTo(-0.25, 10);
    expect(small).toBeGreaterThan(large);
  });

  it('reports a portfolio that is nothing but losses', () => {
    const all = weightedIrr([
      { committed: 2_000_000, irr: -0.15 },
      { committed: 1_000_000, irr: -0.6 },
    ])!;
    // not null, and not zero: the money is gone and the page must be able to
    // say so. Null here would read as "nothing recorded yet".
    expect(all).toBeCloseTo(-0.3, 10);
  });

  /**
   * The limitation this fix does NOT paper over. `Holding.irr` is
   * `Float @default(0)`, so a deal that genuinely returned exactly 0.0% cannot
   * be told apart from one nobody has entered, and is excluded. Pinned here so
   * the behaviour is a documented consequence of the column rather than a
   * surprise, and so that making the column nullable one day has a test to
   * change deliberately.
   */
  it('still cannot see a deal that returned exactly nothing', () => {
    expect(weightedIrr([
      { committed: 1_000_000, irr: 0 },
      { committed: 1_000_000, irr: 0.2 },
    ])).toBeCloseTo(0.2, 10);
  });
});
