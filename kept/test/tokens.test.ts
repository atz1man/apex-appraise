import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { font } from '../src/tokens';

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
