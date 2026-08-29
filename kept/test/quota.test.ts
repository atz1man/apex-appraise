import { describe, expect, it } from 'vitest';
import { countedAgainstQuota, FREE_TIER_LIMIT, quotaFull, quotaRemaining } from '../src/lib/quota';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const receipt = (id: string, status: Receipt['status'] = 'active'): Receipt => ({
  id, store: 'Currys', item: 'Thing', cat: 'other', amount: toPence(10),
  purchasedOn: '2026-08-16', windowDays: 14, policy: 'p', distance: false, status,
});

const active = (n: number) => Array.from({ length: n }, (_, i) => receipt(`a${i}`));
const returned = (n: number) => Array.from({ length: n }, (_, i) => receipt(`r${i}`, 'returned'));

describe('what the free tier counts', () => {
  it('counts what you are still tracking', () => {
    expect(countedAgainstQuota(active(4))).toBe(4);
  });

  it('does not count a return you already made', () => {
    // Otherwise using the app exactly as intended fills the tier permanently,
    // and it starts refusing to do the one thing it is for.
    expect(countedAgainstQuota([...active(3), ...returned(20)])).toBe(3);
  });
});

describe('the ceiling', () => {
  it('is not full below the limit', () => {
    expect(quotaFull(active(FREE_TIER_LIMIT - 1), 'free')).toBe(false);
  });

  it('is full at the limit', () => {
    expect(quotaFull(active(FREE_TIER_LIMIT), 'free')).toBe(true);
  });

  it('reopens when something is returned', () => {
    const full = active(FREE_TIER_LIMIT);
    expect(quotaFull(full, 'free')).toBe(true);
    const oneReturned = [...full.slice(1), { ...full[0], status: 'returned' as const }];
    expect(quotaFull(oneReturned, 'free')).toBe(false);
  });

  it('does not apply on a paid plan', () => {
    expect(quotaFull(active(500), 'pro')).toBe(false);
    expect(quotaRemaining(active(500), 'pro')).toBe(Infinity);
  });
});

describe('how many are left', () => {
  it('counts down', () => {
    expect(quotaRemaining(active(7), 'free')).toBe(3);
  });

  it('never goes negative, even past the cap', () => {
    // A backup restored onto a free device can legitimately land over the line.
    expect(quotaRemaining(active(25), 'free')).toBe(0);
  });
});
