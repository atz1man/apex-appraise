import { useEffect } from 'react';

/**
 * Not losing a valuer's afternoon, in the two ways it can go.
 *
 * Measured before any of this existed: `beforeunload` appeared nowhere in the
 * source, and neither did any navigation blocker. Three screens track a `dirty`
 * flag — the development appraisal, the valuation workbench, the terms of
 * engagement — which is to say each one KNOWS the work is unsaved. Each PRINTS
 * it, on a button reading "Save appraisal" rather than "Saved". The app knew,
 * said so, and then made no use of it at the moment the work was about to go.
 *
 * These are not idle screens. The appraisal is every financial input behind a
 * residual; the workbench is the Market Value opinion that carries into the Red
 * Book; the engagement is the terms a client will sign.
 *
 * Two exits, and they need different machinery. Closing the tab or reloading is
 * `beforeunload`, which is the browser's own prompt and cannot be styled or
 * worded. Clicking a link to another screen is NOT — as far as the browser is
 * concerned nothing is unloading — and that is the commoner exit by far.
 *
 * The second one is blocked by a document-level click interceptor, because this
 * app uses `<BrowserRouter>` and React Router's `useBlocker` needs a data
 * router. The interceptor was deferred once on the grounds that Playwright
 * dismisses dialogs by default and no spec in this suite registers a handler,
 * so any spec that edited one of these screens and then clicked away would
 * silently stay put. That was a real risk and the audit was owed. It has now
 * been run, and the answer is ZERO: every spec that leaves one of these three
 * screens does so with `page.goto`, which is a real navigation and not a click,
 * so the interceptor cannot touch it. The caution was right and the number was
 * cheap to get; I should have got it sooner.
 *
 * Still NOT done, and still on purpose: keeping the draft and restoring it
 * later. That is worse here rather than merely bigger — silently putting a
 * valuer's abandoned inputs back into an appraisal means a figure nobody chose
 * to enter can end up under a signature. Losing unsaved work is bad;
 * resurrecting it unasked is unsafe.
 */

/**
 * What is unsaved right now, by name. A registry rather than a boolean because
 * the message should say what is at stake — "changes to this appraisal" is a
 * different sentence from "changes to the terms of engagement", and a person
 * deciding whether to lose their work deserves the specific one.
 */
const unsaved = new Map<symbol, string>();

/** What has unsaved work, or null. */
export function unsavedWork(): string | null {
  const first = unsaved.values().next();
  return first.done ? null : first.value;
}

export function unsavedMessage(what: string): string {
  return `Your changes to ${what} have not been saved. Leave this page and lose them?`;
}

/**
 * Whether a click should be stopped and asked about.
 *
 * Lifted out of the listener because it is the whole decision, and a listener
 * is not testable while a predicate over plain values is. Every `false` below
 * is a case where the click does NOT take the person off this screen, so
 * interrupting them would be a prompt for nothing — which is how people learn
 * to dismiss prompts without reading them.
 */
export function shouldInterceptNavigation(click: {
  dirty: boolean;
  /** 0 is the primary button; anything else is a context or middle click */
  button: number;
  modifier: boolean;
  defaultPrevented: boolean;
  /** the anchor's `href` attribute, or null when the click was not on one */
  href: string | null;
  target: string | null;
  download: boolean;
  currentPath: string;
}): boolean {
  if (!click.dirty) return false;
  if (click.defaultPrevented) return false;
  // a middle click or ⌘/ctrl-click opens a new tab and leaves this one alone
  if (click.button !== 0 || click.modifier) return false;
  if (!click.href) return false;
  // an in-app route only: an absolute URL leaves for somewhere else entirely
  // and gets the browser's own prompt, and `#page` is the skip link
  if (!click.href.startsWith('/')) return false;
  if (click.target && click.target !== '_self') return false;
  // a download does not navigate
  if (click.download) return false;
  // clicking through to the screen you are already on loses nothing
  if (click.href === click.currentPath) return false;
  return true;
}

/**
 * Registers a screen's unsaved work, and warns before the tab closes on it.
 *
 * `what` names the work in the prompt. It is required rather than optional
 * because a default would be "your changes", and the point of the sentence is
 * to say which changes.
 */
export function useUnsavedWarning(dirty: boolean, what: string) {
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol(what);
    unsaved.set(token, what);
    const warn = (e: BeforeUnloadEvent) => {
      // both, deliberately: `preventDefault` is the modern spelling and
      // `returnValue` is what older engines still read
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      unsaved.delete(token);
    };
  }, [dirty, what]);
}

/** Test seam: the registry is module state, and a test has to be able to clear it. */
export function __resetUnsavedForTests() {
  unsaved.clear();
}
