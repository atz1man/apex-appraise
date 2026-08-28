import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * A real <button> wearing the design's styling. The prototype made every
 * control a <div onClick>, which looks identical and is unreachable by
 * keyboard or screen reader; this keeps the look and restores the semantics.
 */
export function Pressable({ style, children, className, ...rest }: Props) {
  return (
    <button type="button" className={['k-press', className].filter(Boolean).join(' ')} style={style} {...rest}>
      {children}
    </button>
  );
}
