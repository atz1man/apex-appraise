import { useEffect, useRef } from 'react';
import { color, radius, shadow } from '../../tokens';
import { TIERS, type Period } from '../../lib/pricing';
import { Pressable } from './Pressable';

/**
 * What a tap on a price actually does, said out loud before it does it.
 *
 * Tapping a tier used to flip the plan to pro on the spot — no card, no
 * confirmation, no word about either. Someone taps "£39.99 lifetime", the
 * paywall vanishes, and the only reading available to them is that they were
 * charged £39.99. Nothing was charged: payments are not built. An app that
 * shows a price, accepts a tap and then behaves as though money changed hands
 * is making a claim about somebody's bank account, and it is a false one.
 *
 * So the sheet leads with the fact that costs money to get wrong — no card,
 * nothing taken — and only then offers the unlock, which is real. The tier
 * that was tapped is named, because "which one did I just press" is the next
 * question and the answer should not require closing this to go and look.
 */
export function UpgradeNotice({ period, onUnlock, onCancel }: { period: Period; onUnlock: () => void; onCancel: () => void }) {
  const tier = TIERS.find((t) => t.period === period) ?? TIERS[0];
  const sheet = useRef<HTMLDivElement>(null);

  // Focus moves into the sheet, and Escape closes it. Without both, a keyboard
  // or screen-reader user is told nothing has appeared and cannot leave it.
  useEffect(() => {
    sheet.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end',
        justifyContent: 'center', background: 'rgba(23,20,16,0.55)', padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upg-title"
        className="k-fade"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: color.white, borderRadius: radius.heroLg, border: `1.5px solid ${color.ink}`,
          boxShadow: shadow.hardLg, padding: '22px 20px 20px', width: '100%', maxWidth: 420,
          marginBottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <h2 id="upg-title" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
          Nothing has been charged
        </h2>
        <p style={{ fontSize: 14, color: color.body, lineHeight: 1.6, margin: '10px 0 0' }}>
          kept cannot take payments yet — there is no card box, no {tier.price} leaving your account, and nothing to
          cancel later. The {tier.period} price is what it is <em>meant</em> to cost.
        </p>
        <p style={{ fontSize: 14, color: color.body, lineHeight: 1.6, margin: '10px 0 0' }}>
          You can unlock everything now anyway, for free, and keep it.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 18 }}>
          <Pressable
            className="k-cta-yellow"
            onClick={onUnlock}
            style={{ padding: 14, textAlign: 'center', background: color.yellow, color: color.ink, border: `1.5px solid ${color.ink}`, borderRadius: radius.pill, fontWeight: 700, fontSize: 15 }}
          >
            Unlock everything, free
          </Pressable>
          <Pressable
            onClick={onCancel}
            style={{ padding: 12, textAlign: 'center', background: 'transparent', color: color.muted, borderRadius: radius.pill, fontWeight: 700, fontSize: 14 }}
          >
            Not now
          </Pressable>
        </div>
      </div>
    </div>
  );
}
