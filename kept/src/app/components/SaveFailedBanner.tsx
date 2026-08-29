import { color, shadow } from '../../tokens';
import { Warning } from './Icons';
import { Pressable } from './Pressable';

/**
 * The one failure this app cannot afford to hide.
 *
 * There is no server: a write that does not land means the receipts are gone
 * at the next launch, while the screen still shows them. Silence there is
 * worse than any error message, because the person finds out by losing money.
 *
 * Not dismissable, and it names the one action that actually preserves the
 * data rather than just apologising.
 */
export function SaveFailedBanner({ onExport }: { onExport: () => void }) {
  return (
    <div
      role="alert"
      style={{
        margin: '0 16px 10px',
        padding: '13px 15px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        background: color.ink,
        color: color.cream,
        border: `1.5px solid ${color.ink}`,
        borderRadius: 16,
        boxShadow: shadow.lift,
      }}
    >
      <Warning stroke={color.onInkDanger} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>This device isn’t saving</div>
        <div style={{ fontSize: 12.5, color: color.onInkBody, lineHeight: 1.5, marginTop: 3 }}>
          Storage is full or blocked. What you see is safe until you close the app — export a backup now, or it will
          be gone.
        </div>
        <Pressable
          className="k-cta-yellow"
          onClick={onExport}
          style={{
            width: 'auto', marginTop: 10, padding: '9px 16px', background: color.yellow,
            color: color.ink, borderRadius: 999, fontWeight: 700, fontSize: 13,
          }}
        >
          Export a backup
        </Pressable>
      </div>
    </div>
  );
}
