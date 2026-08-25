import { describe, expect, it } from 'vitest';
import { capitalStack } from '../src/stack.js';

/**
 * The capital stack, which used to live in a `useMemo` on the appraisal page.
 *
 * Its inputs were component state, so changing the mezzanine rate did not mark
 * the appraisal dirty — measured in a browser: the Save button read "Saved" and
 * stayed disabled — and the value was gone on reload. `Appraisal.mezzToPct`,
 * `mezzRatePct` and `drawFactorPct` had columns, written by the seed and read
 * by nothing at all.
 */

const BASE = {
  ltcPct: 60,
  seniorRatePct: 7.5,
  facility: 3_000_000,
  constructionCost: 5_000_000,
  landGross: 1_000_000,
  months: 22,
};

describe('with no mezzanine tranche', () => {
  it('is senior and equity, and nothing else', () => {
    const s = capitalStack(BASE);
    expect(s.senior).toBe(3_000_000);
    expect(s.mezzanine).toBe(0);
    // construction geared at 60% is £5m; equity is the 40% plus the land
    expect(s.equity).toBeCloseTo(2_000_000 + 1_000_000, 6);
    expect(s.mezzanineInterest).toBe(0);
    expect(s.blendedRatePct).toBe(7.5);
  });

  it('is what every appraisal saved before the terms were persisted looks like', () => {
    // the tranche is optional, absent means none, and none of their figures move
    expect(capitalStack({ ...BASE, mezz: undefined })).toEqual(capitalStack(BASE));
  });
});

describe('with a mezzanine tranche', () => {
  const mezz = { toPct: 75, ratePct: 12, drawFactorPct: 50 };

  it('sits on top of the senior, to the gearing ceiling', () => {
    const s = capitalStack({ ...BASE, mezz });
    // 75% of £5m construction, less the 60% senior
    expect(s.mezzanine).toBeCloseTo(750_000, 6);
    expect(s.senior).toBe(3_000_000);
    expect(s.equity).toBeCloseTo(1_250_000 + 1_000_000, 6);
    expect(s.senior + s.mezzanine + s.equity).toBeCloseTo(s.total, 6);
  });

  it('cannot gear below the senior it sits on', () => {
    // a mezzanine "to 40%" behind a 60% senior is not a negative tranche
    const s = capitalStack({ ...BASE, mezz: { ...mezz, toPct: 40 } });
    expect(s.mezzanine).toBe(0);
    expect(s.equity).toBeCloseTo(2_000_000 + 1_000_000, 6);
  });

  it('charges interest on the drawn proportion over the term', () => {
    const s = capitalStack({ ...BASE, mezz });
    // £750,000 at 12% for 22 months, half drawn on average
    expect(s.mezzanineInterest).toBeCloseTo(750_000 * 0.12 * (22 / 12) * 0.5, 6);
  });

  it('blends the debt cost by amount, not by tranche', () => {
    const s = capitalStack({ ...BASE, mezz });
    expect(s.blendedRatePct).toBeCloseTo((3_000_000 * 7.5 + 750_000 * 12) / 3_750_000, 10);
    // and that is dearer than the senior alone, which is the point of showing it
    expect(s.blendedRatePct).toBeGreaterThan(7.5);
  });
});

describe('degenerate inputs', () => {
  it('does not divide by a zero senior', () => {
    const s = capitalStack({ ...BASE, ltcPct: 0, facility: 0 });
    expect(Number.isFinite(s.senior)).toBe(true);
    expect(Number.isFinite(s.equity)).toBe(true);
    expect(s.blendedRatePct).toBe(0);
  });

  it('never returns a zero total, which a width calculation would divide by', () => {
    const s = capitalStack({ ...BASE, ltcPct: 0, facility: 0, constructionCost: 0, landGross: 0 });
    expect(s.total).toBe(1);
  });
});
