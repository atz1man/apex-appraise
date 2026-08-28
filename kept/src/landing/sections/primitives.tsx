import type { CSSProperties, ReactNode } from 'react';
import { color } from '../../tokens';
import { AppleGlyph } from '../../app/components/Icons';

export const WRAP: CSSProperties = { maxWidth: 1160, margin: '0 auto', padding: '0 28px' };

export function Eyebrow({ children, onInk }: { children: ReactNode; onInk?: boolean }) {
  return (
    <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 12, letterSpacing: '2.5px', color: onInk ? color.yellow : color.amber, fontWeight: 600 }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, maxWidth = 620 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 'clamp(30px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.03em', margin: '14px 0 0', maxWidth, lineHeight: 1.1 }}>
      {children}
    </h2>
  );
}

/**
 * The App Store button. It is an anchor, not a div: it is the page's whole
 * conversion path, and a control that cannot be opened in a new tab or
 * reached by keyboard is not one.
 */
export function AppStoreButton({ href = '#', large }: { href?: string; large?: boolean }) {
  return (
    <a
      className="k-ink"
      href={href}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, background: color.ink, color: color.cream,
        padding: large ? '15px 30px' : '14px 26px', borderRadius: 16, boxShadow: `4px 4px 0 ${color.yellow}`,
      }}
    >
      <AppleGlyph width={20} />
      <span>
        <span style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', opacity: 0.8 }}>DOWNLOAD ON THE</span>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>App Store</span>
      </span>
    </a>
  );
}

export function Card({ children, emphasised = true, style }: { children: ReactNode; emphasised?: boolean; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: color.white,
        border: `1.5px solid ${emphasised ? color.ink : color.borderSoft}`,
        borderRadius: 20,
        boxShadow: emphasised ? `4px 4px 0 ${color.ink}` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
