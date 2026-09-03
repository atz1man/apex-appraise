import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
const SEARCHED = ['apps/web/src', 'apps/api/src', 'packages/types/src', 'packages/ui-tokens/src', 'packages/mcp-server/src'];

/**
 * Every source tree in the repo except the engine's own.
 *
 * Derived, and checked against `SEARCHED` below, because the list above is the
 * part of this sweep that could quietly stop being true: a new package is added,
 * nobody thinks to add it here, and the sweep goes on passing over a smaller and
 * smaller tree while reporting success. The MCP server is exactly that case —
 * a surface whose whole job is to hand money figures to a model, arriving in a
 * package that did not exist when this list was written.
 */
const everySourceTree = (): string[] =>
  ['apps', 'packages']
    .flatMap((group) =>
      readdirSync(join(ROOT, group))
        .map((name) => `${group}/${name}/src`)
        .filter((rel) => existsSync(join(ROOT, rel))),
    )
    .filter((rel) => rel !== 'packages/appraisal-engine/src');

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
  {
    /**
     * The third, and the first this sweep found rather than confirmed.
     *
     * Progress across a job is weighted by what each package is WORTH — a
     * £900k package at 10% beside a £100k package at 100% is a job barely
     * started, and averaging the percentages calls it 55%. `cost-report.ts`
     * owns that as `weightedProgressPct`. `deals.exposure` carried its own
     * copy, and so did `/api/v1/exposure`: three implementations, and the
     * argument FOR the rule written out twice in comments as well.
     *
     * They print on three surfaces — the cost monitor's build-programme bar,
     * the funding pack's overspending verdict, and a customer's own
     * integration — so a change to the weighting basis would have moved one
     * and left the others contradicting it. Written after routing the other
     * two through the engine, and verified against the source as it stood
     * BEFORE that: it finds both offenders unaided.
     */
    what: 'progress weighted by what each package is worth',
    use: 'costRollup().weightedProgressPct',
    // a money figure multiplied by a progress percentage — the accumulation
    // step, which is where a hand-rolled weighting always starts
    re: /[\w.]+\s*\*\s*\(?\s*[\w.]*progressPct/,
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
    expect(files.some((f) => f.endsWith('mcp-server/src/server.ts'))).toBe(true);
  });

  it('sweeps every source tree in the repo, not the ones somebody remembered', () => {
    expect(
      everySourceTree().filter((t) => !SEARCHED.includes(t)),
      'a package this sweep does not look at — add it to SEARCHED, or say in a comment why money maths cannot reach it',
    ).toEqual([]);
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
