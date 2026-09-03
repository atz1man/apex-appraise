import { useEffect } from 'react';

/**
 * The browser's own "leave site?" prompt, on the three screens that hold work
 * only they know about.
 *
 * Measured before this: `beforeunload` appears nowhere in the source, and
 * neither does any navigation blocker. Three screens track a `dirty` flag —
 * the development appraisal, the valuation workbench, the terms of engagement
 * — which is to say each one KNOWS the work is unsaved. Each prints it, on a
 * button that reads "Save appraisal" instead of "Saved". And each would let
 * the tab close on it without a word.
 *
 * These are not idle screens. The appraisal is every financial input behind a
 * residual; the workbench is the Market Value opinion that goes on to the Red
 * Book; the engagement is the terms a client will sign. Half an hour of a
 * valuer's work, on a reload.
 *
 * WHAT THIS DOES NOT COVER, and it is the more common case: clicking a link to
 * another screen inside the app. `beforeunload` does not fire for that, because
 * as far as the browser is concerned nothing is unloading.
 *
 * Blocking that needs either a data router (this app uses `<BrowserRouter>`,
 * where `useBlocker` is not available) or a document-level click interceptor.
 * The interceptor is a few lines, and the reason it is not here is measurable:
 * Playwright DISMISSES a dialog by default and no spec in this suite registers
 * a handler, so every existing spec that edits one of these screens and then
 * navigates would silently stay put. `screens.spec.ts` alone holds 49 fills and
 * 163 navigations. That is an audit, not an afternoon, and shipping the
 * interceptor without it trades a data-loss bug for a suite nobody trusts.
 *
 * The other tempting answer — keep the draft and restore it later — is worse
 * here rather than merely bigger. Silently putting a valuer's abandoned inputs
 * back into an appraisal means a figure nobody chose to enter can end up under
 * a signature. Losing unsaved work is bad; resurrecting it unasked is unsafe.
 */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      // both, deliberately: `preventDefault` is the modern spelling and
      // `returnValue` is what older engines still read
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
