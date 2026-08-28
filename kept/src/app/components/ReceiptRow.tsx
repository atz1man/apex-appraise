import { useRef, useState } from 'react';
import { color, radius, shadow } from '../../tokens';
import { money } from '../../lib/money';
import type { Receipt } from '../../lib/types';
import type { Urgency } from '../../lib/urgency';
import { CatIcon, Tick } from './Icons';

/** Past this many pixels of leftward drag, releasing marks the receipt returned. */
const COMMIT_PX = 80;
/** The row stops travelling here, so the yellow backing never fully takes over. */
const MAX_PX = 120;
/** Movement beyond this is a swipe, not a tap — the click that follows is dropped. */
const TAP_SLOP_PX = 8;

interface Props {
  receipt: Receipt;
  urgency: Urgency;
  /** Urgent rows get the ink border and hard shadow; later rows sit quieter. */
  emphasised: boolean;
  /** True when a watched policy change touches this receipt's retailer. */
  policyChanged: boolean;
  onOpen: () => void;
  onReturn: () => void;
}

export function ReceiptRow({ receipt, urgency, emphasised, policyChanged, onOpen, onReturn }: Props) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const swiped = useRef(false);

  const end = () => {
    const commit = dx < -COMMIT_PX;
    startX.current = null;
    setDragging(false);
    setDx(0);
    if (commit) onReturn();
  };

  return (
    <li style={{ position: 'relative', listStyle: 'none' }}>
      {/* The backing revealed by the swipe. Hidden from assistive tech: it is
          the visual result of a gesture, not a second control — the keyboard
          route to the same outcome is "Got my money back" on the detail screen. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'flex-end', paddingRight: 20, background: color.yellowLight,
          border: `1.5px solid ${color.ink}`, borderRadius: radius.card,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
          <Tick size={14} />
          Returned
        </span>
      </div>

      <button
        type="button"
        className={`k-press ${emphasised ? 'k-row-white' : 'k-row-plain'}`}
        onPointerDown={(e) => {
          startX.current = e.clientX;
          swiped.current = false;
          setDragging(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Pointer capture is a nicety; the drag still tracks without it.
          }
        }}
        onPointerMove={(e) => {
          if (startX.current === null) return;
          const next = Math.max(-MAX_PX, Math.min(0, e.clientX - startX.current));
          if (next < -TAP_SLOP_PX) swiped.current = true;
          setDx(next);
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          startX.current = null;
          setDragging(false);
          setDx(0);
        }}
        onClick={() => {
          // A finished swipe still fires a click; opening the detail screen on
          // top of the celebrate screen would bury the thing just confirmed.
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          onOpen();
        }}
        aria-label={`${receipt.store}, ${receipt.item}, ${money(receipt.amount)}, ${urgency.label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 13, padding: 15,
          background: emphasised ? color.white : color.cream,
          border: `1.5px solid ${emphasised ? color.ink : color.border}`,
          borderRadius: radius.card,
          boxShadow: emphasised ? shadow.hard : undefined,
          position: 'relative',
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform .25s ease',
          touchAction: 'pan-y',
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 12, background: color.creamAlt,
            border: `1px solid ${color.borderHair}`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
          }}
        >
          <CatIcon cat={receipt.cat} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{receipt.store}</span>
            {policyChanged && (
              <span style={{ fontSize: 9.5, fontWeight: 700, background: color.yellowLight, padding: '2px 7px', borderRadius: 999, letterSpacing: '0.3px' }}>
                POLICY CHANGED
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: color.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {receipt.item}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 15, fontWeight: 700 }}>{money(receipt.amount)}</div>
          <div style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: urgency.bg, color: urgency.fg }}>
            {urgency.label}
          </div>
        </div>
      </button>
    </li>
  );
}
