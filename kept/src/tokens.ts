/**
 * Kept design tokens — the single source for every colour, shadow and typeface
 * in the app and the landing page. Components import from here; no raw hex
 * literals live in a component file.
 */
export const color = {
  ink: '#171410',
  inkHover: '#000000',

  cream: '#FDFAF1',
  creamAlt: '#F3EFE3',
  creamWarm: '#FFFBEE',
  white: '#ffffff',

  yellow: '#F2B90D',
  yellowHover: '#E5AC00',
  yellowLight: '#FBDD6E',
  yellowLightHover: '#F8D24A',
  /**
   * Amber carries almost every small label in the product, and the handoff's
   * #B98A00 measured 3.0:1 on cream and 2.7:1 on the secondary surface —
   * below WCAG AA wherever it was actually used. Darkened until it clears
   * 4.5:1 on all three light grounds (5.08 cream / 5.30 white / 4.61
   * creamAlt). The brand's energy lives in the yellow FILLS, which are
   * unchanged; this is the ink that has to be read.
   */
  amber: '#896600',

  /** Nudged from the handoff's #7A7261, which fell to 4.14:1 on creamAlt. */
  muted: '#746C5C',
  /**
   * Only legible on the INK surfaces (6.1:1 there). It measures under 3:1 on
   * cream, so anything reading on a light ground uses `muted` instead — see
   * scripts/contrast.mjs, which fails the build if that slips.
   */
  faint: '#9C9484',
  fainter: '#B4AC9C',
  body: '#4C463A',
  bodyStrong: '#2E2A22',
  onInkBody: '#D6CFC0',
  /** Lifted from the handoff's #6B6455, which measured 3.13:1 on ink. */
  onInkFaint: '#857E6F',

  danger: '#C13A27',
  dangerDot: '#D8422E',
  dangerChipBg: 'rgba(216,66,46,0.12)',
  onInkDanger: '#FF9A76',

  border: 'rgba(23,20,16,0.12)',
  borderHair: 'rgba(23,20,16,0.08)',
  borderSoft: 'rgba(23,20,16,0.15)',
  onInkBorder: 'rgba(255,255,255,0.12)',
  onInkBorderStrong: 'rgba(255,255,255,0.18)',
  onInkDash: 'rgba(255,255,255,0.16)',
  rail: 'rgba(23,20,16,0.14)',
} as const;

export const font = {
  display: "'Space Grotesk', ui-monospace, monospace",
  ui: "'Instrument Sans', system-ui, -apple-system, sans-serif",
} as const;

export const shadow = {
  /** The signature hard offset — buttons and emphasised cards. */
  hard: `3px 3px 0 ${color.ink}`,
  hardLg: `4px 4px 0 ${color.ink}`,
  /** Yellow offset, used under ink surfaces. */
  yellow: `4px 4px 0 ${color.yellow}`,
  yellowLg: `5px 5px 0 ${color.yellow}`,
  yellowXl: `6px 6px 0 ${color.yellow}`,
  /** The soft lift under the ink hero card. */
  lift: '0 12px 32px rgba(23,20,16,0.22)',
  tab: '4px 4px 0 rgba(23,20,16,0.9)',
} as const;

export const radius = {
  card: 18,
  cardLg: 20,
  hero: 24,
  heroLg: 28,
  pill: 999,
} as const;

/** The paper grain: 1px dots on a 5px grid, at 2.8% ink. */
export const paperGrain = {
  backgroundColor: color.cream,
  backgroundImage: 'radial-gradient(rgba(23,20,16,0.028) 1px, transparent 1px)',
  backgroundSize: '5px 5px',
} as const;
