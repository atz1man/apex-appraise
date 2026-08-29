import { describe, expect, it } from 'vitest';
import { reducer, type AppState } from '../src/app/state';
import { toPence } from '../src/lib/money';
import { DEFAULT_SETTINGS } from '../src/lib/storage';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);

const receipt = (id: string): Receipt => ({
  id, store: 'Argos', item: 'Mixer', cat: 'kitchen', amount: toPence(64.99),
  purchasedOn: '2026-08-07', windowDays: 30, policy: 'p', distance: false, status: 'active',
});

const base = (over: Partial<AppState> = {}): AppState => ({
  version: 1, receipts: [receipt('a'), receipt('b')], updates: [], onboardingSeen: true,
  settings: { ...DEFAULT_SETTINGS }, alertsSent: [],
  screen: 'home', selId: null, obStep: 0, celebrating: null, shared: 'no',
  sharedText: null, embedded: false, justDeleted: null,
  ...over,
});

describe('sharing a win', () => {
  // It reported success either way, so a refused clipboard rendered as
  // "Copied — paste it anywhere ✓" and the person found out by pasting
  // nothing into a message to a friend.
  it('says it copied when it did', () => {
    expect(reducer(base(), { type: 'shared', copied: true }, TODAY).shared).toBe('copied');
  });

  it('says it did not when it did not', () => {
    expect(reducer(base(), { type: 'shared', copied: false }, TODAY).shared).toBe('failed');
  });

  it('starts having said nothing', () => {
    expect(base().shared).toBe('no');
  });
});

describe('undoing a delete', () => {
  it('puts the receipt back', () => {
    const deleted = reducer(base(), { type: 'delete', id: 'a' }, TODAY);
    expect(deleted.receipts.map((r) => r.id)).toEqual(['b']);
    const undone = reducer(deleted, { type: 'undo-delete' }, TODAY);
    expect(undone.receipts.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(undone.justDeleted).toBeNull();
  });

  it('does not duplicate one another tab already restored', () => {
    // Reachable when a second tab writes state that still contains the receipt
    // before the undo is tapped. Two rows for one receipt counts the money
    // twice, which is the one thing this app must not do.
    const deleted = reducer(base(), { type: 'delete', id: 'a' }, TODAY);
    const synced = reducer(deleted, { type: 'sync', state: {
      version: 1, receipts: [receipt('a'), receipt('b')], updates: [],
      onboardingSeen: true, settings: { ...DEFAULT_SETTINGS }, alertsSent: [],
    } }, TODAY);
    const undone = reducer(synced, { type: 'undo-delete' }, TODAY);
    expect(undone.receipts.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(undone.justDeleted).toBeNull();
  });

  it('does nothing when there is nothing to undo', () => {
    const s = base();
    expect(reducer(s, { type: 'undo-delete' }, TODAY)).toBe(s);
  });
});

describe('adopting another tab’s state', () => {
  it('keeps the screen you are on', () => {
    const s = base({ screen: 'settings' });
    const synced = reducer(s, { type: 'sync', state: {
      version: 1, receipts: [receipt('a')], updates: [], onboardingSeen: true,
      settings: { ...DEFAULT_SETTINGS }, alertsSent: [],
    } }, TODAY);
    expect(synced.screen).toBe('settings');
    expect(synced.receipts.map((r) => r.id)).toEqual(['a']);
  });

  it('leaves an open receipt open when it still exists', () => {
    const s = base({ screen: 'detail', selId: 'a' });
    const synced = reducer(s, { type: 'sync', state: {
      version: 1, receipts: [receipt('a'), receipt('b')], updates: [], onboardingSeen: true,
      settings: { ...DEFAULT_SETTINGS }, alertsSent: [],
    } }, TODAY);
    expect(synced).toMatchObject({ screen: 'detail', selId: 'a' });
  });

  it('falls back to the list when the open receipt was deleted elsewhere', () => {
    // Otherwise the detail screen renders nothing at all.
    for (const screen of ['detail', 'edit'] as const) {
      const s = base({ screen, selId: 'a' });
      const synced = reducer(s, { type: 'sync', state: {
        version: 1, receipts: [receipt('b')], updates: [], onboardingSeen: true,
        settings: { ...DEFAULT_SETTINGS }, alertsSent: [],
      } }, TODAY);
      expect(synced).toMatchObject({ screen: 'home', selId: null });
    }
  });
});
