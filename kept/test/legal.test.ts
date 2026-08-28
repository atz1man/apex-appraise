import { describe, expect, it } from 'vitest';
import { addDays, toISODate } from '../src/lib/dates';
import { legalRight } from '../src/lib/legal';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);
const ago = (n: number) => toISODate(addDays(TODAY, -n));

const base: Receipt = {
  id: 'r', store: 'Zara', item: 'Coat', cat: 'clothing', amount: toPence(34.99),
  purchasedOn: ago(5), windowDays: 30, policy: 'p', legalDays: 14, status: 'active',
};

describe('legal rights', () => {
  it('does not tell you a right you still hold has ended', () => {
    // The prototype's wording was inverted here: a live 14-day cooling-off
    // period rendered as "ended". That is the one thing this screen must
    // never say, so it gets its own test.
    const r = legalRight(base, TODAY, true);
    expect(r.live).toBe(true);
    expect(r.body).not.toMatch(/passed|ended/i);
    expect(r.body).toContain('9 days left');
  });

  it('uses the singular on the last day', () => {
    expect(legalRight({ ...base, purchasedOn: ago(13) }, TODAY, true).body).toContain('1 day left');
  });

  it('is still live on the final day, not the day before', () => {
    expect(legalRight({ ...base, purchasedOn: ago(14) }, TODAY, true).live).toBe(true);
    expect(legalRight({ ...base, purchasedOn: ago(15) }, TODAY, true).live).toBe(false);
  });

  it('points at the shop window when cooling-off has run out but the shop has not', () => {
    const r = legalRight({ ...base, purchasedOn: ago(20) }, TODAY, true);
    expect(r.live).toBe(false);
    expect(r.body).toContain('shop’s own window above is still open');
  });

  it('does not claim an open shop window when there is none', () => {
    const r = legalRight({ ...base, purchasedOn: ago(20) }, TODAY, false);
    expect(r.body).not.toContain('still open');
    expect(r.body).toContain('repair or replacement');
  });

  it('counts the 30-day faulty-goods right from purchase', () => {
    const r = legalRight({ ...base, legalDays: 30, purchasedOn: ago(10) }, TODAY, true);
    expect(r.chip).toBe('Consumer Rights Act');
    expect(r.body).toContain('20 days left');
  });

  it('keeps the repair right alive after the 30 days lapse', () => {
    const r = legalRight({ ...base, legalDays: 30, purchasedOn: ago(60) }, TODAY, true);
    expect(r.live).toBe(false);
    expect(r.body).toContain('repair or replacement');
  });
});
