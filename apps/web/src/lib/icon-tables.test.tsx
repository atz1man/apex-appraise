import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Icon } from '../components/ui';

/**
 * A glyph table must stay TYPED, so the compiler checks its lookups.
 *
 * This test does not check icon keys. The compiler does that, and does it
 * better than any matcher here could — dot access and subscript alike, across
 * every file, for free. What it checks is that the compiler is still ALLOWED
 * to: a table written `const ICONS: Record<string, string> = {...}` types
 * `ICONS[anythingAtAll]` as `string`, so a key that does not exist passes
 * `tsc --noEmit` and arrives at run time as `undefined`.
 *
 * That is not a cosmetic failure. `Icon` splits `d` on `|`; `undefined.split`
 * throws inside render, React unmounts the tree above it and the screen goes
 * blank. Measured: a Hub tile naming `pack` with no `pack` entry took the whole
 * home screen down, and twenty-one e2e specs failed at the sign-in assertion —
 * none of them within sight of an icon.
 *
 * With the annotation removed the same tile is a build error, which is where a
 * missing glyph belongs. The mutation that proves it: delete the `pack:` line
 * from `Hub.tsx` and `npx tsc --noEmit` fails at the tile —
 *   Type '"pack"' is not assignable to type '"board" | "auto" | ...'.
 * Restore the annotation and it passes again, which is what this test refuses.
 */

const WEB_SRC = join(__dirname, '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    // the sweeps themselves are excluded: this file quotes the very declaration
    // it refuses, in the fixtures below, and a rule that trips on its own
    // counter-example is a rule nobody can write a counter-example for
    else if ((p.endsWith('.tsx') || p.endsWith('.ts')) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * A glyph table is an object literal whose values are SVG path data: quoted
 * strings starting with a move command. Keyed on that rather than on the name
 * `ICONS`, because the copy nobody would think to look for is the one called
 * something else — `TAB_ICONS`, `STAGE_GLYPHS`.
 */
const PATH_DATA = /:\s*'[Mm]\s*-?[\d.]/;

function annotatedGlyphTables(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const found: string[] = [];
  const decl = /const\s+(\w+)\s*:\s*Record<\s*string\s*,\s*string\s*>\s*=\s*\{/g;
  for (const m of src.matchAll(decl)) {
    // the literal's body, to its closing brace at the same indent
    const rest = src.slice(m.index + m[0].length);
    const end = rest.indexOf('\n};');
    const body = end === -1 ? rest.slice(0, 2000) : rest.slice(0, end);
    if (PATH_DATA.test(body)) found.push(`${file.replace(WEB_SRC, 'src')} — ${m[1]}`);
  }
  return found;
}

describe('glyph tables', () => {
  it('are not annotated Record<string, string>, so the compiler checks their keys', () => {
    const offenders = tsxFiles(WEB_SRC).flatMap(annotatedGlyphTables);
    expect(
      offenders,
      `a glyph table annotated Record<string, string> types every lookup as \`string\`, so a key that does not exist compiles and reaches Icon as undefined:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The sweep above passes over an empty file list in silence, and a matcher
   * that finds nothing reports success for a question it never asked. This is
   * the case that says the matcher can still see one.
   */
  it('recognises an annotated table when there is one', () => {
    const src = [
      "const NAV_ICONS: Record<string, string> = {",
      "  board: 'M3 5h5v14H3zM10 5h5v9h-5z',",
      "};",
      '',
    ].join('\n');
    const tmp = join(WEB_SRC, 'lib', '__glyph-fixture.tsx');
    const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(tmp, src);
    try {
      expect(annotatedGlyphTables(tmp)).toHaveLength(1);
    } finally {
      rmSync(tmp);
    }
  });

  /**
   * And that it is looking at the VALUES rather than the name: a
   * `Record<string, string>` of prose is not a glyph table and must not be
   * reported, or the rule becomes noise and gets an exemption list.
   */
  it('does not report a Record<string, string> that holds no path data', () => {
    const src = ["const LABELS: Record<string, string> = {", "  board: 'Pipeline board',", "};", ''].join('\n');
    const tmp = join(WEB_SRC, 'lib', '__prose-fixture.tsx');
    const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(tmp, src);
    try {
      expect(annotatedGlyphTables(tmp)).toEqual([]);
    } finally {
      rmSync(tmp);
    }
  });
});

/**
 * The other half, and the one that decides how much a mistake costs.
 *
 * The typed tables above stop a missing glyph reaching a build. This stops a
 * missing glyph — arriving by a cast, an `as any`, a table that is not a table
 * — from costing a whole screen. `Icon` is a plain function returning an
 * element, so it can be called and read without a DOM.
 */
describe('Icon', () => {
  it('renders one path per `|`-separated segment', () => {
    const el = Icon({ d: 'M4 4h16v16H4z|M8 12h8' }) as unknown as { props: { children: unknown[] } };
    expect(el.props.children).toHaveLength(2);
  });

  it('does not throw when handed no path data at all', () => {
    // the exact shape a table lookup for a key that is not there produces
    expect(() => Icon({ d: undefined as unknown as string })).not.toThrow();
  });
});
