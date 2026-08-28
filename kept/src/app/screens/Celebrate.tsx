import { color, radius, shadow } from '../../tokens';
import { money, type Pence } from '../../lib/money';
import { LogoChecked, LogoWatermark } from '../components/Icons';
import { Pressable } from '../components/Pressable';

interface Props {
  amount: Pence;
  store: string;
  recovered: Pence;
  shared: boolean;
  onShare: () => void;
  onDone: () => void;
}

export function Celebrate({ amount, store, recovered, shared, onShare, onDone }: Props) {
  return (
    // Bottom padding clears the floating tab bar. The design drew this screen
    // with the same 40px inset every full-bleed screen has, which puts "Back to
    // receipts" underneath the bar — visible, and unclickable.
    <div className="k-fade" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '6px 20px 104px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ background: color.ink, color: color.cream, borderRadius: radius.heroLg, padding: '30px 26px', boxShadow: shadow.yellowXl, position: 'relative', overflow: 'hidden' }}>
          <LogoWatermark style={{ position: 'absolute', top: -28, right: -34, transform: 'rotate(12deg)', opacity: 0.14 }} />
          <LogoChecked />
          <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 12, letterSpacing: '2px', color: color.faint, fontWeight: 600, marginTop: 14 }}>
            MONEY BACK
          </div>
          <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 56, fontWeight: 700, letterSpacing: '-2.5px', color: color.yellow, marginTop: 4 }}>
            {money(amount)}
          </div>
          <div style={{ fontSize: 15, color: color.onInkBody, marginTop: 8 }}>
            Recovered from {store} before the window closed.
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
          {shared ? 'Copied — paste it anywhere ✓' : 'Share the win'}
        </Pressable>
        <Pressable onClick={onDone} style={{ padding: 14, textAlign: 'center', fontWeight: 700, fontSize: 14, color: color.muted }}>
          Back to receipts
        </Pressable>
      </div>
    </div>
  );
}
