import { useEffect, useMemo, useRef, useState } from 'react';
import { color, paperGrain } from '../tokens';
import { dueAlerts, supersededKeys } from '../lib/alerts';
import { FEED_URL, mergeFeed, readFeed } from '../lib/policy-feed';
import { deliver } from './notify';
import { money, sumPence } from '../lib/money';
import { midSentence } from '../lib/words';
import { exportBackup, wipe } from '../lib/storage';
import { FEATURED_TIER } from '../lib/pricing';
import { SaveFailedBanner } from './components/SaveFailedBanner';
import { TabBar } from './components/TabBar';
import { UndoBar } from './components/UndoBar';
import { UpgradeNotice } from './components/UpgradeNotice';
import { Add } from './screens/Add';
import { Celebrate } from './screens/Celebrate';
import { Detail } from './screens/Detail';
import { Edit } from './screens/Edit';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { Watch } from './screens/Watch';
import { quotaFull, useApp } from './state';

export function App() {
  const { state, dispatch, today, saveFailed } = useApp();
  const { screen, settings } = state;

  const selected = state.receipts.find((r) => r.id === state.selId) ?? null;
  const activeStores = useMemo(
    () => new Set(state.receipts.filter((r) => r.status === 'active').map((r) => r.store)),
    [state.receipts],
  );

  /**
   * A policy change is only news if it lands on a receipt this person holds.
   * The banner and the tab-bar dot both read this, so an update about a shop
   * the user has never used never raises an alarm.
   */
  const affecting = state.updates.filter((u) => u.affectsStores.some((s) => activeStores.has(s)));
  const changedStores = new Set(affecting.flatMap((u) => u.affectsStores).filter((s) => activeStores.has(s)));
  const changedReceipts = state.receipts.filter((r) => r.status === 'active' && changedStores.has(r.store));
  const policyAlert =
    changedReceipts.length === 0
      ? null
      : changedReceipts.length === 1
        ? `${changedReceipts[0].store} changed its returns policy — your ${midSentence(changedReceipts[0].item)} is affected`
        : `${affecting.length} shops changed their returns policies — your receipts are affected`;

  const recovered = sumPence(state.receipts.filter((r) => r.status === 'returned').map((r) => r.amount));

  /**
   * Policy updates arrive rather than being frozen into the bundle. Served
   * from this app's own origin, and the download is of EVERY change — never a
   * query naming the shops this person holds, because that query would be the
   * leak the privacy notice rules out.
   */
  useEffect(() => {
    // The switch in Settings actually switches it.
    //
    // It was a stored boolean nothing read: the row said "Policy watch ·
    // Every launch · on", turning it off changed the word to "Off", and the
    // feed downloaded on every launch regardless. On an app whose privacy
    // card promises nothing is uploaded and whose only outbound request this
    // is, a control that claims to stop it and does not is the worst switch
    // to get wrong. The same defect the "Deadline alerts" row had, in the row
    // directly below it.
    if (!settings.policyWatch) return;
    let cancelled = false;
    fetch(FEED_URL, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => {
        const incoming = readFeed(doc);
        if (cancelled || !incoming || incoming.length === 0) return;
        dispatch({ type: 'feed', updates: mergeFeed(state.updates, incoming) });
      })
      .catch(() => {
        // Offline is the normal case for this app, and the bundled feed is
        // already on screen. A failed refresh is not worth telling anyone about.
      });
    return () => {
      cancelled = true;
    };
    // Once per launch, and again if someone switches the watch back on —
    // which is what a person who has just enabled it expects to happen.
    // Deliberately not depending on `state.updates`: that changes when the
    // fetch lands, and re-running it on every state change would refetch on
    // every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.policyWatch]);

  /**
   * Deadline alerts, computed on open and whenever the app comes back to the
   * foreground. That is the honest ceiling for a web app — see notify.ts — and
   * the Settings screen says so rather than implying a background service.
   */
  const delivering = useRef(false);
  useEffect(() => {
    if (!settings.deadlineAlerts) return;
    let cancelled = false;

    const run = async () => {
      // React 18 mounts effects twice in development; without this guard the
      // same alert is delivered twice before either is recorded.
      if (delivering.current) return;
      const alerts = dueAlerts(state.receipts, today, settings.urgentDays, new Set(state.alertsSent));
      if (alerts.length === 0) return;
      delivering.current = true;
      try {
        const shown = await deliver(alerts);
        if (cancelled || shown.length === 0) return;
        dispatch({ type: 'alerted', keys: shown.flatMap((a) => [a.key, ...supersededKeys(a)]) });
      } finally {
        delivering.current = false;
      }
    };

    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state.receipts, state.alertsSent, settings.deadlineAlerts, settings.urgentDays, today, dispatch]);
  const onboarding = screen === 'onboard';

  /**
   * Where focus goes when the screen changes.
   *
   * It went to `document.body`. Every screen here is a swap inside one page,
   * so the control that was clicked — a receipt row, Edit, Skip — unmounts as
   * the new screen arrives, and the browser has nowhere to put focus but the
   * document. Measured on four transitions: three lost it outright. What that
   * costs is not theoretical. A keyboard user's next Tab restarts at the top
   * of the document rather than continuing in the screen they just opened, and
   * a screen reader announces nothing at all — the app silently becomes a
   * different app, which is the SPA failure axe cannot see, because nothing
   * about the markup is wrong.
   *
   * The heading is the target rather than the container: it is what the new
   * screen IS, so announcing it says where you have arrived, and it puts the
   * tab order at the top of the new content. `tabIndex={-1}` in each screen
   * makes it focusable without adding a stop to the tab order.
   *
   * Not on first paint — landing on a fresh page with focus already moved is
   * its own kind of disorienting, and there has been no transition to report.
   */
  const firstPaint = useRef(true);
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    const h1 = document.querySelector<HTMLElement>('main h1');
    const heading = h1?.textContent?.trim() ?? '';

    // Focus is RESTORED where it was lost, never taken from a control the
    // person is still on. Tapping a row unmounts the row, so focus falls to
    // the document and has to be put somewhere; tapping a tab-bar button does
    // not, and moving focus off the tab bar there would make the app's primary
    // navigation the hardest thing on the page to reach — it sits after
    // </main>, so getting back to it means tabbing through the whole screen.
    if (document.activeElement === document.body || document.activeElement === null) {
      // preventScroll: the new screen is already at its top, and scrolling to
      // a heading that is already in view is a jump with no cause.
      h1?.focus({ preventScroll: true });
      setAnnounced('');
      return;
    }
    // Focus stayed put, so nothing has said the screen changed. The heading is
    // what the new screen IS, and it is the same words the focus move would
    // have read out — so the two paths tell the person the same thing.
    setAnnounced(heading);
  }, [screen, state.selId]);

  const exportNow = () => {
    // A backup that leaves the device only if the user says so — it goes to
    // their own file system through the browser's download, not to us.
    const blob = new Blob([exportBackup(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kept-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * The sentence the share puts on the clipboard — built here rather than
   * inside the handler, because the Celebrate screen has to be able to show it
   * when the copy fails.
   */
  /*
   * The second half is a claim about the product, and it was made whether or
   * not the product had done it: a receipt marked returned on the day it was
   * added, or with alerts switched off, still produced "kept. reminded me
   * before the window shut" for the person to send to their friends. It says
   * that only when kept actually said something first, and in time.
   */
  const winLine = state.celebrating
    ? `Just got ${money(state.celebrating.amount)} back from ${state.celebrating.store} — kept. ${
        state.celebrating.warned && state.celebrating.inTime
          ? 'reminded me before the window shut.'
          : 'keeps every return deadline in one place.'
      }`
    : '';

  const shareWin = async () => {
    const line = winLine;
    /*
     * Say which of the two things happened.
     *
     * It confirmed either way, on the reasoning that a control which appears
     * dead is worse than one that lies. Half right, and the same half this
     * codebase already got wrong once: `save` swallowed a failed write for the
     * same reason, and the fix was to say so rather than to stay quiet.
     *
     * `writeText` fails on an insecure origin — which is every deployment of
     * this over plain HTTP — and wherever the permission is refused. "Copied,
     * paste it anywhere" is then simply untrue, and the person finds out by
     * pasting nothing into a message to a friend.
     */
    let copied = false;
    try {
      await navigator.clipboard.writeText(line);
      copied = true;
    } catch {
      // Nowhere to report it but the screen, which is what the caller does.
    }
    dispatch({ type: 'shared', copied });
  };

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...paperGrain,
        // Room for the status bar on a phone, plus the design's own top inset.
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        boxSizing: 'border-box',
        color: color.ink,
        overflow: 'hidden',
      }}
    >
      {/* One main landmark. Without it every screen's content sits outside any
          region, which is what a screen reader's landmark navigation moves
          between. */}
      {/* Above the screen rather than over it: this is not a transient toast,
          it is a standing condition, and it must be visible wherever the person
          happens to be when it starts. */}
      {saveFailed && !onboarding && <SaveFailedBanner onExport={exportNow} />}

      {/* Announces a screen change that did not move focus — see the effect
          above. Rendered always so the region exists before it has anything to
          say: a live region added to the page at the same moment as its text
          is not reliably announced. */}
      <div className="k-sr" role="status" aria-live="polite">{announced}</div>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {onboarding && (
        <Onboarding
          step={state.obStep}
          onNext={() => dispatch({ type: 'ob-next' })}
          onSkip={() => dispatch({ type: 'ob-skip' })}
        />
      )}

      {screen === 'home' && (
        <Home
          receipts={state.receipts}
          today={today}
          urgentDays={settings.urgentDays}
          policyAlert={policyAlert}
          changedStores={changedStores}
          onOpen={(id) => dispatch({ type: 'open', id })}
          onReturn={(id) => dispatch({ type: 'return', id })}
          onAdd={() => dispatch({ type: 'go', screen: 'add' })}
          onWatch={() => dispatch({ type: 'go', screen: 'watch' })}
        />
      )}

      {screen === 'watch' && <Watch updates={state.updates} receipts={state.receipts} today={today} />}

      {screen === 'detail' && selected && (
        <Detail
          receipt={selected}
          today={today}
          urgentDays={settings.urgentDays}
          onBack={() => dispatch({ type: 'go', screen: 'home' })}
          onEdit={() => dispatch({ type: 'go', screen: 'edit' })}
          onReturn={() => dispatch({ type: 'return', id: selected.id })}
          onUnreturn={() => dispatch({ type: 'unreturn', id: selected.id })}
          onDelete={() => dispatch({ type: 'delete', id: selected.id })}
        />
      )}

      {screen === 'edit' && selected && (
        <Edit
          receipt={selected}
          today={today}
          onSave={(receipt) => dispatch({ type: 'update', receipt })}
          onCancel={() => dispatch({ type: 'go', screen: 'detail' })}
        />
      )}

      {screen === 'add' && (
        <Add
          today={today}
          sharedText={state.sharedText ?? undefined}
          quotaFull={quotaFull(state)}
          trackedTotal={money(sumPence(state.receipts.map((r) => r.amount)))}
          onSave={(receipt) => dispatch({ type: 'add', receipt })}
          onUpgrade={() => dispatch({ type: 'upgrade-ask', period: FEATURED_TIER.period })}
        />
      )}

      {screen === 'settings' && (
        <Settings
          settings={settings}
          receipts={state.receipts}
          onExport={exportNow}
          onRestore={(receipts) => dispatch({ type: 'restore', receipts })}
          onWipe={() => {
            // Cleared from disk as well as from state: leaving the old blob
            // behind would mean "erase everything" removed it from the screen
            // and nowhere else.
            wipe();
            dispatch({ type: 'wipe' });
          }}
          onUpgrade={(period) => dispatch({ type: 'upgrade-ask', period })}
          onChange={(patch) => dispatch({ type: 'settings', patch })}
        />
      )}

      {screen === 'celebrate' && state.celebrating && (
        <Celebrate
          amount={state.celebrating.amount}
          store={state.celebrating.store}
          inTime={state.celebrating.inTime}
          recovered={recovered}
          shared={state.shared}
          line={winLine}
          onShare={shareWin}
          onDone={() => dispatch({ type: 'go', screen: 'home' })}
        />
      )}

      </main>

      {state.justDeleted && (
        <UndoBar
          label={`Deleted ${state.justDeleted.item}`}
          onUndo={() => dispatch({ type: 'undo-delete' })}
          onDismiss={() => dispatch({ type: 'dismiss-undo' })}
        />
      )}

      {state.upgrading && (
        <UpgradeNotice
          period={state.upgrading}
          onUnlock={() => dispatch({ type: 'settings', patch: { plan: 'pro' } })}
          onCancel={() => dispatch({ type: 'upgrade-cancel' })}
        />
      )}

      {!onboarding && (
        <TabBar
          screen={screen}
          alert={changedReceipts.length > 0}
          onGo={(s) => dispatch({ type: 'go', screen: s })}
        />
      )}
    </div>
  );
}
