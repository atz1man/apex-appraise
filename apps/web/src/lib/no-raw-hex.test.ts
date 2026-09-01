import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Design tokens only — no raw hex in components.
 *
 * CLAUDE.md has called this rule absolute since the first commit, and nothing
 * enforced it. Measured before this test existed: 205 raw hex literals across
 * 29 files outside the printed documents. Most were the brand ramp spelled out
 * by hand, which is drift rather than damage — until one of them is drawn on a
 * themed surface. Dark mode is live (`main.tsx` applies it from the OS
 * preference), and `index.css` states the number: the brand green is 1.84:1 on
 * the dark panel. Six icons on the AI Development Director, the field app's
 * check mark, the workbench's sparkle, the data room's upload icon and the site
 * pack's legend were all stroked in it, so on a dark desktop they were drawn in
 * a colour a person cannot see. A token would have moved with the theme; a
 * literal cannot.
 *
 * The printed documents are the one exception and it is deliberate: a signed
 * valuation must not change colour because the valuer had dark mode on, so
 * those files pair a raw ink with its own raw background. `e2e/contrast.spec.ts`
 * sweeps them in both themes, which is what proves the exception safe. The list
 * is asserted to be REAL below — a file on it must still contain hex — so an
 * exemption cannot outlive the reason for it.
 */

const SRC = join(__dirname, '..');

/** the printed documents, theme-invariant by design — see CLAUDE.md */
const PRINTED = new Set([
  'routes/AppraisalReport.tsx',
  'routes/RedBookReport.tsx',
  'components/TermsDocument.tsx',
  'routes/FundingPack.tsx',
  'components/paper.tsx',
]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** every raw hex literal in a source text, with its line, for the failure message */
export function rawHexSites(text: string): Array<{ line: number; hex: string }> {
  const out: Array<{ line: number; hex: string }> = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(HEX)) out.push({ line: i + 1, hex: m[0] });
  });
  return out;
}

describe('no raw hex colours outside the printed documents', () => {
  const files = walk(SRC).map((p) => relative(SRC, p));

  it('sweeps the real tree, not an empty list', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('components/ui.tsx');
  });

  it('every component and route draws its colours from @apex/ui-tokens', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      if (PRINTED.has(rel)) continue;
      for (const s of rawHexSites(readFileSync(join(SRC, rel), 'utf8'))) offenders.push(`${rel}:${s.line}  ${s.hex}`);
    }
    expect(
      offenders,
      `raw hex in a component — use a token from @apex/ui-tokens (add one if none fits):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the printed-document exemption names files that still need it', () => {
    for (const rel of PRINTED) {
      expect(files, `${rel} is exempted but does not exist`).toContain(rel);
      expect(rawHexSites(readFileSync(join(SRC, rel), 'utf8')).length, `${rel} no longer carries raw hex — drop it from the exemption`).toBeGreaterThan(0);
    }
  });

  it('finds what it is meant to find', () => {
    // a literal in any of the shapes the sweep once found: attribute, style value, gradient, CSS-in-string
    expect(rawHexSites('stroke="#14503B"')).toEqual([{ line: 1, hex: '#14503B' }]);
    expect(rawHexSites("style={{ color: '#fff' }}\nbackground: 'linear-gradient(135deg,#1E7A55,#14503B)'").map((s) => s.hex)).toEqual(['#fff', '#1E7A55', '#14503B']);
    expect(rawHexSites('border:2px solid #FFFFFF;').map((s) => s.line)).toEqual([1]);
    // and not an anchor or an id, which is not a colour
    expect(rawHexSites("href='#faq' id='#top'")).toEqual([]);
  });
});
