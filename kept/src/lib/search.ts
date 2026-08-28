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
