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

export const neutral = {
  canvas: '#F3F4F1',
  frame: '#E7E5DF',
  frame2: '#EAE9E3',
  surface: '#FFFFFF',
  sunken: '#FBFCFB',
  sunken2: '#F0EFE9',
  tintSuccess: '#ECF3EF',
  tintSuccess2: '#E4F1EA',
  borderStrong: '#E6E5DE',
  border: '#ECEBE5',
  borderFaint: '#F0EFE9',
  borderFaint2: '#F4F4F0',
  ink: '#16201B',
  ink2: '#5F665F',
  ink2b: '#6E7269',
  ink3: '#9AA09A',
  ink3b: '#B6B5AD',
  crumb: '#C9CDC8',
  inactive: '#8A908A',
  dashed: '#DAD9D2',
} as const;

export type StatusKey = 'neutral' | 'amber' | 'blue' | 'green' | 'red' | 'purple';

/** One status system everywhere — chips, dots, bars, deltas. */
export const status: Record<StatusKey, { text: string; bg: string; dot: string }> = {
  neutral: { text: '#6E7269', bg: '#F0EFE9', dot: '#9AA09A' },
  amber: { text: '#9A6212', bg: '#F8F0DE', dot: '#C7A95B' },
  blue: { text: '#2D5BA8', bg: '#E5EAF6', dot: '#2D5BA8' },
  green: { text: '#1E7A55', bg: '#E4F1EA', dot: '#1E7A55' },
  red: { text: '#B23A2E', bg: '#F9EAE7', dot: '#B23A2E' },
  purple: { text: '#6B4E8A', bg: '#EDE6F4', dot: '#9B79C0' },
};

export const assetTypeTag: Record<string, { text: string; bg: string }> = {
  INDUSTRIAL: { text: '#14503B', bg: '#E4F1EA' },
  RESIDENTIAL: { text: '#2D5BA8', bg: '#E5EAF6' },
  COMMERCIAL: { text: '#9A6212', bg: '#F6ECD9' },
  MIXED_USE: { text: '#6B4E8A', bg: '#EDE6F4' },
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
