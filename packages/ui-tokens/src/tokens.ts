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
  ink2: v('ink-2', '95 102 95'),
  ink2b: v('ink-2b', '110 114 105'),
  ink3: v('ink-3', '154 160 154'),
  ink3b: v('ink-3b', '182 181 173'),
  crumb: v('crumb', '201 205 200'),
  inactive: v('inactive', '138 144 138'),
  dashed: v('dashed', '218 217 210'),
} as const;

export type StatusKey = 'neutral' | 'amber' | 'blue' | 'green' | 'red' | 'purple';

/** One status system everywhere — chips, dots, bars, deltas. */
export const status: Record<StatusKey, { text: string; bg: string; dot: string }> = {
  neutral: { text: v('ink-2b', '110 114 105'), bg: v('sunken-2', '240 239 233'), dot: v('ink-3', '154 160 154') },
  amber: { text: v('status-amber', '154 98 18'), bg: v('status-amber-bg', '248 240 222'), dot: v('status-amber-dot', '199 169 91') },
  blue: { text: v('status-blue', '45 91 168'), bg: v('status-blue-bg', '229 234 246'), dot: v('status-blue', '45 91 168') },
  green: { text: v('status-green', '30 122 85'), bg: v('status-green-bg', '228 241 234'), dot: v('status-green', '30 122 85') },
  red: { text: v('status-red', '178 58 46'), bg: v('status-red-bg', '249 234 231'), dot: v('status-red', '178 58 46') },
  purple: { text: v('status-purple', '107 78 138'), bg: v('status-purple-bg', '237 230 244'), dot: v('status-purple-dot', '155 121 192') },
};

export const assetTypeTag: Record<string, { text: string; bg: string }> = {
  INDUSTRIAL: { text: '#14503B', bg: v('status-green-bg', '228 241 234') },
  RESIDENTIAL: { text: v('status-blue', '45 91 168'), bg: v('status-blue-bg', '229 234 246') },
  COMMERCIAL: { text: v('status-amber', '154 98 18'), bg: v('tag-commercial-bg', '246 236 217') },
  MIXED_USE: { text: v('status-purple', '107 78 138'), bg: v('status-purple-bg', '237 230 244') },
};

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
