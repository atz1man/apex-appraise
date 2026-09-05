/**
 * Does a rendered heading sequence step down more than one level at a time?
 *
 * The rule is document order, on what the browser rendered: each heading may
 * be at most ONE level deeper than the heading before it. Going back UP by
 * any number of levels is fine — an `h4` followed by an `h2` is a new section
 * starting, not a section missing its parent — and so is the first heading
 * being any level, since which level a page starts at is the `h1` rule's
 * business (`e2e/headings.spec.ts` asserts exactly one).
 *
 * This is the half `lib/headings.test.ts` says it cannot prove: that sweep
 * reads the SET of levels a file uses, because source order is not render
 * order and headings compose across files — a route file with no `<hN` in it
 * renders `h1` from the frame and `h3` from every `Panel`. Only the rendered
 * tree knows the order, so the predicate is here, pure, and the browser spec
 * feeds it what it measured.
 */
export interface HeadingSkip {
  /** Index into the sequence of the heading that skipped. */
  index: number;
  /** The level of the heading before it. */
  from: number;
  /** The level it jumped to. */
  to: number;
}

/** The first heading more than one level below its predecessor, or null. */
export function firstSkippedHeading(levels: readonly number[]): HeadingSkip | null {
  for (let i = 1; i < levels.length; i++) {
    const from = levels[i - 1]!;
    const to = levels[i]!;
    if (to > from + 1) return { index: i, from, to };
  }
  return null;
}
