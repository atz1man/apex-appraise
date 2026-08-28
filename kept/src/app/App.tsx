import { useMemo } from 'react';
import { color, paperGrain } from '../tokens';
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
