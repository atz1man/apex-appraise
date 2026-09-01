/**
 * Apex Appraise design tokens — the single source of truth for the visual language.
 * Generated from DESIGN_SYSTEM.md. Use only these values; never invent colours.
 */

export const brand = {
  400: '#1E9E6A',
  500: '#1E7A55',
  600: '#1B6048',
  700: '#14503B', // primary
  800: '#13402F',
  900: '#0F3528',
  950: '#0C2A20',
} as const;

export const accent = {
  bright: '#3FD894',
  300: '#7FE3B4',
  muted1: '#5E9C80',
  muted2: '#7FB99E',
  muted3: '#AECBBC',
  muted4: '#BFE0CD',
} as const;

// Semantic values resolve through the CSS variables declared in the web app's
// index.css (:root = light, .dark = dark, .light = pinned). The rgb(var())
// strings are valid anywhere CSS colours are accepted — inline styles, SVG
// fills, gradients. Fallback triplets keep the light values without the vars.
const v = (name: string, triplet: string) => `rgb(var(--${name}, ${triplet}))`;

export const neutral = {
  canvas: v('canvas', '243 244 241'),
  frame: v('frame', '231 229 223'),
  frame2: v('frame-2', '234 233 227'),
  surface: v('surface', '255 255 255'),
  sunken: v('sunken', '251 252 251'),
  sunken2: v('sunken-2', '240 239 233'),
  tintSuccess: v('tint-success', '236 243 239'),
  tintSuccess2: v('tint-success-2', '228 241 234'),
  borderStrong: v('border-strong', '230 229 222'),
  border: v('border-std', '236 235 229'),
  borderFaint: v('border-faint', '240 239 233'),
  borderFaint2: v('border-faint-2', '244 244 240'),
  ink: v('ink', '22 32 27'),
  ink2: v('ink-2', '75 81 75'),
  ink2b: v('ink-2b', '87 90 83'),
  ink3: v('ink-3', '95 98 95'),
  ink3b: v('ink-3b', '107 107 102'),
  crumb: v('crumb', '201 205 200'),
  inactive: v('inactive', '99 103 99'),
  dashed: v('dashed', '218 217 210'),
  /** the soft green hairline round a success toast or a connected integration */
  borderGreenSoft: v('border-green-soft', '214 230 221'),
} as const;

export type StatusKey = 'neutral' | 'amber' | 'blue' | 'green' | 'red' | 'purple';

/** One status system everywhere — chips, dots, bars, deltas. */
export const status: Record<StatusKey, { text: string; bg: string; dot: string }> = {
  neutral: { text: v('ink-2b', '87 90 83'), bg: v('sunken-2', '240 239 233'), dot: v('ink-3', '95 98 95') },
  amber: { text: v('status-amber', '149 95 17'), bg: v('status-amber-bg', '248 240 222'), dot: v('status-amber-dot', '199 169 91') },
  blue: { text: v('status-blue', '45 91 168'), bg: v('status-blue-bg', '229 234 246'), dot: v('status-blue', '45 91 168') },
  green: { text: v('status-green', '30 122 85'), bg: v('status-green-bg', '228 241 234'), dot: v('status-green', '30 122 85') },
  red: { text: v('status-red', '178 58 46'), bg: v('status-red-bg', '249 234 231'), dot: v('status-red', '178 58 46') },
  purple: { text: v('status-purple', '107 78 138'), bg: v('status-purple-bg', '237 230 244'), dot: v('status-purple-dot', '155 121 192') },
};

/**
 * The brand green as TEXT or a data mark. Theme-aware: #14503B measures 1.84:1
 * on the dark panel, so dark resolves to the brand's lighter green. Use the
 * fixed `brand` ramp above only for fills and gradients that carry white.
 */
export const brandInk = v('brand-ink', '20 80 59');

export const assetTypeTag: Record<string, { text: string; bg: string }> = {
  INDUSTRIAL: { text: brandInk, bg: v('status-green-bg', '228 241 234') },
  RESIDENTIAL: { text: v('status-blue', '45 91 168'), bg: v('status-blue-bg', '229 234 246') },
  COMMERCIAL: { text: v('status-amber', '149 95 17'), bg: v('tag-commercial-bg', '246 236 217') },
  MIXED_USE: { text: v('status-purple', '107 78 138'), bg: v('status-purple-bg', '237 230 244') },
};

/**
 * Ink on a brand fill. White, and theme-invariant BECAUSE the fill is: the brand
 * ramp above never changes with the theme, so what is drawn on it must not
 * either. Not for anything drawn on a themed surface — that is `neutral.ink`.
 */
export const onFill = '#FFFFFF';

/**
 * Fixed colours for surfaces that are drawn, not themed: the light chrome of a
 * marketing mock, the dark casing of the phone frame, a third party's payment
 * form that renders on its own white. Each pairs an ink with the surface it is
 * meant for, so the pair stays legible whichever theme the page around it is in.
 */
export const fixed = {
  white: '#FFFFFF',
  ink: '#16201B',
  /** secondary ink on a white that does not theme (a Leaflet popup keeps its own white) */
  inkMuted: '#5F665F',
  deviceFrame: 'linear-gradient(160deg,#23231F,#100F0D)',
  deviceNotch: '#0C0C0A',
} as const;

/** Data marks on the DARK brand panels (hero, sign-in): the status reds and greens above are tuned for light surfaces. */
export const onDark = {
  green: accent.bright,
  red: '#FF8A7A',
} as const;

/**
 * A colour per person, chosen by a stable hash of their id. One palette shared
 * by every avatar in the product; the same person is the same colour on the
 * cost monitor and in the data room.
 */
export const personGradients = [
  'linear-gradient(135deg,#1E7A55,#14503B)',
  'linear-gradient(135deg,#3C7FB5,#1F4E73)',
  'linear-gradient(135deg,#C79A4B,#8A6420)',
  'linear-gradient(135deg,#9B79C0,#5E3F86)',
] as const;
/** nobody assigned yet */
export const personGradientNone = 'linear-gradient(135deg,#9AA09A,#6E7269)';

/** Placeholder art where a photograph would go — evergreen for cards, stone for the field app's thumbnails. */
export const placeholderGradients = {
  evergreen: [
    'linear-gradient(150deg,#1E7A55 0%,#14503B 60%,#0F3528 100%)',
    'linear-gradient(150deg,#5E9C80 0%,#1B6048 55%,#0C2A20 100%)',
    'linear-gradient(150deg,#7FB99E 0%,#1E7A55 50%,#13402F 100%)',
  ],
  stone: [
    'linear-gradient(150deg,#AEBDB2,#7D8F86)',
    'linear-gradient(150deg,#C4CDD2,#9AA6AD)',
    'linear-gradient(150deg,#CDBFAE,#A59079)',
  ],
  scene: 'linear-gradient(165deg,#B9C6BD 0%,#8FA195 55%,#6D7E74 100%)',
  street: 'linear-gradient(160deg,#8A978F,#56635B)',
  map: 'linear-gradient(160deg,#E3E9E3,#CDD6D8)',
} as const;

export const avatarGradients: Record<string, string> = {
  AO: 'linear-gradient(135deg,#1E7A55,#14503B)',
  DW: 'linear-gradient(135deg,#3C7FB5,#1F4E73)',
  MV: 'linear-gradient(135deg,#C79A4B,#8A6420)',
  PA: 'linear-gradient(135deg,#9B79C0,#5E3F86)',
};

export const shadow = {
  rest: '0 1px 2px rgba(20,30,25,0.04), 0 8px 24px -18px rgba(20,30,25,0.22)',
  hover: '0 12px 26px -12px rgba(20,30,25,0.32)',
  drawer: '-20px 0 60px rgba(20,30,25,0.25)',
  darkCard: '0 26px 60px -28px rgba(0,0,0,0.5)',
  pill: '0 1px 2px rgba(0,0,0,0.06)',
} as const;

export const font = {
  ui: "'Schibsted Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

export const heroGradient = 'linear-gradient(160deg,#13402F 0%,#0F3528 55%,#0C2A20 100%)';
export const brandMarkGradient = 'linear-gradient(135deg,#1E7A55,#14503B)';
