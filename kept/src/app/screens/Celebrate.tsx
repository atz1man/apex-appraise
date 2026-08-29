import { color, radius, shadow } from '../../tokens';
import { money, type Pence } from '../../lib/money';
import { LogoChecked, LogoWatermark } from '../components/Icons';
import { Pressable } from '../components/Pressable';

interface Props {
  amount: Pence;
  store: string;
  /**
   * Whether the shop's own window was still open when this was marked
   * returned. The line below asserted it unconditionally, and the button that
   * leads here is offered on any active receipt — so a refund won AFTER the
   * window, which is the harder one and the one most worth celebrating, was
   * congratulated with a sentence that was not true.
   */
  inTime: boolean;
  recovered: Pence;
  shared: 'no' | 'copied' | 'failed';
  /** The sentence itself, so a failed copy can still be read and selected. */
  line: string;
  onShare: () => void;
  onDone: () => void;
}

export function Celebrate({ amount, store, inTime, recovered, shared, line, onShare, onDone }: Props) {
  return (
    // Bottom padding clears the floating tab bar. The design drew this screen
    // with the same 40px inset every full-bleed screen has, which puts "Back to
    // receipts" underneath the bar — visible, and unclickable.
    <div className="k-fade" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '6px 20px 104px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ background: color.ink, color: color.cream, borderRadius: radius.heroLg, padding: '30px 26px', boxShadow: shadow.yellowXl, position: 'relative', overflow: 'hidden' }}>
          <LogoWatermark style={{ position: 'absolute', top: -28, right: -34, transform: 'rotate(12deg)', opacity: 0.14 }} />
          <LogoChecked />
          <h1 tabIndex={-1} style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 12, letterSpacing: '2px', color: color.faint, fontWeight: 600, margin: '14px 0 0' }}>
            MONEY BACK
          </h1>
          <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 56, fontWeight: 700, letterSpacing: '-2.5px', color: color.yellow, marginTop: 4 }}>
            {money(amount)}
          </div>
          <div style={{ fontSize: 15, color: color.onInkBody, marginTop: 8 }}>
            {inTime
              ? `Recovered from ${store} before the window closed.`
              : `Recovered from ${store}, after the shop’s own window had closed.`}
          </div>
          <div style={{ borderTop: `1.5px dashed ${color.onInkDash}`, marginTop: 20, paddingTop: 14, display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Grotesk', monospace", fontSize: 12.5 }}>
            <span style={{ color: color.faint }}>kept back so far</span>
            <span style={{ color: color.yellow, fontWeight: 600 }}>{money(recovered)}</span>
          </div>
          <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 11, color: color.onInkFaint, marginTop: 14, textAlign: 'center', letterSpacing: '1px' }}>
            kept. — stop donating money to shops
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Pressable
          className="k-cta-yellow"
          onClick={onShare}
          style={{ padding: 16, textAlign: 'center', background: color.yellow, border: `1.5px solid ${color.ink}`, borderRadius: 999, fontWeight: 700, fontSize: 15, boxShadow: shadow.hard }}
        >
          {shared === 'copied' ? 'Copied — paste it anywhere ✓' : shared === 'failed' ? 'Copy it from here' : 'Share the win'}
        </Pressable>
        {/* A refused clipboard used to render as "Copied ✓". It fails on any
            insecure origin and wherever the permission is denied, and the
            person found out by pasting nothing into a message. The sentence
            itself is the honest fallback: it is right there to select. */}
        {shared === 'failed' && (
          <p
            role="status"
            style={{
              margin: 0, padding: '12px 14px', background: color.white, border: `1.5px solid ${color.border}`,
              borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, color: color.bodyStrong, userSelect: 'all',
            }}
          >
            {line}
          </p>
        )}
        <Pressable onClick={onDone} style={{ padding: 14, textAlign: 'center', fontWeight: 700, fontSize: 14, color: color.muted }}>
          Back to receipts
        </Pressable>
      </div>
    </div>
  );
}
