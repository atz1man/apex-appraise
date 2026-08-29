import { useEffect, useReducer, useState } from 'react';
import { pruneSent } from '../lib/alerts';
import { startOfDay, toISODate } from '../lib/dates';
import { SHARE_PARAMS, sharedTextFrom } from '../lib/share';
import { makeReceiptId } from '../lib/receipts';
import { freshState, load, onExternalChange, save, type KeptState, type Settings } from '../lib/storage';
import { quotaFull as quotaFullFor } from '../lib/quota';
import type { Period } from '../lib/pricing';
import type { PolicyUpdate, Receipt, Screen } from '../lib/types';

export interface AppState extends KeptState {
  screen: Screen;
  /** An order email shared in from another app, waiting for the Add screen. */
  sharedText: string | null;
  /** True in the landing page's iframe demo: nothing is read or written to disk. */
  embedded: boolean;
  /**
   * The receipt just deleted, held only long enough to offer it back.
   * Deliberately not persisted: if the app is closed during the window the
   * delete stands, which is the safer reading of walking away.
   */
  justDeleted: Receipt | null;
  /** The receipt open on the detail screen. */
  selId: string | null;
  obStep: number;
  /** The refund the celebrate screen is showing; null when it is not showing one. */
  celebrating: { amount: number; store: string } | null;
  /**
   * What happened when the win was shared. Not a boolean, because "the copy
   * failed" and "it has not been tried" are different things to say — and the
   * button said "Copied ✓" for both.
   */
  shared: 'no' | 'copied' | 'failed';
  /**
   * The tier someone tapped, waiting to be told what tapping it actually does.
   *
   * It used to do this: flip `plan` to 'pro', immediately, with no card, no
   * confirmation and no word about either. Someone taps "£39.99 lifetime",
   * the paywall disappears, and the only reading available to them is that
   * they were charged £39.99. Payments are not built (see the README), so
   * nothing was — and an app that shows a price, takes a tap, and then behaves
   * as though money changed hands is making a claim about their bank account
   * that is not true.
   */
  upgrading: Period | null;
}

export type Action =
  | { type: 'go'; screen: Screen }
  | { type: 'open'; id: string }
  | { type: 'ob-next' }
  | { type: 'ob-skip' }
  | { type: 'return'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'unreturn'; id: string }
  | { type: 'undo-delete' }
  | { type: 'dismiss-undo' }
  | { type: 'wipe' }
  | { type: 'sync'; state: KeptState }
  | { type: 'add'; receipt: Receipt }
  | { type: 'update'; receipt: Receipt }
  | { type: 'restore'; receipts: Receipt[] }
  | { type: 'alerted'; keys: string[] }
  | { type: 'feed'; updates: PolicyUpdate[] }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'shared'; copied: boolean }
  | { type: 'upgrade-ask'; period: Period }
  | { type: 'upgrade-cancel' };

export function reducer(state: AppState, action: Action, today: Date): AppState {
  switch (action.type) {
    case 'go':
      // The edit screen belongs to the receipt open behind it, so the
      // selection survives the trip in both directions.
      return {
        ...state,
        justDeleted: null,
        screen: action.screen,
        selId: action.screen === 'detail' || action.screen === 'edit' ? state.selId : null,
      };
    case 'open':
      return { ...state, justDeleted: null, screen: 'detail', selId: action.id };
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
        shared: 'no',
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
      const removed = state.receipts.find((x) => x.id === action.id) ?? null;
      const receipts = state.receipts.filter((x) => x.id !== action.id);
      return {
        ...state,
        receipts,
        // Held so it can be offered back. Delete is one tap, immediate, and
        // was the only action in the app with no way out — a backup is not an
        // undo.
        justDeleted: removed,
        // Forget what we said about a receipt that no longer exists, so the
        // sent-list cannot grow without bound over years of use.
        alertsSent: pruneSent(state.alertsSent, receipts),
        screen: 'home',
        selId: null,
      };
    }
    case 'undo-delete': {
      const restoring = state.justDeleted;
      if (!restoring) return state;
      // Another tab can put the receipt back before the undo is tapped — its
      // own state still had it, and adopting that is the point of `sync`. In
      // practice the other tab usually adopts the delete first, but a lost or
      // late event leaves this reachable, and a duplicated receipt is a bad
      // way to find out: two rows, and the money counted twice.
      if (state.receipts.some((r) => r.id === restoring.id)) return { ...state, justDeleted: null };
      return { ...state, receipts: [...state.receipts, restoring], justDeleted: null };
    }
    case 'dismiss-undo':
      return state.justDeleted ? { ...state, justDeleted: null } : state;
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
      // Any settings change closes the notice: the only one that reaches it
      // is the unlock it was asking about, and leaving the sheet up over an
      // app that has just unlocked would be its own small lie.
      return { ...state, settings: { ...state.settings, ...action.patch }, upgrading: null };
    case 'upgrade-ask':
      return { ...state, upgrading: action.period };
    case 'upgrade-cancel':
      return { ...state, upgrading: null };
    case 'wipe':
      // Everything, including what the app remembers about having spoken:
      // alert keys naming receipts that no longer exist would be a residue of
      // exactly the thing the user just asked to be rid of.
      return {
        ...state,
        receipts: [],
        alertsSent: [],
        justDeleted: null,
        selId: null,
        screen: 'home',
      };
    case 'sync': {
      // Adopt what another tab stored, keeping this tab's transient UI —
      // screen, selection, an undo still on offer. If the receipt open here
      // was deleted there, fall back rather than showing a blank detail.
      const stillThere = state.selId && action.state.receipts.some((r) => r.id === state.selId);
      return {
        ...state,
        ...action.state,
        selId: stillThere ? state.selId : null,
        screen: stillThere || (state.screen !== 'detail' && state.screen !== 'edit') ? state.screen : 'home',
      };
    }
    case 'feed':
      return { ...state, updates: action.updates };
    case 'alerted':
      // Recorded only for what was actually shown (plus the gentler rungs it
      // superseded), so an alert that failed to display is tried again rather
      // than lost.
      return { ...state, alertsSent: [...new Set([...state.alertsSent, ...action.keys])] };
    case 'shared':
      return { ...state, shared: action.copied ? 'copied' : 'failed' };
  }
}

/**
 * `today` is fixed for the life of the session rather than read per render:
 * every screen derives its day-counts from it, and a value that changed
 * mid-render would let the home list and the detail ring disagree by a day
 * across a midnight boundary.
 */
export function useApp() {
  /**
   * The current day, and it has to stay current.
   *
   * This was memoised once per session, which is wrong for the one kind of app
   * where it matters most: phones resume a PWA from the background rather than
   * reloading it, so a deadline tracker left open overnight went on reporting
   * yesterday's counts — "2 days left" on the morning it had become the last
   * day. Every number on every screen derives from this value.
   *
   * Checked when the app comes back to the foreground, which is the common
   * case, and on a slow interval for the app that simply stays open. The
   * comparison is on the calendar day, so this sets state only when the date
   * actually turns over.
   */
  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    const check = () => {
      const now = startOfDay(new Date());
      setToday((current) => (now.getTime() === current.getTime() ? current : now));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);
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
        justDeleted: null,
        selId: null,
        obStep: 0,
        celebrating: null,
        shared: 'no',
        upgrading: null,
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

  /**
   * Whether the last write reached the disk. There is no server behind this,
   * so a failed write means the data is gone at the next launch while the
   * screen still shows it — the app has to say so.
   */
  const [saveFailed, setSaveFailed] = useState(false);

  // Another tab of the same app writes the whole library too. Adopting its
  // state is what stops this tab writing its own older copy over the top.
  useEffect(() => {
    if (state.embedded) return undefined;
    return onExternalChange((incoming) => rawDispatch({ type: 'sync', state: incoming }), today);
  }, [state.embedded, today]);

  useEffect(() => {
    if (state.embedded) return;
    const ok = save({
      version: state.version,
      receipts: state.receipts,
      updates: state.updates,
      onboardingSeen: state.onboardingSeen,
      settings: state.settings,
      alertsSent: state.alertsSent,
    });
    setSaveFailed(!ok);
  }, [state.embedded, state.version, state.receipts, state.updates, state.onboardingSeen, state.settings, state.alertsSent]);

  return { state, dispatch: rawDispatch, today, saveFailed };
}

export function quotaFull(state: AppState): boolean {
  return quotaFullFor(state.receipts, state.settings.plan);
}

export { makeReceiptId };
