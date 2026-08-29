/**
 * What a view-only member may still do, in the browser.
 *
 * `d96e05b` made the API enforce what the team screen has always claimed: a
 * VIEWER's permission is "View", and every internal mutation now refuses one.
 * That closed the hole. It did not make the app honest — a view-only member
 * still saw every Save, Delete and Advance button, filled in the form behind it,
 * pressed it, and was told no afterwards.
 *
 * There is no automatic rule that separates a write control from a read one:
 * `onClick` covers "Delete unit" and "Close drawer" alike, and this app has no
 * shared input primitive to disable. So the work is in two layers, and only the
 * first is complete by construction:
 *
 *   1. THIS FILE, wired into the tRPC link chain. Every mutation the server
 *      would refuse is refused here first, locally, with the same words and no
 *      round trip. All ninety-eight call sites, no marking, no exceptions.
 *   2. `Button`'s `writes` prop, which greys the control out up front so the
 *      effort is never spent. That one IS per-site, and a control nobody has
 *      marked yet degrades to layer 1 rather than to a defect.
 *
 * The allowlist below is the drift risk, and it is the same shape as the defect
 * this whole branch has been chasing: a rule written down in two places. So it
 * is not trusted — `apps/api/test/viewer-readonly.test.ts` reads this file and
 * asserts the list equals the set of mutations the REAL router lets a viewer
 * through, by calling every one of them. If someone adds an `authedProcedure`
 * mutation and forgets this file, that test fails and names it.
 */

/** Mutations the server does NOT refuse a view-only member. */
export const VIEWER_MAY_RUN = [
  // public: no principal at all, so a role cannot be consulted
  'auth.login',
  'auth.ssoStart',
  'auth.ssoComplete',
  'auth.requestPasswordReset',
  'auth.resetPassword',
  'org.register',
  'engagement.sign',
  /**
   * Authenticated but not internal-only, and deliberately so. Locking a
   * view-only member out of their own credentials would turn a permission into
   * a security problem: the one mutation everybody must always be able to run
   * is the one that ends a session someone else is holding.
   */
  'auth.changePassword',
  // telemetry from the member's own browser; refusing it would only hide faults
  'org.reportClientError',
] as const;

const ALLOWED = new Set<string>(VIEWER_MAY_RUN);

/** The words the server uses, so a member is not told two different stories. */
export const READ_ONLY_MESSAGE =
  'Your account has view-only access to this workspace, so it cannot make changes. An administrator can change your role under Settings → Team.';

export const VIEW_ONLY_ROLE = 'VIEWER';

/** Is this signed-in principal a view-only member of the firm? */
export const isViewOnly = (p: { role: string; principalType: string } | null | undefined): boolean =>
  !!p && p.principalType === 'internal' && p.role === VIEW_ONLY_ROLE;

/** Would the server refuse this mutation for a view-only member? */
export const refusedForViewer = (path: string): boolean => !ALLOWED.has(path);
