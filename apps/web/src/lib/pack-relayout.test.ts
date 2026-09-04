import { describe, expect, it } from 'vitest';
import { MAX_RELAYOUT_PASSES, RESERVE_CAP_PX, nextReserve } from './pack-relayout';

/**
 * React abandons a tree whose layout effect sets state this many times in a
 * row, with "Maximum update depth exceeded". The pack's own bound has to sit
 * below it for every book, not for the convenient ones.
 */
const REACT_NESTED_UPDATE_LIMIT = 50;

/** Drives the real loop the way the layout effect does, and counts the passes. */
function settle(overrun: number, limit = 500) {
  let reserve = 0;
  let passes = 0;
  while (passes < limit) {
    const next = nextReserve({ overrun, reserve, passes });
    if (next === null) return { passes, reserve, settled: true };
    reserve = next;
    passes += 1;
  }
  return { passes, reserve, settled: false };
}

describe('funding pack re-layout', () => {
  it('settles at once when nothing overruns', () => {
    expect(nextReserve({ overrun: 0, reserve: 0, passes: 0 })).toBeNull();
    // a sheet UNDER A4 is not an overrun to be reclaimed
    expect(nextReserve({ overrun: -12.5, reserve: 0, passes: 0 })).toBeNull();
  });

  it('hands the overrun back, rounded up, with the margin the layout cannot see', () => {
    expect(nextReserve({ overrun: 40, reserve: 0, passes: 0 })).toBe(44);
    expect(nextReserve({ overrun: 0.25, reserve: 10, passes: 1 })).toBe(15);
  });

  /**
   * The defect, stated as the property that failed.
   *
   * A book whose sheet overruns by a fraction of a pixel — a sheet holding the
   * one row pagination guarantees it, which reserve can never relieve — used to
   * add five pixels a pass against a 256px cap: 52 passes, and React gives up at
   * 50. Every overrun has to settle well inside that, and the small ones are the
   * whole point, so they are the ones enumerated.
   */
  it('settles inside React’s nested-update limit for EVERY overrun, however small', () => {
    for (const overrun of [0.01, 0.05, 0.25, 0.5, 0.75, 1, 1.0001, 2, 3, 4.5, 7, 31, 32, 100, 1099.75, 5000]) {
      const { passes, settled } = settle(overrun);
      expect(settled, `overrun ${overrun} never settled`).toBe(true);
      expect(passes, `overrun ${overrun} took ${passes} passes`).toBeLessThan(REACT_NESTED_UPDATE_LIMIT);
      expect(passes).toBeLessThanOrEqual(MAX_RELAYOUT_PASSES);
    }
  });

  /**
   * The pixel cap still does its own job, which is a different one: it says
   * "this book cannot be made to fit, stop taking rows off it". A single large
   * overrun reaches it in one pass, and no pass budget should hide that.
   */
  it('stops reclaiming once the reserve cap is reached', () => {
    expect(nextReserve({ overrun: 5, reserve: RESERVE_CAP_PX, passes: 0 })).toBeNull();
    expect(nextReserve({ overrun: 5, reserve: RESERVE_CAP_PX + 1, passes: 0 })).toBeNull();
    // one enormous overrun clears the cap in a single pass, as it always did
    expect(settle(1099.75)).toMatchObject({ passes: 1, settled: true });
  });

  it('stops when the pass budget is spent even though the cap is not reached', () => {
    expect(nextReserve({ overrun: 1, reserve: 20, passes: MAX_RELAYOUT_PASSES })).toBeNull();
    expect(nextReserve({ overrun: 1, reserve: 20, passes: MAX_RELAYOUT_PASSES - 1 })).toBe(25);
  });
});
