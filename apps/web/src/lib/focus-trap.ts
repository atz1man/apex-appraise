/**
 * Keeping keyboard focus inside a dialog while it is open.
 *
 * Measured across the five overlays this app renders: ONE — the marketing
 * page's product tour — declared `role="dialog"`. The primitive the product
 * itself uses, `Drawer`, declared none of it and managed no focus at all, and
 * six screens open one. So opening a drawer left focus on the button behind
 * the backdrop; the first Tab walked out of the drawer into a page the person
 * cannot see, blurred and greyed under an overlay, and kept going; Escape
 * closed the drawer and left focus on `<body>`, so the next Tab restarted at
 * the top of the document. The payment dialog was the same, plus no Escape at
 * all: a card form a keyboard user could not dismiss.
 *
 * The decision worth testing is which element Tab should reach at the two ends
 * of the ring, so it is lifted out of the component that cannot be tested and
 * lives here as a pure function.
 */

/**
 * Everything the browser will hand focus to on Tab.
 *
 * `iframe` is in the list on purpose — Stripe's card form is one, and if the
 * ring did not include it the wrap would land somewhere behind the dialog.
 * What this CANNOT do is trap focus once it is inside that iframe: keydown
 * does not cross the frame boundary, so the browser's own Tab order takes
 * over there. That is a real limit of the technique, not an oversight.
 */
export const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,object,embed,summary,[tabindex]:not([tabindex="-1"])';

/** The focusable descendants of a container, in tab order, skipping hidden ones. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0,
  );
}

/**
 * Where Tab should go, or `null` to let the browser do what it was going to.
 *
 * `elements` is the ring in tab order, `active` whatever has focus now.
 * Only the two ends are redirected — everything between them is the browser's
 * job and doing it by hand is how a trap starts disagreeing with the browser
 * about what is focusable.
 *
 * `active` not being in the ring at all means focus has already escaped (or
 * never arrived): Tab goes to the first element, Shift+Tab to the last. That
 * is the case that matters most, because it is the one a person is in when
 * they cannot see where their cursor went.
 */
export function nextFocus<T>(elements: T[], active: T | null, shift: boolean): T | null {
  if (elements.length === 0) return null;
  const first = elements[0];
  const last = elements[elements.length - 1];
  const i = active === null ? -1 : elements.indexOf(active);
  if (i === -1) return shift ? last : first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}
