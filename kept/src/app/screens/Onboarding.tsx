import { color, shadow } from '../../tokens';
import { Pressable } from '../components/Pressable';
import { Logo, Wordmark } from '../components/Icons';

const STEPS = [
  {
    title: 'Every receipt, remembered.',
    body: 'Paste an order email or snap the paper slip. Kept reads the store, the total and the date — and starts the clock for you.',
  },
  {
    title: 'Two clocks. We watch both.',
    body: 'The shop’s return window and your legal rights under the Consumer Rights Act. You get pinged before either runs out.',
  },
  {
    title: 'Your receipts stay yours.',
    body: 'No account. No cloud. Nothing uploaded. Policy updates download to your phone — your purchases never leave it.',
  },
] as const;

export const ONBOARDING_STEPS = STEPS.length;

interface Props {
  step: number;
  onNext: () => void;
  onSkip: () => void;
}

export function Onboarding({ step, onNext, onSkip }: Props) {
  const current = STEPS[step] ?? STEPS[0];
  return (
    <div className="k-fade" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '6px 24px 40px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo size={24} />
          <Wordmark size={20} />
        </div>
        <Pressable onClick={onSkip} style={{ width: 'auto', fontSize: 13, fontWeight: 700, color: color.muted, padding: 8 }}>
          Skip
        </Pressable>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            height: 190, borderRadius: 20, overflow: 'hidden',
            border: `1.5px solid ${color.ink}`, boxShadow: shadow.hardLg, marginBottom: 26,
          }}
        >
          <StepArt step={step} />
        </div>

        <h1 tabIndex={-1} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 30, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-1.2px', margin: 0 }}>
          {current.title}
        </h1>
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: color.body, marginTop: 14, marginBottom: 0 }}>{current.body}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        {/* A bare <div aria-label> is prohibited — no role, nothing to name.
            These dots are literally progress, so they say that. */}
        <div
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of ${STEPS.length}`}
          style={{ display: 'flex', gap: 6 }}
        >
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === step ? 22 : 8, height: 8, borderRadius: 999,
                background: i === step ? color.yellow : 'rgba(23,20,16,0.18)', transition: 'all .25s',
              }}
            />
          ))}
        </div>
        <Pressable
          className="k-cta-yellow"
          onClick={onNext}
          style={{
            width: 'auto', padding: '15px 30px', background: color.yellow, border: `1.5px solid ${color.ink}`,
            borderRadius: 999, fontWeight: 700, fontSize: 15, boxShadow: shadow.hard,
          }}
        >
          {step === STEPS.length - 1 ? 'Let’s go' : 'Next'}
        </Pressable>
      </div>
    </div>
  );
}

/**
 * Drawn, not photographed.
 *
 * The prototype left three empty photo slots here for stock imagery. Shipping
 * an app whose first screen is a grey "drop a photo" box is worse than
 * shipping one that draws its own idea, and these are built from the brand's
 * own ticket-and-line-work vocabulary, so they read as finished rather than
 * as a placeholder waiting for a photographer. Swap in real photography by
 * replacing this component; nothing else changes.
 */
function StepArt({ step }: { step: number }) {
  // The viewBox aspect deliberately matches the 190px-tall frame's own: with
  // `slice`, a squarer viewBox is scaled up to cover and the top and bottom of
  // the drawing are cropped away — which is how the first pass lost the tops
  // of the receipts.
  const common = { width: '100%', height: '100%', viewBox: '0 0 356 190', preserveAspectRatio: 'xMidYMid slice' } as const;
  const ticket = 'M8 1H32Q39 1 39 9V44L32.7 50 26.3 44 20 50 13.7 44 7.3 50 1 44V9Q1 1 8 1Z';

  if (step === 0) {
    // A scatter of receipts — the pile, tidied.
    return (
      <svg {...common} role="img" aria-label="A scatter of receipts, gathered">
        <rect width="356" height="190" fill={color.creamAlt} />
        {[
          { x: 26, y: 16, r: -13, fill: color.white },
          { x: 148, y: 12, r: 7, fill: color.yellowLight },
          { x: 262, y: 20, r: -6, fill: color.white },
          { x: 70, y: 100, r: 9, fill: color.white },
          { x: 194, y: 104, r: -10, fill: color.yellow },
          { x: 296, y: 96, r: 6, fill: color.white },
        ].map((t, i) => (
          <g key={i} transform={`translate(${t.x} ${t.y}) rotate(${t.r}) scale(1.3)`}>
            <path d={ticket} fill={t.fill} stroke={color.ink} strokeWidth="1.6" />
            <path d="M9 13h22M9 20h22M9 27h13" stroke={color.ink} strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
          </g>
        ))}
      </svg>
    );
  }

  if (step === 1) {
    // Two clocks, one further through its window than the other: the shop's
    // and the law's, which is the promise the screen is making.
    return (
      <svg {...common} role="img" aria-label="Two countdown clocks running side by side">
        <rect width="356" height="190" fill={color.ink} />
        <g transform="translate(122 95)">
          <circle r="52" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="9" />
          <circle r="52" fill="none" stroke={color.yellow} strokeWidth="9" strokeLinecap="round"
            strokeDasharray="327" strokeDashoffset="98" transform="rotate(-90)" />
          <path d="M0 -26V2l18 13" fill="none" stroke={color.cream} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g transform="translate(244 95)">
          <circle r="40" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="8" />
          <circle r="40" fill="none" stroke={color.onInkDanger} strokeWidth="8" strokeLinecap="round"
            strokeDasharray="251" strokeDashoffset="176" transform="rotate(-90)" />
          <path d="M0 -20V2l14 10" fill="none" stroke={color.cream} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    );
  }

  // A phone that keeps its own contents.
  return (
    <svg {...common} role="img" aria-label="A phone holding its receipts behind a lock">
      <rect width="356" height="190" fill={color.creamAlt} />
      <rect x="134" y="20" width="88" height="152" rx="18" fill={color.ink} />
      <rect x="141" y="27" width="74" height="138" rx="13" fill={color.cream} />
      <g transform="translate(161 50) scale(0.85)">
        <path d={ticket} fill={color.yellow} stroke={color.ink} strokeWidth="1.6" />
        <path d="M9 13h22M9 20h22M9 27h13" stroke={color.ink} strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
      </g>
      <g transform="translate(161 111)">
        <rect x="4" y="14" width="30" height="22" rx="6" fill={color.ink} />
        <path d="M11 14V9a8 8 0 0116 0v5" fill="none" stroke={color.ink} strokeWidth="4" />
        <circle cx="19" cy="25" r="3.5" fill={color.yellow} />
      </g>
      <path d="M44 62h44M44 78h28M268 108h44M282 124h28" stroke={color.fainter} strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
    </svg>
  );
}
