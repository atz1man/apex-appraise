import { type CSSProperties, type ReactNode, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { status as statusTokens, type StatusKey, assetTypeTag, avatarGradients, brandMarkGradient } from '@apex/ui-tokens';
import { getPrincipal } from '../lib/trpc';

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

const GLOBAL_NAV: Array<[string, string]> = [
  ['/board', 'Pipeline'],
  ['/calendar', 'Calendar'],
  ['/benchmarking', 'Benchmarking'],
  ['/integrations', 'Integrations'],
  ['/settings', 'Settings'],
];

/** 56px sticky top bar: brand lockup → breadcrumb → global nav (internal) → status/actions. */
export function TopBar({ crumb, right }: { crumb?: ReactNode; right?: ReactNode }) {
  const internal = getPrincipal()?.principalType === 'internal';
  return (
    <header
      className="sticky top-0 z-40 h-14 flex items-center gap-3 px-5"
      style={{
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(18px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.6)',
        borderBottom: '1px solid rgba(20,30,25,0.07)',
      }}
    >
      <BrandLockup />
      {crumb && (
        <>
          <span className="text-[#C9CDC8]">/</span>
          <span className="text-[13.5px] font-medium text-ink-2 truncate max-w-[420px]">{crumb}</span>
        </>
      )}
      {internal && (
        <nav className="ml-5 hidden lg:flex items-center gap-1" aria-label="Global">
          {GLOBAL_NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className="px-2.5 py-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors"
              style={({ isActive }) => ({
                color: isActive ? '#14503B' : '#6E7269',
                background: isActive ? '#ECF3EF' : 'transparent',
                fontWeight: isActive ? 600 : 500,
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>
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
    <div className="flex-1 min-w-[130px] bg-surface rounded-card shadow-rest px-4 py-3.5">
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
      className={`bg-surface rounded-panel shadow-rest p-5 ${className}`}
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
    primary: 'text-white',
    secondary: 'bg-surface text-ink-2 hover:bg-sunken',
    ghost: 'text-ink-2 hover:bg-sunken-2',
    danger: 'bg-surface text-status-red hover:bg-status-red-bg',
  };
  const chrome: Record<string, React.CSSProperties> = {
    // subtle top-light gradient + inner highlight — tactile, Apple-style primary
    primary: {
      background: 'linear-gradient(180deg,#1B6048 0%,#14503B 100%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 2px rgba(20,30,25,0.18), 0 6px 16px -8px rgba(20,80,59,0.45)',
    },
    secondary: { border: '1px solid rgba(20,30,25,0.12)', boxShadow: '0 1px 2px rgba(20,30,25,0.05)' },
    ghost: {},
    danger: { border: '1px solid rgba(178,58,46,0.4)', boxShadow: '0 1px 2px rgba(20,30,25,0.05)' },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[12px] px-4 h-[38px] text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      style={chrome[variant]}
      onMouseEnter={variant === 'primary' ? (e) => (e.currentTarget.style.filter = 'brightness(1.07)') : undefined}
      onMouseLeave={variant === 'primary' ? (e) => (e.currentTarget.style.filter = '') : undefined}
    >
      {children}
    </button>
  );
}

/** Segmented control — iOS-style: white pill glides on a recessed track. */
export function SegmentedToggle<T extends string>({ options, value, onChange }: { options: Array<[T, string]>; value: T; onChange: (v: T) => void }) {
  return (
    <div
      className="inline-flex rounded-[12px] p-[3px] gap-[2px]"
      style={{ background: '#EDECE6', boxShadow: 'inset 0 1px 2px rgba(20,30,25,0.06)' }}
      role="tablist"
    >
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(k)}
            className={`px-3.5 py-1.5 rounded-[10px] text-[12.5px] ${on ? 'bg-surface text-brand-700 font-semibold shadow-pill' : 'text-inactive font-medium hover:text-ink-2'}`}
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
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(12,18,14,0.35)', backdropFilter: 'blur(6px) saturate(1.2)' }} onClick={onClose}>
      <div
        className="h-full bg-surface shadow-drawer animate-slideIn overflow-y-auto rounded-l-[22px]"
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

/** Content-shaped loading placeholder — prefer over a bare Spinner for panels/tables. */
export function Skeleton({ height = 14, width = '100%', className = '' }: { height?: number; width?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height, width }} aria-hidden="true" />;
}

/** A stack of skeleton rows approximating a table/list while it loads. */
export function SkeletonRows({ rows = 5, height = 14 }: { rows?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} width={`${100 - (i % 3) * 9}%`} />
      ))}
    </div>
  );
}

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
