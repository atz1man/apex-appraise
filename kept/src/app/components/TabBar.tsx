import { color, shadow } from '../../tokens';
import type { Screen } from '../../lib/types';
import { BellGlyph, GearGlyph, PlusGlyph, ReceiptGlyph } from './Icons';
import { Pressable } from './Pressable';

interface Props {
  screen: Screen;
  /** A red dot rides the Watch tab when a policy change touches a held receipt. */
  alert: boolean;
  onGo: (s: Screen) => void;
}

const tab = (active: boolean) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 2,
  padding: '8px 14px',
  borderRadius: 999,
  background: active ? color.yellowLight : 'transparent',
  width: 'auto',
  position: 'relative' as const,
});

const label = { fontSize: 10, fontWeight: 700 };

export function TabBar({ screen, alert, onGo }: Props) {
  // The detail screen is reached from the receipts list, so the list stays lit
  // while it is open — the tab shows where you are in the app, not which
  // component happens to be mounted.
  const onReceipts = screen === 'home' || screen === 'detail';
  return (
    <nav
      aria-label="Main"
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 6,
        borderRadius: 999,
        background: 'rgba(253,250,241,0.88)',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        border: `1.5px solid ${color.ink}`,
        boxShadow: shadow.tab,
        zIndex: 30,
      }}
    >
      <Pressable style={tab(onReceipts)} aria-current={onReceipts ? 'page' : undefined} onClick={() => onGo('home')}>
        <ReceiptGlyph />
        <span style={label}>Receipts</span>
      </Pressable>

      <Pressable style={tab(screen === 'watch')} aria-current={screen === 'watch' ? 'page' : undefined} onClick={() => onGo('watch')}>
        {alert && (
          <span
            aria-label="Policy updates affect your receipts"
            role="status"
            style={{ position: 'absolute', top: 5, right: 9, width: 7, height: 7, borderRadius: 999, background: color.danger }}
          />
        )}
        <BellGlyph />
        <span style={label}>Watch</span>
      </Pressable>

      <Pressable
        className="k-cta-yellow"
        aria-label="Add a receipt"
        onClick={() => onGo('add')}
        style={{
          width: 46, height: 46, borderRadius: 999, background: color.yellow,
          border: `1.5px solid ${color.ink}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', margin: '0 4px', flexShrink: 0,
        }}
      >
        <PlusGlyph />
      </Pressable>

      <Pressable style={tab(screen === 'settings')} aria-current={screen === 'settings' ? 'page' : undefined} onClick={() => onGo('settings')}>
        <GearGlyph />
        <span style={label}>Settings</span>
      </Pressable>
    </nav>
  );
}
