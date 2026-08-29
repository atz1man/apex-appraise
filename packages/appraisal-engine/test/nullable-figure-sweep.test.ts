import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A figure the engine says it could not compute must not be replaced by a number.
 *
 * The engine types a result field `number | null` for one reason: there are
 * inputs for which the quantity does not exist. `rocAtAsking` is the return on
 * cost if you paid the asking price, so it is null when nobody named a price.
 * `projIrr` is null when the cashflows never change sign, because a scheme that
 * never returns its money has no internal rate of return to find. The null is
 * the engine's answer, not a gap in it.
 *
 * `?? 0` throws that answer away and substitutes a specific, false claim. This
 * class has now been fixed by hand twice in one sitting, in two packages, on two
 * surfaces that never see each other:
 *
 *   ad243b2  `(r.rocAtAsking ?? 0.2) >= 0.17` — twenty per cent, over the
 *            Proceed threshold, so no screening without an asking price could
 *            return anything but Proceed. A site with a residual land value of
 *            minus £4.9m came back Proceed, in green.
 *   6e164e2  `R.cash?.eqIrr ?? 0` and `jv.lp.irr ?? 0` written into cells
 *            formatted `0.0%`, so the workbook that goes to the lender and the
 *            LP reported a return of 0.0% on a scheme losing £4.5m.
 *
 * Both were found by reading. This asks the question of the whole tree, and run
 * against the commit before those fixes it finds all six lines unaided.
 *
 * The field list is read out of `types.ts` at run time rather than kept here, so
 * a ninth nullable figure is covered the day someone declares it and nobody has
 * to remember this file exists.
 *
 * Deliberately narrow. It matches `<field> ?? <number literal>` and nothing
 * else. It does NOT try to recognise the same defect wearing other clothes —
 * `8b51be4` was a filter reading `h.irr > 0`, which dropped recorded losses
 * along with unrecorded holdings, and no static matcher distinguishes that from
 * an honest sign test. Widening this one to reach it would flag every
 * comparison in the codebase and be exempted into uselessness by the end of the
 * month. If a third shape of this defect turns up, give it its own rule here
 * rather than loosening this matcher.
 *
 * A null that genuinely must become a number belongs at the point of DISPLAY,
 * where it can be shown as "N/A" or an em dash — the way six render sites and
 * the workbook now do it — not folded into a figure on its way through.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const TYPES = join(ROOT, 'packages/appraisal-engine/src/types.ts');
const SEARCHED = ['apps/web/src', 'apps/api/src', 'packages/appraisal-engine/src', 'packages/types/src'];

/** The nullable numeric fields the engine actually declares, read from the source. */
function declaredNullableFigures(): string[] {
  const src = readFileSync(TYPES, 'utf8');
  const named = [...src.matchAll(/^\s*(\w+)\??:\s*number\s*\|\s*null;/gm)].map((m) => m[1]);
  return [...new Set(named)].sort();
}

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
};

/**
 * `<field> ?? 0`, `?? 0.2`, `?? -1` — a null quietly becoming a number. `||` is
 * included because it is the same shape through a different operator, not a
 * different defect, and on this tree it is worth having for free: measured at
 * zero hits both here and at the commit before these fixes, so it adds an
 * escape hatch closed rather than any noise. (`|| 0` is in fact the worse of the
 * two, since it swallows a legitimately computed zero as well as the null.)
 *
 * A default that is an IDENTIFIER rather than a literal is deliberately not
 * matched: `eqIrr ?? NOT_COMPUTED` is the correct fix in `exportXlsx.ts`, and
 * nothing here can tell a numeric constant from a sentinel string without types.
 */
const defaulted = (field: string) =>
  new RegExp(`\\b${field}\\s*(?:\\?\\?|\\|\\|)\\s*-?\\d`);

describe('a figure the engine could not compute', () => {
  const figures = declaredNullableFigures();
  const files = SEARCHED.flatMap(sourceFiles);

  it('finds the fields it is meant to be sweeping', () => {
    // an empty field list sweeps for nothing and reports success for a question
    // it never asked, which is worse than having no sweep at all
    expect(figures.length, 'no nullable figures found — has types.ts moved or been reformatted?').toBeGreaterThan(0);

    /**
     * Cross-checked against a count that shares none of the shape assumptions
     * above: no indentation anchor, no trailing semicolon, no capture. The
     * dangerous failure is not the regex breaking outright — that trips the
     * assertion above — but its matching HALF the declarations after a
     * reformat, leaving a sweep that looks healthy while covering four fields
     * out of eight.
     */
    const loose = (readFileSync(TYPES, 'utf8').match(/:\s*number\s*\|\s*null/g) ?? []).length;
    expect(figures.length, 'the field regex is seeing fewer declarations than the file contains').toBe(loose);
  });

  it('finds the source it is meant to be sweeping', () => {
    expect(files.length, 'the sweep found no source files — the paths have moved').toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('lib/exportXlsx.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('routers/appraisal.ts'))).toBe(true);
  });

  it('finds the defect it is meant to be sweeping', () => {
    /**
     * The lines this sweep was written for, verbatim from the commit before
     * they were fixed. Built from `figures[0]`-style lookups rather than
     * hard-coded names so that an empty or shrunken field list fails HERE
     * too, instead of leaving a detector that matches nothing and says so
     * cheerfully.
     */
    const roc = figures.find((f) => f === 'rocAtAsking');
    const eq = figures.find((f) => f === 'eqIrr');
    expect([roc, eq], 'the fields these two findings turned on are no longer declared').toEqual([
      'rocAtAsking',
      'eqIrr',
    ]);
    expect(defaulted(roc!).test("if ((r.rocAtAsking ?? 0.2) >= 0.17) verdict = 'Proceed';")).toBe(true);
    expect(defaulted(eq!).test("['Equity IRR (annualised)', R.cash?.eqIrr ?? 0, FMT_PCT],")).toBe(true);
    // the same defect through `||`
    expect(defaulted(roc!).test('const roc = r.rocAtAsking || 0;')).toBe(true);
    // and does not fire on the honest shapes beside them
    expect(defaulted(roc!).test("value={ind.roc != null ? formatPct(ind.roc, 0) : '—'}")).toBe(false);
    expect(defaulted(eq!).test("R.cash?.eqIrr ?? NOT_COMPUTED,")).toBe(false);
    // nor on a null carried into a comparison, which states no figure
    expect(defaulted(roc!).test('if (r.rocAtAsking === null) return residualGrade;')).toBe(false);
  });

  for (const figure of declaredNullableFigures()) {
    it(`is never quietly defaulted to a number: ${figure}`, () => {
      const re = defaulted(figure);
      const offenders = files
        .flatMap((f) =>
          readFileSync(f, 'utf8')
            .split('\n')
            .map((line, i) => ({ line, at: `${relative(ROOT, f)}:${i + 1}` }))
            .filter(({ line }) => re.test(line)),
        )
        .map(({ at, line }) => `${at}  ${line.trim()}`);
      expect(
        offenders,
        `\`${figure}\` is null when the engine could not compute it. Substituting a number here states a figure nobody produced — carry the null to the point of display and show "N/A" or an em dash there.`,
      ).toEqual([]);
    });
  }
});
