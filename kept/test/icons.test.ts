import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every icon in the set is drawn somewhere.
 *
 * Three were not: a clock, a padlock and an Apple logo, exported and
 * referenced by nothing — shipped in the bundle of an app whose whole pitch
 * includes working offline on a phone, and one of them a trademark nobody
 * had asked to render. Dead code is cheap to leave and cheap to find, and
 * this file is where it accumulates because an icon set is written ahead of
 * the screens that use it.
 */
const ICONS = join(__dirname, '..', 'src', 'app', 'components', 'Icons.tsx');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('the icon set', () => {
  // Tolerant of a renamed file, so the count guard below reports "I cannot
  // read what I mean to read" rather than the suite dying at module load —
  // which prints "no tests" and reads like nothing was wrong.
  const src = (() => {
    try {
      return readFileSync(ICONS, 'utf8');
    } catch {
      return '';
    }
  })();
  const exported = [...src.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  const elsewhere = sourceFiles(join(__dirname, '..', 'src'))
    .filter((f) => f !== ICONS)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  it('has icons to check', () => {
    // A sweep over an empty list passes silently.
    expect(exported.length).toBeGreaterThan(5);
    expect(elsewhere.length).toBeGreaterThan(1000);
  });

  it('draws every icon it exports', () => {
    const unused = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(elsewhere));
    expect(unused).toEqual([]);
  });
});
