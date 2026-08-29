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

/**
 * Which tab you are on, said twice.
 *
 * It was the pale fill alone: `yellowLight` against the bar's near-cream
 * measures **1.28:1**, where WCAG 2.1 SC 1.4.11 asks 3:1 of a state
 * indicator — and this is the app's only navigation. It also disappeared
 * entirely under forced colours, where a background is replaced by the
 * system's and a border is not, so a Windows high-contrast user had four
 * identical tabs.
 *
 * The border carries it now (17.6:1, and it survives forced colours) and the
 * fill stays, because two signals are the point.
 *
 * NO border on the inactive ones, not a transparent one — measured: under
 * forced colours a transparent border is forced to a system colour like any
 * other, so all four tabs came back outlined and the fix made the state less
 * visible than it started. The 1.5px is paid back in padding instead, so the
 * box is the same size either way and nothing shifts as you move between
 * tabs.
 */
const tab = (active: boolean) => ({
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 2,
  borderRadius: 999,
  background: active ? color.yellowLight : 'transparent',
  ...(active ? { border: `1.5px solid ${color.ink}` } : {}),
  width: 'auto',
  position: 'relative' as const,
  // Allowed to shrink. A flex item will not go below its content width
  // without this, which is how the bar came to be wider than the phone.
  minWidth: 0,
});

/*
 * The label truncates rather than the bar leaving the screen.
 *
 * At 10px this is the text a browser's minimum-font-size setting inflates
 * most — 10 to 18 is 1.8x — and at that size the four tabs need 370px. On a
 * 320px screen the bar, centred with translateX(-50%), sat from -25 to 345:
 * the R of "Receipts" cut off at one edge and "Settings" at the other, on the
 * app's only navigation. Nothing could see it, either. The shell is
 * `overflow: hidden`, so the page reported no sideways scroll at all and the
 * layout sweep passed.
 *
 * The accessible name is unaffected, so "Setti…" is only ever a visual last
 * resort — and a truncated label you can still tap beats a tab off the screen.
 */
const label = {
  fontSize: 10,
  fontWeight: 700,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis' as const,
  whiteSpace: 'nowrap' as const,
};

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
        // Never wider than the screen it floats over, whatever the text size.
        maxWidth: 'calc(100% - 16px)',
        boxSizing: 'border-box',
        borderRadius: 999,
        background: 'rgba(253,250,241,0.88)',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        border: `1.5px solid ${color.ink}`,
        boxShadow: shadow.tab,
        zIndex: 30,
      }}
    >
      <Pressable className={onReceipts ? 'k-tab k-tab-on' : 'k-tab'} style={tab(onReceipts)} aria-current={onReceipts ? 'page' : undefined} onClick={() => onGo('home')}>
        <ReceiptGlyph />
        <span style={label}>Receipts</span>
      </Pressable>

      <Pressable
        className={screen === 'watch' ? 'k-tab k-tab-on' : 'k-tab'}
        style={tab(screen === 'watch')}
        aria-current={screen === 'watch' ? 'page' : undefined}
        // The dot's meaning belongs to the TAB, as its name. Labelling the dot
        // itself glued "Policy updates affect your receipts" onto the front of
        // the button's accessible name, so the tab announced as a sentence and
        // stopped being findable by the word on it.
        aria-label={alert ? 'Watch — policy updates affect your receipts' : undefined}
        onClick={() => onGo('watch')}
      >
        {alert && (
          <span
            aria-hidden="true"
            /* Bordered as well as filled: under forced colours a background is
               replaced by the system's and the dot vanished, taking the one
               signal that a policy change touches a receipt you hold. */
            style={{ position: 'absolute', top: 4, right: 8, width: 7, height: 7, borderRadius: 999, background: color.danger, border: `1px solid ${color.danger}` }}
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

      <Pressable className={screen === 'settings' ? 'k-tab k-tab-on' : 'k-tab'} style={tab(screen === 'settings')} aria-current={screen === 'settings' ? 'page' : undefined} onClick={() => onGo('settings')}>
        <GearGlyph />
        <span style={label}>Settings</span>
      </Pressable>
    </nav>
  );
}
