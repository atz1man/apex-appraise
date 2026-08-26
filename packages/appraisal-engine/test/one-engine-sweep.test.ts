import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "ALL money maths lives here", swept rather than remembered.
 *
 * The class this guards has now been fixed by hand three times: `c1631ab` (the
 * scenario compare kept two copies of itself), `4ae2ba9` (retention worked out
 * twice, and neither copy was in the engine) and the Market Value / analysed
 * rate this file arrived with — derived in `RedBookReport.tsx` and again in the
 * API's narrative drafter, in two packages, from two independent copies of one
 * rounding rule, feeding the same signed page.
 *
 * Each of those was found by reading. This asks the question of the whole tree.
 *
 * Deliberately narrow: it does not attempt to recognise "money maths" in
 * general — arithmetic is everywhere and most of it is layout, percentages and
 * dates, so a broad matcher would be noise and would be exempted into
 * uselessness within a month. It matches the specific derived quantities that
 * have a house rule behind them and are printed on more than one surface, which
 * is exactly the set that can drift apart without anyone seeing it. Add to
 * RULES when a fourth one is found, rather than widening these.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SEARCHED = ['apps/web/src', 'apps/api/src', 'packages/types/src', 'packages/ui-tokens/src'];

const RULES: Array<{ what: string; use: string; re: RegExp }> = [
  {
    what: 'Market Value — the appraisal GDV rounded to the nearest £1,000',
    use: 'reportedMarketValue() — or toNearestThousand() for any other reported figure',
    // any rounding of a variable to the nearest thousand
    re: /Math\.round\(\s*[\w.]*\s*\/\s*1[_,]?000\s*\)\s*\*\s*1[_,]?000/,
  },
  {
    what: 'the analysed rate — a Market Value over a net internal area',
    use: 'analysedPsf()',
    re: /Math\.round\(\s*mv\s*\/\s*[\w.]*nia\b/i,
  },
];

const sourceFiles = (dir: string): string[] => {
  const abs = join(ROOT, dir);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
    }
  };
  walk(abs);
  return out;
};

describe('one shared calculation engine for every surface', () => {
  const files = SEARCHED.flatMap(sourceFiles);

  it('finds the source it is meant to be sweeping', () => {
    // a sweep over an empty file list passes silently, which is worse than none
    expect(files.length, 'the sweep found no source files — the paths have moved').toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('RedBookReport.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('routers/appraisal.ts'))).toBe(true);
  });

  for (const rule of RULES) {
    it(`is the only place that derives ${rule.what}`, () => {
      const offenders = files
        .filter((f) => rule.re.test(readFileSync(f, 'utf8')))
        .map((f) => relative(ROOT, f));
      expect(
        offenders,
        `derived outside the engine — import ${rule.use} from @apex/appraisal-engine instead`,
      ).toEqual([]);
    });
  }
});
