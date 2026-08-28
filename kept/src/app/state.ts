import { useEffect, useMemo, useReducer } from 'react';
import { startOfDay, toISODate } from '../lib/dates';
import { makeReceiptId } from '../lib/receipts';
import { FREE_TIER_LIMIT, load, save, type KeptState, type Settings } from '../lib/storage';
import type { Receipt, Screen } from '../lib/types';

export interface AppState extends KeptState {
  screen: Screen;
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
  | { type: 'add'; receipt: Receipt }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'shared' };

export function reducer(state: AppState, action: Action, today: Date): AppState {
  switch (action.type) {
    case 'go':
      return { ...state, screen: action.screen, selId: action.screen === 'detail' ? state.selId : null };
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
    case 'delete':
      return { ...state, receipts: state.receipts.filter((x) => x.id !== action.id), screen: 'home', selId: null };
    case 'add':
      return { ...state, receipts: [...state.receipts, action.receipt], screen: 'home' };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
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
      const embedded = typeof location !== 'undefined' && new URLSearchParams(location.search).has('embed');
      return {
        ...persisted,
        screen: persisted.onboardingSeen || embedded ? 'home' : 'onboard',
        selId: null,
        obStep: 0,
        celebrating: null,
        shared: false,
      };
    },
  );

  useEffect(() => {
    save({
      version: state.version,
      receipts: state.receipts,
      updates: state.updates,
      onboardingSeen: state.onboardingSeen,
      settings: state.settings,
    });
  }, [state.version, state.receipts, state.updates, state.onboardingSeen, state.settings]);

  return { state, dispatch: rawDispatch, today };
}

/** The free tier counts every receipt ever added, returned ones included. */
export function quotaFull(state: AppState): boolean {
  return state.settings.plan === 'free' && state.receipts.length >= FREE_TIER_LIMIT;
}

export { makeReceiptId };
