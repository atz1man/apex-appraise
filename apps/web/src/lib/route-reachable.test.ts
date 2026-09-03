import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every screen this app declares, and whether anybody can click to it.
 *
 * The API has had `reachable` for a while — "an unreachable procedure is not
 * dead code, it is a capability we believe we have" — and the browser had no
 * equivalent, so the same defect was free to happen one layer up. It had.
 *
 * Measured over the real route table: `/portfolio/pack` and `/docs/api` were
 * complete, tested, working screens that NOTHING in the application linked to.
 * The funding pack is the lender-facing book — exposure, covenants, exceptions,
 * paginated to A4, with its own error state and five e2e specs. Every one of
 * those specs reaches it with `page.goto('/portfolio/pack')`, which is the tell:
 * had there been a way to click to it, one of them would have clicked.
 *
 * A route a user cannot reach is not a small omission. It is a feature that was
 * built, tested, documented and shipped, and that nobody will ever see.
 */

const SRC = join(__dirname, '..');
const APP = join(SRC, 'App.tsx');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** `/deal/:dealId/costs` and `` `/deal/${id}/costs` `` are the same destination. */
export const shape = (path: string) =>
  path
    .replace(/\$\{[^}]*\}/g, ':p')
    .replace(/:[A-Za-z0-9_]+/g, ':p')
    .split('?')[0]!
    .replace(/\/+$/, '') || '/';

export const declaredRoutes = (appSource: string): string[] =>
  [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== '*');

/** Comments are not navigation — see `pathLiterals`. */
export const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/**
 * Every path-shaped literal in the app, whatever syntax carried it.
 *
 * Not just `to=` and `href=`: half this app's navigation is TABLE-driven —
 * `GLOBAL_NAV` in the top bar, `TOOLS` in the deal strip, the Hub's tool grid —
 * and a matcher that only understood JSX attributes reported eleven routes
 * unreachable, of which nine were reached through exactly those tables.
 *
 * Comments are stripped first, and that is not tidiness. Removing the one real
 * link to `/docs/api` left this sweep GREEN, because the comment above the link
 * — explaining why the link was there — still spelled the path. A route whose
 * only mention is prose about the route is precisely an unreachable one.
 */
export const pathLiterals = (source: string): string[] =>
  [...stripComments(source).matchAll(/[`'"](\/[A-Za-z0-9_:\-/${}.]*)[`'"]/g)].map((m) => shape(m[1]!));

/**
 * Routes a user cannot click to, each because something outside the app brings
 * them here. A new entry needs a reason.
 */
const ARRIVED_AT_FROM_OUTSIDE: Record<string, string> = {
  '/reset': 'opened from the password-reset email, which carries the one-time token in the URL.',
  '/sso/callback': 'the redirect target the identity provider sends the browser back to.',
  '/terms/:p': 'the signing link emailed to a client, addressed by a token rather than by a session.',
};

describe('every screen has a door', () => {
  const files = walk(SRC).map((p) => relative(SRC, p));
  const routes = declaredRoutes(readFileSync(APP, 'utf8'));

  it('reads the real route table', () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain('/portfolio/pack');
    expect(routes).toContain('/deal/:dealId/appraisal');
  });

  it('can be clicked to, or says in writing what brings a user there', () => {
    const reachable = new Set(
      files.filter((f) => f !== 'App.tsx').flatMap((f) => pathLiterals(readFileSync(join(SRC, f), 'utf8'))),
    );
    const orphans = routes.filter((r) => !reachable.has(shape(r)) && !ARRIVED_AT_FROM_OUTSIDE[shape(r)]);
    expect(
      orphans,
      'these screens exist and nothing in the app links to them. Add a way in, or an entry to ' +
        `ARRIVED_AT_FROM_OUTSIDE with a reason: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('an exemption cannot outlive the route it names', () => {
    const shapes = new Set(routes.map(shape));
    for (const [path, reason] of Object.entries(ARRIVED_AT_FROM_OUTSIDE)) {
      expect(shapes.has(path), `${path} is exempted but is not a route any more`).toBe(true);
      expect(reason.length, `${path}'s exemption is not a reason`).toBeGreaterThan(30);
    }
  });

  it('finds what it is meant to find', () => {
    // a route with no literal anywhere is an orphan…
    const app = '<Route path="/orphan" element={<X />} />\n<Route path="/deal/:dealId/costs" element={<Y />} />';
    expect(declaredRoutes(app)).toEqual(['/orphan', '/deal/:dealId/costs']);
    expect(pathLiterals("<Link to='/orphan'>")).toContain('/orphan');

    // …and the two indirections that made the first version of this useless
    expect(pathLiterals("const NAV = [['/benchmarking', 'Benchmarking']];")).toContain('/benchmarking');
    expect(pathLiterals('to={`/deal/${dealId}/costs`}')).toContain('/deal/:p/costs');
    expect(shape('/deal/:dealId/costs')).toBe('/deal/:p/costs');

    // prose about a route is not a route. This is the mutation that survived
    // the first version: the comment explaining a link outlived the link.
    expect(pathLiterals("// see '/docs/api' for the reference")).toEqual([]);
    expect(pathLiterals("/* the `/portfolio/pack` screen */")).toEqual([]);
    expect(pathLiterals("<Link to='/docs/api'> {/* the reference */}")).toEqual(['/docs/api']);
    // a URL with // in it must survive the line-comment strip
    expect(pathLiterals("fetch('https://example.com/x'); const p = '/board';")).toContain('/board');

    // a query string is not a different screen
    expect(shape('/board?stage=OFFER')).toBe('/board');
    // and neither is a trailing slash
    expect(shape('/board/')).toBe('/board');
  });
});
