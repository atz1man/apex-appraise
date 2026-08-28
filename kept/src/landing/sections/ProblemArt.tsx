import { color } from '../../tokens';

/**
 * The three "problem" illustrations.
 *
 * The handoff left photo slots here and a note that real photography is
 * needed. Rather than ship three grey boxes reading "drop a photo", these are
 * drawn in the brand's own line-work — a finished page today, and a
 * one-component swap when the shoot happens.
 */
const TICKET = 'M8 1H32Q39 1 39 9V44L32.7 50 26.3 44 20 50 13.7 44 7.3 50 1 44V9Q1 1 8 1Z';

const frame = { width: '100%', height: '100%', viewBox: '0 0 400 220', preserveAspectRatio: 'xMidYMid slice' } as const;

/** Five shops, one afternoon, five clocks already running. */
export function HaulArt() {
  return (
    <svg {...frame} role="img" aria-label="Five shopping bags, each with its own return clock already running">
      <rect width="400" height="220" fill={color.creamAlt} />
      {[
        { x: 34, w: 62, h: 78, fill: color.white },
        { x: 110, w: 74, h: 96, fill: color.yellowLight },
        { x: 198, w: 58, h: 70, fill: color.white },
        { x: 268, w: 80, h: 104, fill: color.yellow },
      ].map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${190 - b.h})`}>
          <rect width={b.w} height={b.h} rx="4" fill={b.fill} stroke={color.ink} strokeWidth="1.8" />
          <path d={`M${b.w * 0.3} 0 v-12 a${b.w * 0.2} 12 0 0 1 ${b.w * 0.4} 0 v12`} fill="none" stroke={color.ink} strokeWidth="1.8" />
          <path d={`M10 ${b.h * 0.45} h${b.w - 20}`} stroke={color.ink} strokeWidth="1.4" opacity="0.3" />
        </g>
      ))}
      {[70, 150, 230, 312].map((cx, i) => (
        <g key={cx} transform={`translate(${cx} 42)`}>
          <circle r="14" fill={color.cream} stroke={color.ink} strokeWidth="1.6" />
          <path d="M0 -8V1l6 4" fill="none" stroke={i === 3 ? color.danger : color.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  );
}

/** Jacket pockets, kitchen drawers, a 9,000-email inbox. */
export function LostReceiptsArt() {
  return (
    <svg {...frame} role="img" aria-label="A scattered pile of crumpled receipts">
      <rect width="400" height="220" fill={color.ink} />
      {[
        { x: 26, y: 26, r: -22, o: 0.9 }, { x: 118, y: 12, r: 11, o: 0.55 },
        { x: 210, y: 34, r: -8, o: 0.75 }, { x: 300, y: 18, r: 17, o: 0.4 },
        { x: 60, y: 112, r: 8, o: 0.6 }, { x: 152, y: 124, r: -15, o: 0.85 },
        { x: 246, y: 118, r: 6, o: 0.45 }, { x: 330, y: 132, r: -12, o: 0.7 },
      ].map((t, i) => (
        <g key={i} transform={`translate(${t.x} ${t.y}) rotate(${t.r}) scale(1.7)`} opacity={t.o}>
          <path d={TICKET} fill="none" stroke={color.yellow} strokeWidth="1.3" />
          <path d="M9 13h22M9 20h22M9 27h13" stroke={color.yellow} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
        </g>
      ))}
    </svg>
  );
}

/** Clause 14b, at the size it is actually printed. */
export function FinePrintArt() {
  return (
    <svg {...frame} role="img" aria-label="A page of return-policy fine print, with one clause circled">
      <rect width="400" height="220" fill={color.creamAlt} />
      <rect x="58" y="16" width="284" height="200" rx="6" fill={color.white} stroke={color.ink} strokeWidth="1.8" />
      {Array.from({ length: 16 }, (_, i) => (
        <rect
          key={i}
          x="78"
          y={40 + i * 11}
          width={i % 4 === 3 ? 150 : i % 3 === 0 ? 244 : 208}
          height="3.5"
          rx="1.75"
          fill={color.ink}
          opacity={i >= 8 && i <= 10 ? 0.75 : 0.16}
        />
      ))}
      <ellipse cx="200" cy="140" rx="128" ry="28" fill="none" stroke={color.danger} strokeWidth="2.6" transform="rotate(-2 200 140)" />
      <g transform="translate(292 156)">
        <circle r="30" fill="none" stroke={color.ink} strokeWidth="3.4" />
        <path d="M21 21l16 16" stroke={color.ink} strokeWidth="4" strokeLinecap="round" />
        <circle r="30" fill={color.yellow} opacity="0.18" />
      </g>
    </svg>
  );
}
