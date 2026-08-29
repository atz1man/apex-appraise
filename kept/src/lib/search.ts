import type { Receipt } from './types';

/**
 * Finding a receipt once there are more than a screenful.
 *
 * The free tier caps at ten, so this is for the paid one, where the list is
 * unbounded and grouped by urgency rather than by shop — which is right for
 * "what must go back this week" and useless for "where did I put the
 * headphones".
 *
 * Deliberately plain: substring matching over the two fields a person
 * remembers, the shop and the thing. No fuzzy matching and no ranking — a
 * search that returns near-misses in a list about money and deadlines invites
 * acting on the wrong row.
 */

/** Every whitespace-separated term must appear somewhere. */
export function matches(receipt: Receipt, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${receipt.store} ${receipt.item}`.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export function search(receipts: readonly Receipt[], query: string): Receipt[] {
  if (!query.trim()) return [...receipts];
  return receipts.filter((r) => matches(r, query));
}

/**
 * Below this the list fits on a screen or two and a search box is just
 * furniture in the way of the thing it would search.
 */
export const SEARCH_APPEARS_ABOVE = 6;

export function shouldOfferSearch(receipts: readonly Receipt[]): boolean {
  return receipts.length > SEARCH_APPEARS_ABOVE;
}

/**
 * What the filter just did, for someone who cannot see the list change.
 *
 * Typing rewrote the list under the cursor and said nothing: a sighted person
 * watches thirty rows become three, and a screen-reader user hears the
 * keystroke and no more. WCAG 2.1 SC 4.1.3 asks that a result like this be
 * conveyed without moving focus — which is what a live region is for, and
 * axe cannot tell that one is missing.
 *
 * The empty case repeats the words already on the screen rather than
 * inventing its own, so the two are one message reaching two people.
 */
export function searchStatus(count: number, query: string): string {
  const q = query.trim();
  if (!q) return '';
  if (count === 0) return `Nothing matches ${q}`;
  return `${count} ${count === 1 ? 'receipt' : 'receipts'} match${count === 1 ? 'es' : ''} ${q}`;
}
