import { describe, expect, it } from 'vitest';
import {
  binned,
  computeAppraisal,
  monteCarlo,
  sensitivityGrid,
  sensitivityStructure,
  type AppraisalInput,
  type SensitivityMetric,
} from '../src/index.js';

/**
 * A sensitivity grid says something, or it says why it cannot.
 *
 * Measured in the browser on the demo workspace: the appraisal's "Sensitivity —
 * GDV × build" panel showed **23% in all twenty-five cells**. The arithmetic was
 * right and the panel was a lie by omission — a valuer reads a 5×5 grid of one
 * number as "this scheme is insensitive to a ten per cent swing in sales values
 * and build costs", on the screen a lender's credit committee is briefed from.
 *
 * The cause is structural, not a bug in the grid. In RESIDUAL mode — which is
 * the mode every appraisal starts in — return on cost is pinned by the target:
 *
 *     profit    = gdv × t
 *     totalCost = gdv − profit            (the land takes the remainder)
 *     RoC       = profit / totalCost = t / (1 − t)
 *
 * …so no shock can move it. The grid opened on RoC whatever the mode, so the
 * default view of the default mode was the one view that could not vary.
 *
 * `sensitivityStructure` declares which metric each mode can actually move.
 * THIS FILE IS WHY THE DECLARATION CAN BE TRUSTED: it runs the real grid and
 * checks the declaration against what the engine actually does, in both
 * directions — a metric declared `pinned` must be constant to the penny, and one
 * declared `varies` must take a different value in every cell. Change how a mode
 * solves and this fails rather than the screen quietly going back to lying.
 */

const base: AppraisalInput = {
  units: [{ label: 'Apartments', count: 10, area: 750, cap: 400 }],
  efficiency: 85,
  trades: [{ label: 'Build', rate: 180 }],
  profFeePct: 10,
  contingencyPct: 5,
  otherCosts: [{ label: 'S106', amount: 100_000 }],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 16, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
  jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
};

/** The same scheme with the land priced rather than solved. */
const priced: AppraisalInput = {
  ...base,
  site: { mode: 'profit', landFixed: computeAppraisal(base).residualNet, acqPct: 6.8 },
};

/** Distinct values across the whole 5×5, to the penny. */
const spread = (input: AppraisalInput, metric: SensitivityMetric) => {
  const cells = sensitivityGrid(input, metric).flat();
  return {
    distinct: new Set(cells.map((c) => Math.round(c.value * 100))).size,
    perRow: sensitivityGrid(input, metric).map(
      (row) => new Set(row.map((c) => Math.round(c.value * 100))).size,
    ),
    perColumn: [0, 1, 2, 3, 4].map(
      (ci) => new Set(sensitivityGrid(input, metric).map((row) => Math.round(row[ci]!.value * 100))).size,
    ),
  };
};

const MODES: Array<[string, AppraisalInput]> = [
  ['residual land', base],
  ['priced land', priced],
];

describe('the declaration matches what the engine does', () => {
  for (const [label, input] of MODES) {
    describe(label, () => {
      const S = sensitivityStructure(input.site.mode);

      it('pins exactly what it says it pins', () => {
        for (const metric of ['roc', 'profit', 'residual'] as const) {
          const { distinct } = spread(input, metric);
          const declared = S.responseOf[metric];
          if (declared === 'pinned') {
            expect(distinct, `${metric} is declared pinned but takes ${distinct} values`).toBe(1);
          } else {
            expect(distinct, `${metric} is declared ${declared} but never moves`).toBeGreaterThan(1);
          }
        }
      });

      /**
       * The sharper half. "Varies" must mean every cell, not merely more than
       * one — a metric that moves along one axis and not the other is `gdvOnly`,
       * and calling it `varies` would put a grid half of which is flat in front
       * of somebody as though it were analysis.
       */
      it('distinguishes a metric that moves on both axes from one that moves on one', () => {
        for (const metric of ['roc', 'profit', 'residual'] as const) {
          const { perRow, perColumn } = spread(input, metric);
          if (S.responseOf[metric] === 'varies') {
            /**
             * Both AXES move — not "all 25 values differ", which was the first
             * version and was wrong about arithmetic rather than about the
             * model: priced-land RoC came back 24 distinct because two cells
             * coincide to the penny. A collision is a coincidence of one
             * fixture; responding on both axes is the property being claimed.
             */
            expect(perRow.every((n) => n > 1), `${metric}: a row should move with GDV`).toBe(true);
            expect(perColumn.every((n) => n > 1), `${metric}: a column should move with build cost`).toBe(true);
          }
          if (S.responseOf[metric] === 'gdvOnly') {
            // every column (a GDV step) differs; every row (a build step) does not
            expect(perRow.every((n) => n > 1), `${metric}: a row should move with GDV`).toBe(true);
            expect(perColumn.every((n) => n === 1), `${metric}: a column should be flat in build cost`).toBe(true);
          }
        }
      });

      it('opens on a metric this mode can move', () => {
        expect(S.responseOf[S.preferred]).toBe('varies');
      });

      /** A pinned or partial metric owes the reader a reason; a free one does not need one. */
      it('explains every metric it has limited, and only those', () => {
        for (const metric of ['roc', 'profit', 'residual'] as const) {
          const note = S.noteOf[metric];
          if (S.responseOf[metric] === 'varies') {
            expect(note, `${metric} varies freely but carries a caveat`).toBeNull();
          } else {
            expect(note?.length ?? 0, `${metric} is limited with nothing said about it`).toBeGreaterThan(40);
          }
        }
      });
    });
  }
});

describe('the identity behind the residual case', () => {
  /**
   * Not an observation — algebra. RoC in residual mode is the target restated,
   * so the constant the grid shows is exactly t/(1−t) and depends on nothing
   * else. Driven at three targets, because a single one could coincide.
   */
  it('RoC is target ÷ (1 − target), whatever the scheme', () => {
    for (const t of [10, 20, 25]) {
      const input = { ...base, targetProfitOnGdvPct: t };
      const expected = t / 100 / (1 - t / 100);
      expect(computeAppraisal(input).poc).toBeCloseTo(expected, 10);
      for (const cell of sensitivityGrid(input, 'roc').flat()) {
        expect(cell.value, `t=${t}`).toBeCloseTo(expected, 10);
      }
    }
  });

  /** And the other end: a priced site hands its own number back. */
  it('the residual echoes the land price when the land is priced', () => {
    for (const cell of sensitivityGrid(priced, 'residual').flat()) {
      expect(cell.value).toBeCloseTo(priced.site.landFixed, 6);
    }
  });
});

describe('what it is meant to find', () => {
  /**
   * A sweep over nothing passes in silence. This is the old behaviour — the
   * panel opened on RoC in every mode — and it must be reported as showing one
   * number twenty-five times.
   */
  it('names the defect this was written for: RoC on a residual appraisal', () => {
    const { distinct } = spread(base, 'roc');
    expect(distinct, 'the original defect no longer reproduces — has the model changed?').toBe(1);
    expect(sensitivityStructure('residual').preferred).not.toBe('roc');
  });
});

/**
 * The risk panel drew three percentiles as a flat band, which is the same
 * failure one level over: two schemes can share a P10, P50 and P90 and have
 * completely different tails, and the tail is the question a lender is asking.
 * `monteCarlo` now returns the SHAPE, binned in the engine so every surface
 * describes one distribution.
 */
describe('the profit distribution', () => {
  const R = monteCarlo(base, { iterations: 400, seed: 42 });

  it('accounts for every run, so the tail cannot be understated', () => {
    expect(R.histogram.reduce((a, b) => a + b.count, 0)).toBe(R.iterations);
  });

  it('covers the whole range, with the maximum inside the last bin', () => {
    const first = R.histogram[0]!;
    const last = R.histogram[R.histogram.length - 1]!;
    expect(first.count, 'the minimum fell outside the first bin').toBeGreaterThan(0);
    expect(last.count, 'the maximum fell past the end — the classic off-by-one').toBeGreaterThan(0);
    expect(first.from).toBeLessThanOrEqual(R.profit.p10);
    expect(last.to).toBeGreaterThanOrEqual(R.profit.p90);
  });

  it('is equal WIDTH, not equal count — an equal-count histogram is a rectangle', () => {
    const widths = R.histogram.map((b) => b.to - b.from);
    for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 6);
    expect(new Set(R.histogram.map((b) => b.count)).size, 'every bin holds the same count').toBeGreaterThan(1);
  });

  it('has a shape: the middle carries more than the tails', () => {
    const n = R.histogram.length;
    const mass = (from: number, to: number) =>
      R.histogram.slice(from, to).reduce((a, b) => a + b.count, 0);
    expect(mass(Math.floor(n / 3), Math.ceil((2 * n) / 3))).toBeGreaterThan(mass(0, 2) + mass(n - 2, n));
  });

  /** A scheme whose runs are all identical must not divide by zero. */
  it('answers one bin for a degenerate sample rather than NaN', () => {
    const flat = binned([5, 5, 5, 5]);
    expect(flat).toHaveLength(1);
    expect(flat[0]).toEqual({ from: 5, to: 5, count: 4 });
    expect(binned([])).toEqual([]);
  });

  it('puts a value on a bin boundary in exactly one bin', () => {
    const h = binned([0, 10, 20, 30, 40], 4);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(5);
    expect(h.map((b) => b.count)).toEqual([1, 1, 1, 2]);
  });
});
