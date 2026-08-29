import { describe, expect, it } from 'vitest';
import { hydrate, DEFAULT_SETTINGS } from '../src/lib/storage';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);

const good: Receipt = {
  id: 'r1', store: 'Currys', item: 'Headphones', cat: 'audio', amount: toPence(89),
  purchasedOn: '2026-08-16', windowDays: 14, policy: 'p', legalDays: 30, status: 'active',
};

const stored = (over: Record<string, unknown> = {}) => ({
  version: 1, receipts: [good], updates: [], onboardingSeen: true,
  settings: DEFAULT_SETTINGS, alertsSent: [], ...over,
});

describe('surviving whatever is on disk', () => {
  it('reads a well-formed store', () => {
    const s = hydrate(stored(), TODAY);
    expect(s.receipts).toEqual([good]);
    expect(s.onboardingSeen).toBe(true);
  });

  it('drops an unreadable receipt instead of taking the app down', () => {
    // This is the case that produced a blank screen on every launch, with no
    // way out but clearing site data by hand: one row missing its date.
    const s = hydrate(stored({ receipts: [{ ...good, purchasedOn: undefined }, { ...good, id: 'r2' }] }), TODAY);
    expect(s.receipts.map((r) => r.id)).toEqual(['r2']);
  });

  it.each([
    ['a missing date', { purchasedOn: undefined }],
    ['a malformed date', { purchasedOn: 'yesterday' }],
    ['a date that only looks real', { purchasedOn: '2026-02-31' }],
    ['a float amount', { amount: 12.5 }],
    ['a missing store', { store: undefined }],
    ['a zero window', { windowDays: 0 }],
    ['an unknown status', { status: 'maybe' }],
  ])('drops a receipt with %s', (_label, patch) => {
    expect(hydrate(stored({ receipts: [{ ...good, ...patch }] }), TODAY).receipts).toEqual([]);
  });

  it('keeps an empty library empty rather than reseeding the demo', () => {
    // Someone who erased everything must not find the demo receipts back.
    expect(hydrate(stored({ receipts: [] }), TODAY).receipts).toEqual([]);
  });

  it('starts fresh when the shape is not a store at all', () => {
    expect(hydrate(null, TODAY).receipts.length).toBeGreaterThan(0);
    expect(hydrate('nonsense', TODAY).receipts.length).toBeGreaterThan(0);
    expect(hydrate({ receipts: 'not an array' }, TODAY).receipts.length).toBeGreaterThan(0);
  });

  it('drops an unreadable policy update and keeps the rest', () => {
    const update = { id: 'u1', store: 'Zara', changedOn: '2026-08-26', text: 'x', affectsStores: ['Zara'] };
    const s = hydrate(stored({ updates: [update, { broken: true }] }), TODAY);
    expect(s.updates.map((u) => u.id)).toEqual(['u1']);
  });

  it('reseeds the feed when nothing readable survived', () => {
    // The feed is downloadable content, so falling back is always safe.
    expect(hydrate(stored({ updates: [{ broken: true }] }), TODAY).updates.length).toBeGreaterThan(0);
  });

  it('fills in settings a older version never wrote', () => {
    const s = hydrate(stored({ settings: { urgentDays: 14 } }), TODAY);
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, urgentDays: 14 });
  });

  it('ignores junk in the alert list rather than choking on it', () => {
    expect(hydrate(stored({ alertsSent: ['r1:soon', 42, null] }), TODAY).alertsSent).toEqual(['r1:soon']);
  });
});
