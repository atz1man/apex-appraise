/**
 * When the funding pack should lay itself out again, and with how much reserve.
 *
 * The pack measures its rendered sheets and hands any overrun back as reserve,
 * so the next layout takes it off the budget. That loop lived inline in
 * `FundingPack`'s layout effect, where its termination could not be tested —
 * and it did not terminate. Measured from a real failure snapshot: the pack
 * rendered as "This screen stopped working" carrying React's own message,
 * "Maximum update depth exceeded", which is what a browser does when a layout
 * effect sets state more than fifty times in a row. The e2e failure it caused
 * reads as `waiting for locator('.a4-page')` — the pack never rendering — and
 * was twice diagnosed as the pack being SLOW, and twice answered by raising a
 * test budget. It renders in 151ms.
 *
 * The loop was bounded, and bounded on the wrong quantity: it stopped when
 * `reserve` reached 8 rows (256px), and each pass adds `ceil(overrun) + 4`. So
 * the number of passes is 256 / (ceil(overrun) + 4) — a bound in PIXELS
 * standing in for a bound in ITERATIONS, and the two only agree when the
 * overrun is large. At an overrun of one pixel or less each pass adds five,
 * which is 52 passes, and React gives up at 50.
 *
 * A sub-pixel overrun is not exotic: heights are fractional
 * (`getBoundingClientRect` answered 1099.75 on the very first book tried), and
 * a sheet holding a single row cannot be relieved by reserve at all, because
 * pagination already guarantees each sheet at least one row. That book
 * overruns by the same fraction on every pass, for ever.
 *
 * So the bound is now on passes, which is what the loop's own comment always
 * claimed ("bounded to a handful so a pathological book cannot loop"). The
 * pixel cap is kept: it is the one that says "this book cannot be made to fit,
 * stop taking rows off it".
 */

/** Layout passes that may set reserve. Observed in practice: one, or none. */
export const MAX_RELAYOUT_PASSES = 4;

/** Reserve past which the pack stops reclaiming rows: eight rows of 32px. */
export const RESERVE_CAP_PX = 256;

export type RelayoutState = {
  /** Pixels by which the tallest sheet exceeds A4. Fractional, and may be ≤ 0. */
  overrun: number;
  /** Reserve the current layout was given. */
  reserve: number;
  /** Passes that have already set reserve. */
  passes: number;
};

/**
 * The reserve for the next layout, or `null` to settle.
 *
 * Settles when nothing overruns, when the reserve cap is reached, or when the
 * pass budget is spent — whichever comes first. The pass budget is the one
 * that holds for every overrun, however small.
 */
export function nextReserve({ overrun, reserve, passes }: RelayoutState): number | null {
  if (!(overrun > 0)) return null;
  if (passes >= MAX_RELAYOUT_PASSES) return null;
  if (reserve >= RESERVE_CAP_PX) return null;
  return reserve + Math.ceil(overrun) + 4;
}
