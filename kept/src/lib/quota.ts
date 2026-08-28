import type { Receipt } from './types';

/** The free tier's ceiling, from the pricing on every surface. */
export const FREE_TIER_LIMIT = 10;

export type Plan = 'free' | 'pro';

/**
 * What counts against the free tier.
 *
 * ACTIVE receipts only, and this is a judgement worth stating. Counting every
 * receipt ever added would mean a slot is consumed permanently by a return the
 * person already made — so someone using the app exactly as intended, tracking
 * things and getting their money back, would hit the wall in a month and find
 * the app refusing to do the one thing it is for. A returned receipt is
 * finished business; its money is already recovered.
 *
 * If the business wants the stricter reading, this function is the only place
 * that changes.
 */
export function countedAgainstQuota(receipts: readonly Receipt[]): number {
  return receipts.filter((r) => r.status === 'active').length;
}

export function quotaFull(receipts: readonly Receipt[], plan: Plan): boolean {
  return plan === 'free' && countedAgainstQuota(receipts) >= FREE_TIER_LIMIT;
}

export function quotaRemaining(receipts: readonly Receipt[], plan: Plan): number {
  if (plan !== 'free') return Infinity;
  return Math.max(0, FREE_TIER_LIMIT - countedAgainstQuota(receipts));
}
