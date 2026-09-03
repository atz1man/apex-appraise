import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_TITLES, matchesPattern, patternFor, titleFor } from './page-title';

const APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

/** Every route the application actually declares, read out of the real table. */
function declaredRoutes(): string[] {
  return [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
}

describe('page titles', () => {
  /**
   * The point of the whole file. A route added without a title gets the
   * not-found title in its tab, silently, and nobody looks at their own tab.
   */
  it('name every route the app declares', () => {
    const missing = declaredRoutes().filter((r) => !(r in ROUTE_TITLES));
    expect(missing, `these routes are declared in App.tsx and have no title:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  /** And the other direction: a title for a route that has gone is a stale claim. */
  it('name no route the app does not declare', () => {
    const declared = new Set(declaredRoutes());
    const stale = Object.keys(ROUTE_TITLES).filter((k) => !declared.has(k));
    expect(stale, `these routes have titles and are no longer declared:\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('finds the routes it is meant to be reading', () => {
    // a sweep over an empty list passes in silence; this is what says it is not
    expect(declaredRoutes().length).toBeGreaterThan(30);
    expect(declaredRoutes()).toContain('/deal/:dealId/redbook');
  });

  /**
   * The defect itself was one title across the whole product, so a table that
   * drifted back towards shared names would be the same defect wearing a
   * table. Compared on the FULL title, because that is what a tab shows: the
   * engagement a client signs and the one a firm drafts are both "Terms of
   * engagement", and are told apart by the product suffix the client's copy
   * deliberately does not carry.
   */
  it('are distinct, so six open tabs can be told apart', () => {
    const full = Object.keys(ROUTE_TITLES).map((pattern) =>
      titleFor(pattern.replace(/:[^/]+/g, 'x')),
    );
    const dupes = full.filter((t, i) => full.indexOf(t) !== i);
    expect(dupes, `two routes share a tab title:\n  ${dupes.join('\n  ')}`).toEqual([]);
  });
});

describe('patternFor', () => {
  it('prefers an exact literal to a pattern that also fits', () => {
    // `/terms` is the terms of service; `/terms/:token` is a client signing an
    // engagement. React Router ranks them this way and so must the title.
    expect(patternFor('/terms')).toBe('/terms');
    expect(patternFor('/terms/abc123')).toBe('/terms/:token');
  });

  it('does not let a parameter swallow a deeper path', () => {
    expect(patternFor('/deal/d1')).toBe('/deal/:dealId');
    expect(patternFor('/deal/d1/redbook')).toBe('/deal/:dealId/redbook');
    expect(patternFor('/deal/d1/engagement/document')).toBe('/deal/:dealId/engagement/document');
  });

  it('answers the not-found pattern for a path on no route', () => {
    expect(patternFor('/nowhere')).toBe('*');
    expect(patternFor('/deal/d1/nowhere')).toBe('*');
  });

  it('reads a trailing slash as the same route', () => {
    expect(patternFor('/board/')).toBe('/board');
    expect(patternFor('/')).toBe('/');
  });
});

describe('matchesPattern', () => {
  it('requires the same number of segments', () => {
    expect(matchesPattern('/deal/:dealId', '/deal/d1')).toBe(true);
    expect(matchesPattern('/deal/:dealId', '/deal/d1/costs')).toBe(false);
    expect(matchesPattern('/deal/:dealId/costs', '/deal/d1')).toBe(false);
  });
});

describe('titleFor', () => {
  it('names the screen first, so a truncated tab still says which one', () => {
    expect(titleFor('/deal/d1/redbook')).toBe('Red Book valuation · Apex Appraise');
  });

  /**
   * A portal shows the FIRM's mark and name rather than ours. The tab was the
   * one place that rule had not reached: a buyer forwarding their unit's page,
   * or a client opening an emailed engagement to sign, was handing on a tab
   * advertising their valuer's software.
   */
  it('leaves the product off what a client reads', () => {
    expect(titleFor('/portal/buyer')).toBe('Your home');
    expect(titleFor('/portal/investor')).toBe('Your investment');
    expect(titleFor('/terms/sometoken')).toBe('Terms of engagement');
  });

  it('keeps the product on what the firm reads', () => {
    expect(titleFor('/terms')).toBe('Terms of service · Apex Appraise');
    expect(titleFor('/board')).toBe('Pipeline board · Apex Appraise');
  });

  it('says not found rather than nothing', () => {
    expect(titleFor('/nowhere')).toBe('Page not found · Apex Appraise');
  });
});
