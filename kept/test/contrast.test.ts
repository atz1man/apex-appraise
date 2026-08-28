import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_TEXT, contrast } from '../src/lib/contrast';
import { color } from '../src/tokens';

/**
 * The palette's intended pairings, held to WCAG AA.
 *
 * These are not hypothetical combinations — each one is a pairing the app
 * actually renders, and the handoff's original values failed several of them.
 * scripts/contrast.mjs proves the real screens still match this table.
 */
const LIGHT = [
  ['cream', color.cream],
  ['white', color.white],
  ['creamAlt', color.creamAlt],
] as const;

describe('text on the light grounds', () => {
  for (const [name, ground] of LIGHT) {
    it(`ink reads on ${name}`, () => {
      expect(contrast(color.ink, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`body text reads on ${name}`, () => {
      expect(contrast(color.body, ground)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(color.bodyStrong, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`muted text reads on ${name}`, () => {
      // The handoff's #7A7261 fell to 4.14:1 here; every footnote uses it.
      expect(contrast(color.muted, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`amber labels read on ${name}`, () => {
      // The handoff's #B98A00 measured 3.0:1 on cream and 2.7:1 on creamAlt.
      expect(contrast(color.amber, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`danger text reads on ${name}`, () => {
      expect(contrast(color.danger, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
});

describe('text on ink', () => {
  it.each([
    ['cream', color.cream],
    ['on-ink body', color.onInkBody],
    ['faint', color.faint],
    ['fainter', color.fainter],
    ['yellow', color.yellow],
    ['on-ink danger', color.onInkDanger],
    ['on-ink faint', color.onInkFaint],
  ])('%s reads on ink', (_name, fg) => {
    expect(contrast(fg, color.ink)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('text on the yellow fills', () => {
  it('ink reads on the brand yellow — every primary button', () => {
    expect(contrast(color.ink, color.yellow)).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('ink reads on the light yellow — chips and the swipe backing', () => {
    expect(contrast(color.ink, color.yellowLight)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('the destructive action', () => {
  it('white reads on the danger fill — the erase-everything confirm', () => {
    expect(contrast(color.white, color.danger)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('the large-text pairings', () => {
  it('the amber statistics clear the large-text bar on creamAlt', () => {
    expect(contrast(color.amber, color.creamAlt)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('what the faint token is and is not for', () => {
  it('reads on ink', () => {
    expect(contrast(color.faint, color.ink)).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('does not read on cream — which is why on-light footnotes use muted', () => {
    // Pinned deliberately: if someone lightens the cream or darkens this token
    // enough to pass, the comment above stops being true and should be revisited.
    expect(contrast(color.faint, color.cream)).toBeLessThan(AA_TEXT);
  });
});
