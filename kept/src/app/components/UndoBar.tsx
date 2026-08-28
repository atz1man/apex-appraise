import { useEffect } from 'react';
import { color, shadow } from '../../tokens';
import { Pressable } from './Pressable';

/** Long enough to notice and reach, short enough not to linger. */
const DISMISS_AFTER_MS = 8000;

/**
 * The way back from a delete.
 *
 * Delete was one tap, immediate, and the only action in the app with no
 * recovery — on a screen you reach by tapping a row, next to a button you
 * might have been aiming for. A backup is not an undo.
 *
 * A timed offer rather than a confirmation dialog: confirmations tax every
 * deliberate delete to catch the rare accidental one, and this app's whole
 * posture is getting out of the way.
 */
export function UndoBar({ label, onUndo, onDismiss }: { label: string; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(t);
    // Re-armed whenever the offer changes, so a second delete gets its own
    // full window rather than inheriting the remains of the first.
  }, [label, onDismiss]);

  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        // Clear of the floating tab bar, which sits at bottom 24 and is 63 tall.
        bottom: 100,
        left: 16,
        right: 16,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px 12px 16px',
        background: color.ink,
        color: color.cream,
        border: `1.5px solid ${color.ink}`,
        borderRadius: 16,
        boxShadow: shadow.lift,
      }}
      className="k-fade"
    >
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{label}</span>
      <Pressable
        onClick={onUndo}
        style={{
          width: 'auto', flexShrink: 0, padding: '7px 14px', borderRadius: 999,
          background: color.yellow, color: color.ink, fontWeight: 700, fontSize: 13,
        }}
      >
        Undo
      </Pressable>
    </div>
  );
}
