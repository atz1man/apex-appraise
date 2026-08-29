import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { color, font } from '../src/tokens';

/**
 * One place decides what the app is set in.
 *
 * `font` existed and nothing used it: forty-eight font-family literals were
 * spelled out across fourteen files instead, in three different stacks for
 * Space Grotesk alone. The typefaces are self-hosted so the app renders
 * offline, which makes the FALLBACK the state a phone with a cold cache
 * actually paints — and in it the same face fell back to a monospace in one
 * element and a proportional sans in the next, on one screen. Nobody had
 * looked at that state, because nothing named it.
 *
 * `styles.css` is exempt: `@font-face` is where the family is declared, and
 * the body rule is the one place the token cannot reach.
 */
const SRC = join(__dirname, '..', 'src');
const EXEMPT = ['tokens.ts', 'styles.css'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|css)$/.test(name) && !EXEMPT.includes(name)) out.push(p);
  }
  return out;
}

describe('type is set from the tokens', () => {
  const files = sourceFiles(SRC);

  it('is reading the files it means to read', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('names no typeface outside the tokens', () => {
    const offenders = files
      .map((f) => ({ f: f.slice(SRC.length + 1), hits: [...readFileSync(f, 'utf8').matchAll(/'(Space Grotesk|Instrument Sans)'/g)] }))
      .filter((x) => x.hits.length > 0)
      .map((x) => `${x.f} (${x.hits.length})`);
    expect(offenders).toEqual([]);
  });

  it('ends every stack in a generic family', () => {
    // The fallback is not a formality here: the faces are self-hosted so the
    // app renders offline, which makes this the state a phone with a cold
    // cache paints. A token naming a family and stopping there leaves the
    // browser to pick, and it picks differently on every platform.
    for (const [role, stack] of Object.entries(font)) {
      expect(stack, role).toMatch(/(?:sans-serif|serif|monospace)$/);
      expect(stack.split(',').length, role).toBeGreaterThan(1);
    }
  });
});

/**
 * Every colour in the app is one of the tokens.
 *
 * The header of `tokens.ts` says so — "no raw hex literals live in a
 * component file" — and two had escaped it. The stylesheet's `a:hover` was
 * still `#B98A00`, which is the exact value `color.amber` was darkened away
 * from for measuring 3.00:1 on cream: below AA, on a state the contrast sweep
 * cannot see because it only exists under the pointer. And a `#EDE8D8` sat in
 * the hero gradient beside a token, and again in a hover rule, belonging to
 * nothing.
 *
 * The stylesheet is included deliberately. It cannot import the tokens, which
 * is exactly why it drifts, and comparing the two files is the only thing
 * that holds it.
 */
describe('colour is set from the tokens', () => {
  const expand = (c: string) =>
    /^#[0-9a-f]{3}$/.test(c) ? `#${c.slice(1).split('').map((d) => d + d).join('')}` : c;

  /** The RGB triple behind a token or a literal, ignoring any alpha. */
  const rgbOf = (value: string): string | null => {
    const v = expand(value.toLowerCase().replace(/\s+/g, ''));
    const hex = /^#([0-9a-f]{6})/.exec(v);
    if (hex) return hex[1];
    const fn = /^rgba?\((\d+),(\d+),(\d+)/.exec(v);
    if (fn) return [1, 2, 3].map((i) => Number(fn[i]).toString(16).padStart(2, '0')).join('');
    return null;
  };

  const PALETTE = new Set(Object.values(color).map(rgbOf).filter(Boolean) as string[]);

  // Comments first: the rule below is explained by naming the colours it
  // rejected, and a guard that cannot survive its own explanation is a guard
  // nobody will write the explanation for.
  const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const coloursIn = (text: string) =>
    [...stripComments(text).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0]);

  const files = sourceFiles(SRC).concat(join(SRC, 'styles.css'));

  it('finds colours to check', () => {
    expect(files.flatMap((f) => coloursIn(readFileSync(f, 'utf8'))).length).toBeGreaterThan(5);
    expect(PALETTE.size).toBeGreaterThan(10);
  });

  it('mixes no colour the palette does not already contain', () => {
    /*
     * The RGB must be a token's; only the ALPHA may vary at the call site.
     *
     * Twelve rgba() literals are one-off opacities of ink, danger, yellow,
     * cream and white — a scrim at 0.55, a hairline at 0.06 — and naming each
     * step in the palette would be a token per shadow. What must not appear
     * is a colour nobody chose: a hand-mixed grey, or the #B98A00 that
     * `color.amber` was darkened away from for measuring 3.00:1 on cream and
     * which the stylesheet went on using for `a:hover`, a state the contrast
     * sweep cannot see because it only exists under the pointer.
     */
    const strays = files
      .flatMap((f) =>
        coloursIn(readFileSync(f, 'utf8')).map((c) => ({ where: f.slice(SRC.length + 1), c, rgb: rgbOf(c) })),
      )
      .filter((x) => !x.rgb || !PALETTE.has(x.rgb))
      .map((x) => `${x.where} ${x.c}`);
    expect([...new Set(strays)]).toEqual([]);
  });
});
