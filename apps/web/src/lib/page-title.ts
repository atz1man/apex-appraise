/**
 * What the browser tab, the history menu and a screen reader call this screen.
 *
 * Measured before this existed: 37 routes, ONE `<title>`, set once in
 * `index.html` and never touched again. Every tab in the product read "Apex
 * Appraise — UK development appraisals, end to end". So did every entry in the
 * back-button menu, every bookmark, and every announcement a screen reader
 * makes on navigation — which is the whole of what WCAG 2.4.2 (Page Titled,
 * Level A) asks for, failed on 36 of 37 routes.
 *
 * It is a navigation defect before it is an accessibility one. A valuer with
 * six tabs open — an appraisal, its comparables, the Red Book, two deals and
 * Settings — could tell them apart only by clicking each.
 *
 * The table below carries every route in `App.tsx`. `page-title.test.ts` reads
 * the real route table out of `App.tsx` and fails naming any route with no
 * title, so route 38 is covered the day it is declared rather than the day
 * somebody notices its tab is wrong.
 */

const PRODUCT = 'Apex Appraise';

/**
 * The screens a CLIENT reads, which carry no product suffix.
 *
 * A portal already shows the FIRM's mark and name rather than ours — same rule
 * as the documents: "the product is ours, what the client looks at is theirs".
 * The tab title is the one place that rule had not reached. A buyer forwarding
 * their unit's page, or a client opening an emailed engagement to sign, should
 * not be handing on a tab that advertises their valuer's software.
 */
const CLIENT_FACING = new Set(['/portal/buyer', '/portal/investor', '/terms/:token']);

export const ROUTE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/login': 'Sign in',
  '/register': 'Create your workspace',
  '/forgot': 'Reset your password',
  '/reset': 'Choose a new password',
  '/sso/callback': 'Signing you in',
  '/welcome': 'UK development appraisals, end to end',
  '/whats-new': "What's new",
  '/privacy': 'Privacy',
  '/terms': 'Terms of service',
  '/terms/:token': 'Terms of engagement',
  '/docs/api': 'API reference',
  '/portfolio/pack': 'Portfolio funding pack',
  '/board': 'Pipeline board',
  '/calendar': 'Calendar',
  '/settings': 'Settings',
  '/benchmarking': 'Benchmarking',
  '/integrations': 'Integrations',
  '/investors': 'Investors',
  '/field': 'Field inspection',
  '/portal/buyer': 'Your home',
  '/portal/investor': 'Your investment',
  '/deal/:dealId': 'Deal overview',
  '/deal/:dealId/sitepack': 'Site pack',
  '/deal/:dealId/appraisal': 'Development appraisal',
  '/deal/:dealId/auto': 'Auto-Appraisal',
  '/deal/:dealId/comparables': 'Comparables',
  '/deal/:dealId/scenarios': 'Scenarios',
  '/deal/:dealId/costs': 'Cost monitoring',
  '/deal/:dealId/sales': 'Sales & lettings',
  '/deal/:dealId/dataroom': 'Data room',
  '/deal/:dealId/workbench': 'Valuation workbench',
  '/deal/:dealId/report': 'Appraisal report',
  '/deal/:dealId/redbook': 'Red Book valuation',
  '/deal/:dealId/engagement': 'Terms of engagement',
  // the SIGNED document, not the screen that drafts it — two routes, two things
  '/deal/:dealId/engagement/document': 'Engagement document',
  '*': 'Page not found',
};

/** Does a concrete pathname sit on this route pattern? `:param` takes one segment. */
export function matchesPattern(pattern: string, pathname: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length) return false;
  return p.every((seg, i) => seg.startsWith(':') || seg === a[i]);
}

/**
 * The pattern this pathname is on. Exact literals are tried before patterns,
 * for the same reason React Router ranks them that way: `/terms` is the terms
 * of service and `/terms/:token` is a client signing one, and a matcher that
 * took the first pattern to fit would title them alike.
 */
export function patternFor(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  const patterns = Object.keys(ROUTE_TITLES).filter((k) => k !== '*');
  const exact = patterns.find((k) => k === path);
  if (exact) return exact;
  return patterns.find((k) => k.includes(':') && matchesPattern(k, path)) ?? '*';
}

/** The full `document.title` for a pathname. */
export function titleFor(pathname: string): string {
  const pattern = patternFor(pathname);
  const name = ROUTE_TITLES[pattern] ?? ROUTE_TITLES['*'];
  return CLIENT_FACING.has(pattern) ? name : `${name} · ${PRODUCT}`;
}
