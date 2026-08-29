/**
 * WCAG relative luminance and contrast, over the hex tokens.
 *
 * The browser sweep in scripts/contrast.mjs is the real check — it measures
 * what is actually rendered, through whatever translucent layers happen to be
 * stacked. This is the fast half: it holds the PALETTE to the ratios its
 * intended pairings need, so a token edit fails in a millisecond rather than
 * waiting for a build and a browser.
 */

export type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA: 4.5:1 for body text, 3:1 once it is large. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
