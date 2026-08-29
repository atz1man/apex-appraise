import type { Category } from './types';

/**
 * The verified UK retailer policy table.
 *
 * This is the app's product, not a lookup convenience: the whole pitch is
 * that Kept knows each shop's REAL window and the trap inside it. Every entry
 * carries the window, the wording a user would need at the counter, and — the
 * part that actually saves money — where the clock starts. `clockStart:
 * 'dispatch'` is why a Zara coat can be out of time on the day it feels like
 * day 20.
 */
export interface StorePolicy {
  /** Canonical display name. */
  name: string;
  /** Lowercase strings that identify this retailer in a pasted order email. */
  aliases: string[];
  windowDays: number;
  policy: string;
  /** Where the return window starts counting. */
  clockStart: 'purchase' | 'dispatch';
  gotcha?: string;
  /**
   * True when this shop's name is also an ordinary word a receipt might use
   * for something else — "next day delivery", "walking boots".
   *
   * Those three retailers are why the paste parser will not name a shop on a
   * bare mention of their alias: a Vinted order for walking boots was reported
   * as a Boots purchase, with Boots' 35-day window and Boots' policy wording
   * quoted at the counter. Naming no shop is a flagged assumption on screen;
   * naming the wrong one is a confident lie. See `pickStore` in parse.ts for
   * what it takes to count instead.
   */
  commonWord?: boolean;
  /** Typical category, used to pick a row icon when nothing better is known. */
  cat?: Category;
}

export const STORE_POLICIES: readonly StorePolicy[] = [
  {
    name: 'Apple', commonWord: true, aliases: ['apple'], windowDays: 14, clockStart: 'purchase', cat: 'audio',
    policy: 'Apple · 14 days from delivery, any reason, original condition and packaging. Refund to the original payment method.',
    gotcha: 'Apple counts the 14 days from the day it arrives, and Kept counts from your order — so the date shown is the earliest it can be. If the parcel took three days, so does your deadline.',
  },
  {
    name: 'Amazon', aliases: ['amazon'], windowDays: 30, clockStart: 'purchase',
    policy: 'Amazon · 30 days from delivery for most items. Some categories (opened software, groceries) are excluded.',
    gotcha: 'Amazon counts the 30 days from the day it arrives, and Kept counts from your order — so the date shown is the earliest it can be, never the latest.',
  },
  {
    name: 'Currys', aliases: ['currys', 'pc world'], windowDays: 14, clockStart: 'purchase', cat: 'audio',
    policy: 'Currys · 14 days change of mind, unopened or unwanted. Refund to original payment method.',
  },
  {
    name: 'Argos', aliases: ['argos'], windowDays: 30, clockStart: 'purchase', cat: 'kitchen',
    policy: 'Argos · 30 days with proof of purchase. Return to any store or arrange collection.',
  },
  {
    name: 'IKEA', aliases: ['ikea'], windowDays: 365, clockStart: 'purchase', cat: 'furniture',
    policy: 'IKEA · 365 days, even assembled, with proof of purchase. 14 days for cut fabric.',
    gotcha: 'Cut fabric, plants and custom worktops get 14 days, not 365 — the long window does not cover them.',
  },
  {
    name: 'Zara', aliases: ['zara'], windowDays: 30, clockStart: 'dispatch', cat: 'clothing',
    policy: 'Zara · 30 days from dispatch, not delivery. Postal returns now £1.95 — in-store drop-off still free.',
    gotcha: 'Zara counts from the day the parcel is dispatched, not the day it arrives — the window is already running when it lands.',
  },
  {
    name: 'Boots', commonWord: true, aliases: ['boots'], windowDays: 35, clockStart: 'purchase', cat: 'beauty',
    policy: 'Boots · 35 days, unopened, with receipt. Advantage Card refunds go back as points.',
  },
  {
    name: 'Uniqlo', aliases: ['uniqlo'], windowDays: 30, clockStart: 'purchase', cat: 'clothing',
    policy: 'Uniqlo · 30 days, unworn with tags. Online orders are refunded by post only.',
    gotcha: 'Uniqlo will not refund an online order at the till — it has to go back by post.',
  },
  {
    name: 'ASOS', aliases: ['asos'], windowDays: 28, clockStart: 'purchase', cat: 'clothing',
    policy: 'ASOS · 28 days from delivery for a refund, 45 for credit. Frequent returners get the shorter window.',
    gotcha: 'ASOS counts the 28 days from the day it arrives, and Kept counts from your order — so the date shown is the earliest it can be. After 28 days it is credit, not a refund.',
  },
  {
    name: 'Next', commonWord: true, aliases: ['next'], windowDays: 28, clockStart: 'purchase', cat: 'clothing',
    policy: 'Next · 28 days, unworn with tags. Free returns to store or by courier collection.',
  },
  {
    name: 'John Lewis', aliases: ['john lewis'], windowDays: 35, clockStart: 'purchase',
    policy: 'John Lewis · 35 days with proof of purchase, unused and in original packaging.',
  },
  {
    name: 'M&S', aliases: ['m&s', 'marks and spencer', 'marks & spencer'], windowDays: 35, clockStart: 'purchase', cat: 'clothing',
    policy: 'M&S · 35 days with receipt, unworn with labels. Food and bought-in-store bras excluded.',
  },
  {
    name: 'H&M', aliases: ['h&m', 'hennes'], windowDays: 28, clockStart: 'purchase', cat: 'clothing',
    policy: 'H&M · 28 days, unworn with tags and receipt. Online returns free to store.',
  },
  {
    name: 'Sports Direct', aliases: ['sports direct', 'sportsdirect'], windowDays: 28, clockStart: 'purchase', cat: 'clothing',
    policy: 'Sports Direct · 28 days, unworn with tags. Online returns are charged unless faulty.',
  },
  {
    name: 'Screwfix', aliases: ['screwfix'], windowDays: 30, clockStart: 'purchase',
    policy: 'Screwfix · 30 days, unused and in original packaging, to any branch.',
  },
  {
    name: 'B&Q', aliases: ['b&q', 'b and q'], windowDays: 90, clockStart: 'purchase', cat: 'furniture',
    policy: 'B&Q · 90 days with proof of purchase, unused. Cut timber and mixed paint excluded.',
    gotcha: 'Cut-to-size timber and colour-mixed paint are non-returnable, whatever the receipt says.',
  },
  {
    name: 'Wickes', aliases: ['wickes'], windowDays: 30, clockStart: 'purchase', cat: 'furniture',
    policy: 'Wickes · 30 days, unused and in original packaging, with proof of purchase.',
  },
  {
    name: 'Decathlon', aliases: ['decathlon'], windowDays: 365, clockStart: 'purchase',
    policy: 'Decathlon · 365 days, unused with proof of purchase. Worn items assessed in store.',
  },
  {
    name: 'Sainsbury’s', aliases: ['sainsbury', 'sainsburys', 'sainsbury’s'], windowDays: 30, clockStart: 'purchase',
    policy: 'Sainsbury’s · 30 days with receipt for non-food. Electricals must be unopened.',
  },
  {
    name: 'Tesco', aliases: ['tesco'], windowDays: 30, clockStart: 'purchase',
    policy: 'Tesco · 30 days with receipt for non-food, in original condition.',
  },
] as const;

/** How many retailers the marketing copy may honestly claim. */
export const VERIFIED_STORE_COUNT = STORE_POLICIES.length;

/**
 * The day someone last checked all of these against the retailers' own
 * published terms — not the day the file was last edited.
 *
 * `null` until that has actually happened, and the Settings screen says so
 * rather than implying otherwise. It said "20 verified today", which nothing
 * anywhere recorded or could have recorded: this table is maintained by hand
 * and the README's own pre-ship task is to check every entry. Claiming
 * freshness for the data the whole product rests on, on the screen where
 * someone would go to ask about it, is the worst place to be vague.
 *
 * Same shape as `SOCIAL_PROOF_IS_PLACEHOLDER` on the landing page, for the
 * same reason: content that is not yet true says so, visibly, until it is.
 */
export const TABLE_CHECKED_ON: string | null = null;

const BY_ALIAS = new Map<string, StorePolicy>();
for (const s of STORE_POLICIES) for (const a of s.aliases) BY_ALIAS.set(a, s);

/**
 * The sentence a receipt carries about its return window.
 *
 * Derived from the shop AND the window together, because they are one fact
 * stated two ways and they were drifting apart. A receipt keeps its own
 * `windowDays` — the terms it was bought under, which is right — and it also
 * kept the table's sentence whatever happened to that number: editing a Boots
 * receipt from 35 days to 20 left the detail screen showing RETURN BY 9 Sept
 * above a STORE POLICY card reading "Boots · 35 days". Fifteen days apart, on
 * one screen, and the card is the wording someone repeats at a counter — so
 * the number they would act on was the wrong one, in the direction that makes
 * them late.
 *
 * The table's own wording is used only while the window still matches it.
 * Anything else says what the receipt actually holds and admits it is not
 * verified. One function, so the add screen and the edit screen cannot phrase
 * the same situation differently — which they already did.
 */
export function policyFor(store: string, windowDays: number): string {
  const known = findStore(store);
  if (known && known.windowDays === windowDays) return known.policy;
  return `${store} · ${windowDays}-day return window — as entered, not verified. Check the receipt.`;
}

/**
 * The shop's own name for whatever someone typed.
 *
 * A receipt's `store` is not only a label: `assess` matches a policy update's
 * `affectsStores` against it exactly, so a receipt saved as "boots" is a
 * receipt every change Boots publishes silently misses — no banner, no flag on
 * the Watch tab — while the same receipt happily carries Boots' verified
 * 35-day policy text, because `findStore` is case-insensitive and the rest of
 * the app was not.
 */
export function canonicalStoreName(typed: string): string {
  return findStore(typed)?.name ?? typed.trim();
}

export function findStore(name: string): StorePolicy | undefined {
  return BY_ALIAS.get(name.trim().toLowerCase());
}

/**
 * Longest alias first, so "john lewis" is not swallowed by a future "john"
 * and "marks and spencer" beats a bare "m&s" appearing later in the same
 * email footer.
 */
export const ALIASES_BY_LENGTH: readonly { alias: string; store: StorePolicy }[] = [...BY_ALIAS.entries()]
  .map(([alias, store]) => ({ alias, store }))
  .sort((a, b) => b.alias.length - a.alias.length);
