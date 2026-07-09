import { type CSSProperties, type ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { status as statusTokens, type StatusKey, assetTypeTag, avatarGradients, brandMarkGradient } from '@apex/ui-tokens';

// ---------- Brand ----------

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[8px] shrink-0"
      style={{ width: size, height: size, background: brandMarkGradient }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11 12 4l8 7" />
        <path d="M6 10v9h12v-9" />
      </svg>
    </span>
  );
}

export function BrandLockup() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <BrandMark />
      <span className="text-[15.5px] font-bold tracking-[-0.3px]">
        Apex <span className="text-brand-500">Appraise</span>
      </span>
    </Link>
  );
}

/** 56px sticky top bar: brand lockup → breadcrumb → right-side status/actions. */
export function TopBar({ crumb, right }: { crumb?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 h-14 bg-surface border-b border-border-strong flex items-center gap-3 px-5">
      <BrandLockup />
      {crumb && (
        <>
          <span className="text-[#C9CDC8]">/</span>
          <span className="text-[13.5px] font-medium text-ink-2">{crumb}</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-2.5">{right}</div>
    </header>
  );
}

// ---------- Text blocks ----------

export function EyebrowTitle({ eyebrow, title, sub, actions }: { eyebrow: string; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="mt-1.5 text-[27px] font-bold tracking-[-0.8px] leading-tight">{title}</h1>
        {sub && <div className="mt-1 text-[13.5px] text-ink-2">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  );
}

// ---------- Cards ----------

export function StatCard({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div className="flex-1 min-w-[130px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
      <div className="label-mono text-ink-3">{label}</div>
      <div className="fig mt-1.5 text-[21px] font-semibold tracking-[-1px]" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function Panel({ title, right, children, className = '', accent }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; accent?: string }) {
  return (
    <section
      className={`bg-surface border border-border-strong rounded-panel shadow-rest p-5 ${className}`}
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      {(title || right) && (
        <div className="flex items-center justify-between mb-3.5">
          {typeof title === 'string' ? <h3 className="text-[16px] font-semibold tracking-[-0.3px]">{title}</h3> : title}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- Status ----------

export function StatusChip({ status, label }: { status: StatusKey; label: string }) {
  const t = statusTokens[status];
  return (
    <span className="label-mono inline-flex items-center rounded-[7px] px-2 py-[3px]" style={{ color: t.text, background: t.bg }}>
      {label}
    </span>
  );
}

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: color }} />;
}

export function AssetTag({ type }: { type: string }) {
  const t = assetTypeTag[type] ?? assetTypeTag.INDUSTRIAL;
  return (
    <span className="label-mono inline-flex rounded-[6px] px-1.5 py-[2px]" style={{ color: t.text, background: t.bg }}>
      {type.replace('_', '-')}
    </span>
  );
}

export function Avatar({ initials, size = 26 }: { initials: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: avatarGradients[initials] ?? 'linear-gradient(135deg,#9AA09A,#6E7269)' }}
      title={initials}
    >
      {initials}
    </span>
  );
}

// ---------- Controls ----------

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const styles: Record<string, string> = {
    primary: 'bg-brand-700 text-white hover:bg-brand-600',
    secondary: 'bg-surface border border-border-strong text-ink-2 hover:bg-sunken',
    ghost: 'text-ink-2 hover:bg-sunken-2',
    danger: 'bg-surface border border-status-red text-status-red hover:bg-status-red-bg',
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[11px] px-3.5 h-[38px] text-[13px] font-semibold transition-all disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Segmented control: active = white pill + subtle shadow on a #F0EFE9 track. */
export function SegmentedToggle<T extends string>({ options, value, onChange }: { options: Array<[T, string]>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex bg-sunken-2 rounded-[11px] p-[3px] gap-[2px]">
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={`px-3 py-1.5 rounded-[9px] text-[12.5px] transition-all ${on ? 'bg-surface text-brand-700 font-semibold shadow-pill' : 'text-inactive font-medium'}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function ProgressBar({ pct, color = '#1E7A55', height = 6 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="rounded-[3px] bg-border-std overflow-hidden" style={{ height }}>
      <div className="h-full rounded-[3px] transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function EmptyState({ icon, children, cta }: { icon?: ReactNode; children: ReactNode; cta?: ReactNode }) {
  return (
    <div className="border border-dashed border-[#DAD9D2] rounded-[13px] py-8 px-4 flex flex-col items-center gap-2 text-center">
      {icon && <div className="text-[#C9CDC8]">{icon}</div>}
      <div className="text-[12.5px] text-ink-3b">{children}</div>
      {cta}
    </div>
  );
}

// ---------- Drawer ----------

export function Drawer({ open, onClose, title, children, width = 480 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(12,18,14,0.4)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div
        className="h-full bg-surface shadow-drawer animate-slideIn overflow-y-auto"
        style={{ width, maxWidth: '94vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="sticky top-0 z-10 bg-surface border-b border-border-std px-5 py-4 flex items-center justify-between">
            {typeof title === 'string' ? <h3 className="text-[16.5px] font-semibold tracking-[-0.3px]">{title}</h3> : title}
            <button onClick={onClose} className="text-ink-3 hover:text-ink text-[18px] leading-none px-1">
              ×
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------- Table ----------

export function Th({ children, right, className = '' }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <th className={`label-mono text-ink-3 font-semibold pb-2 px-2 ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>;
}

export function Td({ children, right, fig, className = '', style }: { children?: ReactNode; right?: boolean; fig?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <td className={`py-2.5 px-2 text-[12.5px] border-t border-border-faint ${right ? 'text-right' : ''} ${fig ? 'fig' : ''} ${className}`} style={style}>
      {children}
    </td>
  );
}

// ---------- Misc ----------

export function Spinner() {
  return (
    <span className="inline-flex gap-1 items-center">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulseDot" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </span>
  );
}

export function Icon({ d, size = 16, color = 'currentColor', strokeWidth = 2 }: { d: string; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {d.split('|').map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

/** AI sparkle glyph */
export const SPARKLE = 'M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2z|M19 14l.9 2.4L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.6L19 14z';
