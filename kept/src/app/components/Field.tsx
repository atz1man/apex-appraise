import type { ReactNode } from 'react';
import { color, radius } from '../../tokens';

/**
 * One labelled form row. The error is wired to the input through
 * aria-describedby and aria-invalid, so a screen reader hears why the field
 * was rejected rather than just that something on the screen went red.
 */
export function Field({
  id, label, error, hint, children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div style={{ marginTop: 14 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: '0.6px', color: color.muted, marginBottom: 6 }}>
        {label.toUpperCase()}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {error && (
        <div id={`${id}-error`} role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: color.danger, marginTop: 5 }}>
          {error}
        </div>
      )}
      {!error && hint && (
        <div id={`${id}-hint`} style={{ fontSize: 12.5, color: color.muted, marginTop: 5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function inputStyle(invalid: boolean) {
  return {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '13px 14px',
    borderRadius: radius.card,
    border: `1.5px solid ${invalid ? color.danger : color.border}`,
    background: color.white,
    fontFamily: "'Instrument Sans', system-ui, sans-serif",
    fontSize: 15,
    color: color.ink,
  };
}
