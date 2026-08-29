import { describe, expect, it } from 'vitest';
import { reducer, type AppState } from '../src/app/state';
import { addDays, toISODate } from '../src/lib/dates';
import { ONBOARDING_STEPS } from '../src/app/screens/Onboarding';
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
  screen: 'home', selId: null, obStep: 0, celebrating: null, shared: 'no', upgrading: null,
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

describe('tapping a price', () => {
  // It used to dispatch the plan change directly, so a tap on "£39.99
  // lifetime" flipped the app to pro with no card taken and nothing said.
  it('opens the notice and leaves the plan alone', () => {
    const s = reducer(base(), { type: 'upgrade-ask', period: 'lifetime' }, TODAY);
    expect(s.upgrading).toBe('lifetime');
    expect(s.settings.plan).toBe('free');
  });

  it('unlocks nothing when the notice is dismissed', () => {
    const asked = reducer(base(), { type: 'upgrade-ask', period: 'yearly' }, TODAY);
    const closed = reducer(asked, { type: 'upgrade-cancel' }, TODAY);
    expect(closed.upgrading).toBeNull();
    expect(closed.settings.plan).toBe('free');
  });

  it('closes the notice when the unlock it was asking about goes through', () => {
    const asked = reducer(base(), { type: 'upgrade-ask', period: 'monthly' }, TODAY);
    const done = reducer(asked, { type: 'settings', patch: { plan: 'pro' } }, TODAY);
    expect(done.settings.plan).toBe('pro');
    expect(done.upgrading).toBeNull();
  });
});

describe('what the celebration is allowed to claim', () => {
  const closed = (over: Partial<Receipt> = {}): Receipt => ({
    ...receipt('late'),
    // 60 days ago on a 30-day window: the shop's window shut a month back.
    purchasedOn: toISODate(addDays(TODAY, -60)),
    ...over,
  });

  it('does not say "before the window closed" when it had closed', () => {
    // The button is offered on any active receipt, and a refund won after the
    // window — goodwill, or the faulty-goods route — is the harder one.
    const s = reducer(base({ receipts: [closed()] }), { type: 'return', id: 'late' }, TODAY);
    expect(s.celebrating?.inTime).toBe(false);
  });

  it('says it when the window really was open', () => {
    const s = reducer(base(), { type: 'return', id: 'a' }, TODAY);
    expect(s.celebrating?.inTime).toBe(true);
  });

  it('does not claim kept warned you when kept said nothing', () => {
    // The shareable line said "kept. reminded me before the window shut"
    // whether or not it had — a claim about the product, put in the user's
    // mouth, to be sent to their friends.
    const s = reducer(base({ alertsSent: [] }), { type: 'return', id: 'a' }, TODAY);
    expect(s.celebrating?.warned).toBe(false);
  });

  it('claims it when an alert really went out for that receipt', () => {
    const s = reducer(base({ alertsSent: ['a:soon'] }), { type: 'return', id: 'a' }, TODAY);
    expect(s.celebrating?.warned).toBe(true);
  });

  it('does not count an alert about a different receipt', () => {
    const s = reducer(base({ alertsSent: ['b:soon'] }), { type: 'return', id: 'a' }, TODAY);
    expect(s.celebrating?.warned).toBe(false);
  });
});

describe('the onboarding flow reaches its last slide', () => {
  it('advances through every step and finishes on the last', () => {
    // The reducer carried the last index as a literal 2 while
    // ONBOARDING_STEPS sat exported and unused. A fourth slide would have
    // been written, rendered, counted in "Step 4 of 4" — and unreachable.
    expect(ONBOARDING_STEPS).toBeGreaterThan(1);
    let s = base({ screen: 'onboard', obStep: 0, onboardingSeen: false });
    for (let i = 1; i < ONBOARDING_STEPS; i += 1) {
      s = reducer(s, { type: 'ob-next' }, TODAY);
      expect(s.obStep, `after ${i} taps`).toBe(i);
      expect(s.screen, `after ${i} taps`).toBe('onboard');
    }
    s = reducer(s, { type: 'ob-next' }, TODAY);
    expect(s.screen).toBe('home');
    expect(s.onboardingSeen).toBe(true);
  });
});
