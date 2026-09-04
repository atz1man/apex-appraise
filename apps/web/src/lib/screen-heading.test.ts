import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAME_HEADING, frameHeadingFor } from './page-title';

/**
 * Every SCREEN renders an `h1` — its own, or the frame's.
 *
 * Measured in the browser before this existed, signed in, walking every
 * reachable route: of 25 screens, TWELVE rendered no `h1` at all. The Pipeline
 * board had no heading of any level. Settings, the development appraisal,
 * sales and the engagement screen began at `h3` — those `h3`s come from the
 * `Panel` primitive, and the screen puts nothing above them. The Red Book
 * valuation, seven sheets and the most formal document the product prints,
 * rendered NO heading of any level; nor did the engagement document a client
 * signs. A screen reader's heading list, the main way around an unfamiliar
 * page, was empty on the main working screen and on the signed valuation.
 *
 * `headings.test.ts` could not see any of it, for two reasons it states
 * itself: it checks that the LEVELS a file uses have no gap, and a file using
 * no headings has no gap; and it deliberately does not demand an `h1` per
 * file, because a panel component nested in a page is not a page. Both are
 * correct. The rule that was missing is per SCREEN, not per file, and it
 * needs the route table to know what a screen is.
 *
 * So this reads the real table out of `App.tsx` — route → component → file —
 * and asks each screen one question in two directions: if its file renders no
 * heading, it must be in `FRAME_HEADING` so `PageFrame` supplies one; and if
 * it IS in `FRAME_HEADING`, it must not also render its own, or the page has
 * two `h1`s. A screen "renders a heading" if its source carries `<h1`, or one
 * of the primitives that render one: `EyebrowTitle`, `TermsDocument`, or a
 * `PageHead` passed `heading`.
 *
 * NOT PROVEN, and the reason `e2e/headings.spec.ts` exists: a static presence
 * check cannot see render branches. `FundingPack.tsx` contained `<h1` before
 * this change — in its EMPTY state only, and a populated pack rendered none.
 * Presence in the source is necessary and not sufficient; the browser spec
 * walks the same routes signed in and counts what is actually rendered.
 */

const SRC = join(__dirname, '..');
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Route pattern → the component its `element` renders, unwrapping `<Protected>`.
 *
 * The wrapper carries props on two routes — `<Protected portal="buyer">` — and
 * the first version of this regex allowed none, so both portals resolved to
 * `Protected`, which has no file, and were reported as screens with no
 * heading. The "finds the screens it is meant to be checking" case below is
 * what caught that: it demands every screen resolve to a real file.
 */
export function declaredScreens(app = APP): Array<{ route: string; component: string }> {
  return [...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{(?:<Protected\b[^>]*>)?<([A-Za-z]+)/g)].map((m) => ({
    route: m[1]!,
    component: m[2]!,
  }));
}

/** Component name → route file, from the `lazy(() => import('./routes/…'))` lines. */
export function lazyFiles(app = APP): Record<string, string> {
  return Object.fromEntries(
    [...app.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/routes\/(\w+)'\)/g)].map((m) => [m[1]!, `${m[2]}.tsx`]),
  );
}

/**
 * `Root` is the one component in the table that is not a lazy import: it is
 * defined in `App.tsx` and renders the Hub for a signed-in visitor and the
 * marketing page for anyone else. Both are screens and both must own an `h1`.
 */
const COMPOSITES: Record<string, string[]> = { Root: ['Hub', 'Landing'] };

const HEADING_MARKERS = [/<h1\b/, /<EyebrowTitle\b/, /<TermsDocument\b/, /<PageHead\b[^>]*\bheading\b/];

/** Does this route source render a level-one heading by any path this repo has? */
export function ownsHeading(src: string): boolean {
  const t = stripComments(src);
  return HEADING_MARKERS.some((re) => re.test(t));
}

function filesFor(component: string, files: Record<string, string>): string[] {
  const names = COMPOSITES[component] ?? [component];
  return names.map((n) => files[n]).filter((f): f is string => Boolean(f));
}

describe('screen headings', () => {
  it('every screen renders an h1 — its own, or the frame’s — and never both', () => {
    const files = lazyFiles();
    const offenders: string[] = [];
    for (const { route, component } of declaredScreens()) {
      const srcs = filesFor(component, files).map((f) => readFileSync(join(SRC, 'routes', f), 'utf8'));
      const owns = srcs.length > 0 && srcs.every(ownsHeading);
      const framed = FRAME_HEADING.has(route);
      if (!owns && !framed) offenders.push(`${route} (${component}) — renders no h1 and is not in FRAME_HEADING`);
      if (owns && framed) offenders.push(`${route} (${component}) — in FRAME_HEADING and renders its own h1: two h1s`);
    }
    expect(offenders, `a screen with no h1 has no outline root:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('frames no route the app does not declare', () => {
    const declared = new Set(declaredScreens().map((s) => s.route));
    const stale = [...FRAME_HEADING].filter((r) => !declared.has(r));
    expect(stale, `FRAME_HEADING names routes that are no longer declared:\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  /**
   * A sweep over an empty list passes in silence. This says it read the real
   * table, resolved every screen to a file that exists, and that its one
   * special case still describes `Root`.
   */
  it('finds the screens it is meant to be checking', () => {
    const screens = declaredScreens();
    const files = lazyFiles();
    expect(screens.length).toBeGreaterThan(30);
    expect(screens.map((s) => s.route)).toContain('/deal/:dealId/redbook');
    const unresolved = screens.filter(({ component }) => filesFor(component, files).length === 0).map((s) => s.component);
    expect(unresolved, 'every screen must resolve to a route file (a new non-lazy component needs an entry in COMPOSITES)').toEqual([]);
    for (const f of Object.values(files)) expect(existsSync(join(SRC, 'routes', f)), f).toBe(true);
    expect(APP).toMatch(/function Root\(\)[\s\S]*?<Hub \/>[\s\S]*?<Landing \/>/);
  });
});

describe('ownsHeading', () => {
  it('recognises every way this repo renders a level-one heading', () => {
    expect(ownsHeading('<h1 className="sr-only">Board</h1>')).toBe(true);
    expect(ownsHeading('<EyebrowTitle eyebrow="x" title="Calendar" />')).toBe(true);
    expect(ownsHeading('<TermsDocument t={t} />')).toBe(true);
    expect(ownsHeading('<PageHead\n  title="Pack"\n  scheme={firm}\n  heading={pi === 0}\n/>')).toBe(true);
  });

  it('does not count a PageHead that is not the heading, nor a heading in a comment', () => {
    expect(ownsHeading('<PageHead title="Pack" scheme={firm} />')).toBe(false);
    expect(ownsHeading('{/* <h1>was here</h1> */}<div />')).toBe(false);
    expect(ownsHeading('// <h1>no</h1>\n<div />')).toBe(false);
    expect(ownsHeading('<h2>Section</h2><h3>Sub</h3>')).toBe(false);
  });
});

describe('frameHeadingFor', () => {
  it('names the screens whose title is the breadcrumb, with the same name the tab shows', () => {
    expect(frameHeadingFor('/board')).toBe('Pipeline board');
    expect(frameHeadingFor('/deal/abc123/costs')).toBe('Cost monitoring');
    expect(frameHeadingFor('/settings')).toBe('Settings');
  });

  it('is silent for a screen that owns its heading, including the documents', () => {
    expect(frameHeadingFor('/deal/abc123')).toBeNull();
    expect(frameHeadingFor('/portfolio/pack')).toBeNull();
    expect(frameHeadingFor('/deal/abc123/redbook')).toBeNull();
    expect(frameHeadingFor('/terms/tok')).toBeNull();
    expect(frameHeadingFor('/')).toBeNull();
  });
});
