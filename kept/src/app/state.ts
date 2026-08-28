import { useEffect, useMemo, useReducer } from 'react';
import { pruneSent } from '../lib/alerts';
import { startOfDay, toISODate } from '../lib/dates';
import { SHARE_PARAMS, sharedTextFrom } from '../lib/share';
import { makeReceiptId } from '../lib/receipts';
import { freshState, load, save, type KeptState, type Settings } from '../lib/storage';
import { quotaFull as quotaFullFor } from '../lib/quota';
import type { PolicyUpdate, Receipt, Screen } from '../lib/types';

export interface AppState extends KeptState {
  screen: Screen;
  /** An order email shared in from another app, waiting for the Add screen. */
  sharedText: string | null;
  /** True in the landing page's iframe demo: nothing is read or written to disk. */
  embedded: boolean;
  /** The receipt open on the detail screen. */
  selId: string | null;
  obStep: number;
  /** The refund the celebrate screen is showing; null when it is not showing one. */
  celebrating: { amount: number; store: string } | null;
  shared: boolean;
}

export type Action =
  | { type: 'go'; screen: Screen }
  | { type: 'open'; id: string }
  | { type: 'ob-next' }
  | { type: 'ob-skip' }
  | { type: 'return'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'unreturn'; id: string }
  | { type: 'add'; receipt: Receipt }
  | { type: 'update'; receipt: Receipt }
  | { type: 'restore'; receipts: Receipt[] }
  | { type: 'alerted'; keys: string[] }
  | { type: 'feed'; updates: PolicyUpdate[] }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'shared' };

export function reducer(state: AppState, action: Action, today: Date): AppState {
  switch (action.type) {
    case 'go':
      // The edit screen belongs to the receipt open behind it, so the
      // selection survives the trip in both directions.
      return {
        ...state,
        screen: action.screen,
        selId: action.screen === 'detail' || action.screen === 'edit' ? state.selId : null,
      };
    case 'open':
      return { ...state, screen: 'detail', selId: action.id };
    case 'ob-next':
      return state.obStep >= 2
        ? { ...state, screen: 'home', onboardingSeen: true }
        : { ...state, obStep: state.obStep + 1 };
    case 'ob-skip':
      return { ...state, screen: 'home', onboardingSeen: true };
    case 'return': {
      const r = state.receipts.find((x) => x.id === action.id);
      if (!r || r.status === 'returned') return state;
      return {
        ...state,
        receipts: state.receipts.map((x) =>
          x.id === action.id ? { ...x, status: 'returned', returnedOn: toISODate(today) } : x,
        ),
        screen: 'celebrate',
        celebrating: { amount: r.amount, store: r.store },
        shared: false,
        selId: null,
      };
    }
    case 'unreturn':
      // The swipe is a one-finger gesture on a row you might have meant to
      // open, so it is going to fire by accident. Putting the receipt back is
      // the whole point of being able to reach it again.
      return {
        ...state,
        receipts: state.receipts.map((r) =>
          r.id === action.id ? { ...r, status: 'active' as const, returnedOn: undefined } : r,
        ),
      };
    case 'delete': {
      const receipts = state.receipts.filter((x) => x.id !== action.id);
      // Forget what we said about a receipt that no longer exists, so the
      // sent-list cannot grow without bound over years of use.
      return { ...state, receipts, alertsSent: pruneSent(state.alertsSent, receipts), screen: 'home', selId: null };
    }
    case 'add':
      return { ...state, receipts: [...state.receipts, action.receipt], screen: 'home' };
    case 'update':
      return {
        ...state,
        receipts: state.receipts.map((r) => (r.id === action.receipt.id ? action.receipt : r)),
        screen: 'detail',
        selId: action.receipt.id,
      };
    case 'restore':
      // Deliberately stays on Settings: the screen reports what the restore
      // actually did ("12 restored · 2 updated"), and bouncing to the list
      // would throw that away at the moment it matters most.
      return {
        ...state,
        receipts: action.receipts,
        alertsSent: pruneSent(state.alertsSent, action.receipts),
        selId: null,
      };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'feed':
      return { ...state, updates: action.updates };
    case 'alerted':
      // Recorded only for what was actually shown (plus the gentler rungs it
      // superseded), so an alert that failed to display is tried again rather
      // than lost.
      return { ...state, alertsSent: [...new Set([...state.alertsSent, ...action.keys])] };
    case 'shared':
      return { ...state, shared: true };
  }
}

/**
 * `today` is fixed for the life of the session rather than read per render:
 * every screen derives its day-counts from it, and a value that changed
 * mid-render would let the home list and the detail ring disagree by a day
 * across a midnight boundary.
 */
export function useApp() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [state, rawDispatch] = useReducer(
    (s: AppState, a: Action) => reducer(s, a, today),
    today,
    (t): AppState => {
      const persisted = load(t);
      // The landing page embeds this same build in an iframe as its live
      // demo. A visitor who has never opened the app should land on the
      // receipts list there, not on step one of an onboarding flow they
      // cannot see the point of yet.
      const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
      const embedded = params.has('embed');
      const incoming = sharedTextFrom(params);
      // The demo on the marketing page is this same build at this same origin,
      // so it was reading and writing the real app's storage: swipe a receipt
      // in the shop window and you had changed what the installed app shows.
      // It runs entirely in memory instead — fully working, resetting to the
      // designed state on every load, touching nothing.
      const base = embedded ? freshState(t) : persisted;
      return {
        ...base,
        // A shared order goes straight to Add, whether or not onboarding was
        // ever finished: someone who shared an email is telling you exactly
        // what they came to do.
        screen: incoming ? 'add' : base.onboardingSeen || embedded ? 'home' : 'onboard',
        sharedText: incoming,
        embedded,
        selId: null,
        obStep: 0,
        celebrating: null,
        shared: false,
      };
    },
  );

  // Strip the shared payload from the address bar once it is in hand: a
  // reload must not silently re-add the same receipt, and an order email has
  // no business sitting in browser history.
  useEffect(() => {
    if (typeof location === 'undefined' || typeof history === 'undefined') return;
    const url = new URL(location.href);
    if (!SHARE_PARAMS.some((k) => url.searchParams.has(k))) return;
    for (const k of SHARE_PARAMS) url.searchParams.delete(k);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    if (state.embedded) return;
    save({
      version: state.version,
      receipts: state.receipts,
      updates: state.updates,
      onboardingSeen: state.onboardingSeen,
      settings: state.settings,
      alertsSent: state.alertsSent,
    });
  }, [state.embedded, state.version, state.receipts, state.updates, state.onboardingSeen, state.settings, state.alertsSent]);

  return { state, dispatch: rawDispatch, today };
}

export function quotaFull(state: AppState): boolean {
  return quotaFullFor(state.receipts, state.settings.plan);
}

export { makeReceiptId };
