import { useEffect, useMemo, useRef } from 'react';
import { color, paperGrain } from '../tokens';
import { dueAlerts, supersededKeys } from '../lib/alerts';
import { FEED_URL, mergeFeed, readFeed } from '../lib/policy-feed';
import { deliver } from './notify';
import { money, sumPence } from '../lib/money';
import { exportBackup } from '../lib/storage';
import { TabBar } from './components/TabBar';
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
  const { state, dispatch, today } = useApp();
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
        ? `${changedReceipts[0].store} changed its returns policy — your ${changedReceipts[0].item.toLowerCase()} is affected`
        : `${affecting.length} shops changed their returns policies — your receipts are affected`;

  const recovered = sumPence(state.receipts.filter((r) => r.status === 'returned').map((r) => r.amount));

  /**
   * Policy updates arrive rather than being frozen into the bundle. Served
   * from this app's own origin, and the download is of EVERY change — never a
   * query naming the shops this person holds, because that query would be the
   * leak the privacy notice rules out.
   */
  useEffect(() => {
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
    // Once per launch: the feed changes daily at most, and re-running it on
    // every state change would refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const shareWin = async () => {
    const line = state.celebrating
      ? `Just got ${money(state.celebrating.amount)} back from ${state.celebrating.store} — kept. reminded me before the window shut.`
      : '';
    try {
      await navigator.clipboard.writeText(line);
    } catch {
      // Clipboard permission can be refused; the button still confirms so the
      // user is not left tapping a control that appears dead.
    }
    dispatch({ type: 'shared' });
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
          onUpgrade={() => dispatch({ type: 'settings', patch: { plan: 'pro' } })}
        />
      )}

      {screen === 'settings' && (
        <Settings
          settings={settings}
          receiptCount={state.receipts.length}
          receipts={state.receipts}
          onExport={exportNow}
          onRestore={(receipts) => dispatch({ type: 'restore', receipts })}
          onUpgrade={() => dispatch({ type: 'settings', patch: { plan: 'pro' } })}
          onChange={(patch) => dispatch({ type: 'settings', patch })}
        />
      )}

      {screen === 'celebrate' && state.celebrating && (
        <Celebrate
          amount={state.celebrating.amount}
          store={state.celebrating.store}
          recovered={recovered}
          shared={state.shared}
          onShare={shareWin}
          onDone={() => dispatch({ type: 'go', screen: 'home' })}
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
