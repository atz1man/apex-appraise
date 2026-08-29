import { useRef, useState } from 'react';
import { color, font, radius, shadow } from '../../tokens';
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

/**
 * The floor under a row's store name, in pixels. Matches the number the
 * layout sweep enforces — see `MIN_NAME_PX` in scripts/layout.mjs. Below this
 * a name is not truncated, it is erased.
 */
const MIN_NAME_PX = 64;

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
        // "(sample)" sits with the item rather than at the end, because the
        // agreement sweep reads the amount and the status off the last two
        // fields of this label — and because "mixer (sample)" is how a person
        // would say it.
        aria-label={`${receipt.store}, ${receipt.item}${receipt.demo ? ' (sample)' : ''}, ${money(receipt.amount)}, ${urgency.label}`}
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
          {/* Wraps, and the name keeps a floor.
              At 320px there is about 134px for this whole block and the
              POLICY CHANGED chip wants 95 of it, so with the chip refusing to
              shrink the name absorbed every pixel: "Zara" rendered 4px wide of
              32. Nothing failed — a squeezed name neither overflows the page
              nor covers a button — which is why the layout sweep now measures
              it. The chip drops to its own line when the two will not fit,
              instead of eating the one word that says whose return this is. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, rowGap: 4, minWidth: 0, flexWrap: 'wrap' }}>
            {/* Truncated like the item beneath it. A store name is free text —
                the edit form accepts anything — and an untruncated one wrapped
                to five lines on a 320px phone while the item it belongs to was
                still being clipped to one. */}
            {/* data-name is read by the layout sweep, which measures whether
                anything beside this has squeezed it past reading. */}
            <span data-name style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: MIN_NAME_PX }}>
              {receipt.store}
            </span>
            {policyChanged && (
              <span style={{ fontSize: 9.5, fontWeight: 700, background: color.yellowLight, padding: '2px 7px', borderRadius: 999, letterSpacing: '0.3px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                POLICY CHANGED
              </span>
            )}

          </div>
          {/* A fresh install opens on five receipts nobody added, and until
              this they were indistinguishable from real ones — which also made
              the "0 of 10 free receipts" beside them look like a bug rather
              than a deliberate generosity.

              On the ITEM line, not up beside the store name as a chip. Tried
              that: on a row that also carries POLICY CHANGED the store was
              crushed to "Cu…" and "Z…" on a 402px phone — two characters of
              the one word that says whose return this is. Nothing failed;
              every sweep was green, because a squeezed name does not overflow
              and does not cover a button.

              And BEFORE the item, not after it. Tried that too: this line
              truncates from the tail, so at 320px every row read "Kenwood
              kMix stan…" and the marker vanished on exactly the phone with
              the least room to explain itself. */}
          <div style={{ fontSize: 12, color: color.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {receipt.demo && <span>sample · </span>}
            {receipt.item}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: font.figures, fontSize: 15, fontWeight: 700 }}>{money(receipt.amount)}</div>
          <div style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: urgency.bg, color: urgency.fg }}>
            {urgency.label}
          </div>
        </div>
      </button>
    </li>
  );
}
