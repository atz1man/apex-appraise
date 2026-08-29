/**
 * What the product costs, in one place.
 *
 * The three prices were literals in four places across two entry points — the
 * landing page's pricing cards, the Settings tiers, the upsell on the add
 * screen — and the free tier's size was a bare "10" written twice more in the
 * marketing copy beside a `FREE_TIER_LIMIT` the app actually enforced. Nothing
 * checked that any of them agreed, and nothing could: the agreement suite
 * walks the app, and half of these are on the landing page.
 *
 * A price that says one thing on the page someone bought from and another in
 * the app is not a cosmetic drift.
 *
 * Only the price and the period live here. The copy around them — a tier's
 * name, its selling lines — is genuinely different on a marketing page and in
 * a settings sheet, and forcing those to be the same string would be sharing
 * for its own sake.
 */
export type Period = 'monthly' | 'yearly' | 'lifetime';

export interface Tier {
  period: Period;
  /** As displayed, in pounds. */
  price: string;
  /** What follows the price where the two are shown together: "/mo", " once". */
  suffix: string;
  /** The one the pricing cards lead with. Exactly one tier carries it. */
  featured?: boolean;
}

export const TIERS: readonly Tier[] = [
  { period: 'monthly', price: '£2.99', suffix: '/mo' },
  { period: 'yearly', price: '£16.99', suffix: '/yr', featured: true },
  { period: 'lifetime', price: '£39.99', suffix: ' once' },
];

/** The tier every upsell in the app points at. */
export const FEATURED_TIER: Tier = TIERS.find((t) => t.featured) ?? TIERS[0];
