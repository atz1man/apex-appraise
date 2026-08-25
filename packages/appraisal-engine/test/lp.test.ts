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

  it('ignores a holding with no capital behind it', () => {
    expect(weightedIrr([
      { committed: 0, irr: 0.9 },
      { committed: 1_000_000, irr: 0.2 },
    ])).toBeCloseTo(0.2, 10);
  });
});
