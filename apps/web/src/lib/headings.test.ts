import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A screen's headings form an outline somebody can navigate by.
 *
 * A screen reader offers "jump to next heading" and a list of headings as the
 * primary way around an unfamiliar page. That list is only useful if the levels
 * nest: an `h1` followed by `h3`s with no `h2` between them reads as a section
 * missing its parent, and the reader cannot tell whether it has skipped
 * something.
 *
 * Measured across the route tree: four screens skipped a level, and the two
 * that matter most were the CLIENT-facing ones. The buyer portal and the
 * investor portal each had a single `h1` and then every section marked `h3`,
 * with no `h2` anywhere in the file. Those are the two screens read by people
 * who do not work at the firm, on an unfamiliar page, with nobody to ask how it
 * is laid out.
 *
 * Every one of those headings carried an explicit Tailwind size, so the fix
 * changed the tag and could not move a pixel — which is the whole reason it is
 * a safe change to make in bulk.
 *
 * NOT a hard WCAG Level A failure, and worth being accurate about: skipped
 * levels are technique G141, which serves 1.3.1 and 2.4.10 rather than being a
 * success criterion of its own. It is the difference between a page that can be
 * navigated and one that can be read, which is enough.
 *
 * NOT PROVEN, and found by mutation rather than foresight: putting ONE of the
 * buyer portal's headings back to `h3` survives this sweep. The file still
 * contains `h2`s, so its levels are {1,2,3} — contiguous, no gap. The rule
 * catches a level that is MISSING, not a section that is mis-levelled.
 *
 * No static rule can catch the second. In `<h1>P</h1><h2>A</h2><h3>B</h3>`, B is
 * either a subsection of A — which is correct — or a sibling of it, which is
 * not, and nothing but the rendered nesting says which. A regex that guessed
 * would be wrong on real markup half the time, and a sweep that is wrong half
 * the time gets an exemption list and then gets ignored. Catching the whole gap
 * is the claim; a third heading in the wrong place is for an axe pass over the
 * rendered tree.
 */

const ROUTES = join(__dirname, '..', 'routes');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The LEVELS a file uses, as a set — deliberately not their order.
 *
 * Source order is not render order: `Benchmarking.tsx` declares a
 * `contributionSection` JSX variable two hundred lines above the `h1` it
 * renders below, and a sub-component defined at the top of a file can render
 * anywhere. An order-sensitive rule would have called that a defect for the
 * wrong reason and, worse, would have gone on doing so after a correct fix.
 *
 * Asking whether the levels are contiguous is order-independent and still
 * catches the real defect, because a screen with an `h1` and an `h3` and no
 * `h2` has a gap however the file is arranged.
 */
export function headingLevels(src: string): number[] {
  const t = withoutDrawers(stripComments(src));
  return [...new Set([...t.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * A `<Drawer>` is a modal dialog with its own outline, and it is removed before
 * the page's outline is measured.
 *
 * This is the sweep being wrong and the markup being right, which is worth
 * recording. The first version reported `Investors.tsx` for using `h1` and `h4`
 * with nothing between. Both `h4`s sit inside a Drawer, and the Drawer
 * PRIMITIVE renders `<h3>{title}</h3>` from `components/ui.tsx` — so the outline
 * a reader actually traverses inside the dialog is h3 → h4, contiguous. The
 * dialog carries `aria-modal`, so the page behind it is not in the tree at all
 * and the step from the page's `h1` is never taken.
 *
 * The gap was in a per-file rule applied to an app that composes headings
 * across files. Changing the markup to satisfy it would have made correct
 * markup worse.
 *
 * WHAT THIS THEREFORE DOES NOT PROVE: that a drawer's own internal outline is
 * contiguous. Its parent heading lives in the primitive, so a file-shaped rule
 * cannot see both ends. That needs a rendered tree — an axe pass in the browser
 * suite — rather than a wider regex.
 */
function withoutDrawers(src: string): string {
  return src.replace(/<Drawer\b[\s\S]*?<\/Drawer>/g, '');
}

/** The levels a file skips over — `[2]` for a file using h1 and h3 only. */
export function skippedLevels(src: string): number[] {
  const used = headingLevels(src);
  if (used.length === 0) return [];
  const gaps: number[] = [];
  for (let level = used[0]; level < used[used.length - 1]; level++) {
    if (!used.includes(level)) gaps.push(level);
  }
  return gaps;
}

describe('heading outlines', () => {
  it('have no gaps, on every screen', () => {
    const offenders = readdirSync(ROUTES)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => ({ file: f, gaps: skippedLevels(readFileSync(join(ROUTES, f), 'utf8')) }))
      .filter(({ gaps }) => gaps.length > 0)
      .map(({ file, gaps }) => `routes/${file} — uses no ${gaps.map((g) => `h${g}`).join(', ')}`);
    expect(
      offenders,
      `a screen whose heading levels skip cannot be navigated by its outline:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /** A sweep over an empty list passes in silence. This says it reads the tree. */
  it('finds the screens it is meant to be checking', () => {
    const withHeadings = readdirSync(ROUTES)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => headingLevels(readFileSync(join(ROUTES, f), 'utf8')).length > 0);
    expect(withHeadings.length).toBeGreaterThan(15);
    expect(withHeadings).toContain('BuyerPortal.tsx');
  });
});

describe('skippedLevels', () => {
  it('names the level that is missing', () => {
    expect(skippedLevels('<h1>a</h1><h3>b</h3>')).toEqual([2]);
    expect(skippedLevels('<h1>a</h1><h4>b</h4>')).toEqual([2, 3]);
  });

  it('accepts a contiguous outline', () => {
    expect(skippedLevels('<h1>a</h1><h2>b</h2><h3>c</h3>')).toEqual([]);
    expect(skippedLevels('<h1>a</h1><h2>b</h2><h2>c</h2>')).toEqual([]);
  });

  /**
   * A file whose headings start below `h1` is not a gap: a panel component
   * rendering `h2` and `h3` is nested inside a page that owns the `h1`, and
   * demanding one of every file would be demanding several `h1`s per screen.
   */
  it('does not demand an h1 in a file that starts lower', () => {
    expect(skippedLevels('<h2>a</h2><h3>b</h3>')).toEqual([]);
  });

  it('says nothing about a file with no headings at all', () => {
    expect(skippedLevels('<div>nothing</div>')).toEqual([]);
  });

  /**
   * Order-independent, deliberately. `Benchmarking.tsx` declares a JSX variable
   * carrying a section heading two hundred lines ABOVE the `h1` it renders
   * below; an order-sensitive rule reports that as a defect and keeps reporting
   * it after a correct fix.
   */
  it('does not care which order the levels appear in the source', () => {
    expect(skippedLevels('<h2>declared first</h2><h1>rendered above it</h1>')).toEqual([]);
  });

  /**
   * And a modal's headings are not the page's. This is the case that proved the
   * rule wrong rather than the code: `Investors.tsx` renders `h4` sections
   * inside a Drawer whose title the primitive renders as `h3`.
   */
  it('does not read a drawer\'s headings as part of the page outline', () => {
    const page = '<h1>Investors</h1><Drawer title="Ann"><h4>Holdings</h4></Drawer>';
    expect(skippedLevels(page)).toEqual([]);
    // and without the drawer wrapper the same markup IS a gap
    expect(skippedLevels('<h1>Investors</h1><h4>Holdings</h4>')).toEqual([2, 3]);
  });
});
