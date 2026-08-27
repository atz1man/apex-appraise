import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentAppraisal, currentAppraisals, currentByDeal } from '../src/current-appraisal.js';
import { makeTenant, prisma, resetDatabase } from './harness.js';

/**
 * "The current appraisal" has one definition, and nothing else may spell it out.
 *
 * Fourteen places asked the question and resolved it three ways: `findFirst`
 * with no order, `findFirst` ordered by `updatedAt` desc, and the two portfolio
 * rollups building `new Map(rows.map(a => [a.dealId, a]))` — which keeps
 * whichever row arrived LAST.
 *
 * While `isCurrent` really is unique per deal those three agree, so nothing was
 * visibly wrong. The exposure is the one `aa6a119` was about: nothing MADE them
 * agree. `a51595a` closed the last path that could produce a second current row,
 * but a bad migration or a restored backup can still do it, and then the Red
 * Book, the deal card and `appraisal.getCurrent` would each report a different
 * version — every one of them using the engine correctly, on different inputs,
 * which is the single way the one-engine guards cannot see a disagreement.
 *
 * `current-appraisal.ts` answers it once. This refuses a new site that answers
 * it again, the same way `one-engine-sweep` refuses a second derivation of a
 * figure the engine owns.
 */

const API_SRC = join(import.meta.dirname, '..', 'src');

/** the module that IS the definition, and the writes that maintain it */
const ALLOWED = ['current-appraisal.ts'];

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
};

/**
 * A READ of the current appraisal: `appraisal.findFirst`/`findMany` whose
 * argument object filters on `isCurrent: true`. Writes are excluded by matching
 * only the two read methods — the compare-and-set `updateMany`s in
 * `appraisal.save` and `restore` filter on `isCurrent: true` too, and they are
 * how the invariant is maintained rather than a place that asks about it.
 */
const READ = /appraisal\.(findFirst|findMany)\(\s*\{(.{0,400}?)\}\s*\)/gs;

describe('one definition of the current appraisal', () => {
  const files = sourceFiles(API_SRC);

  it('finds the source it is meant to be sweeping', () => {
    // a sweep over an empty file list passes silently, reporting success for a
    // question it never asked
    expect(files.length, 'no source files — the path has moved').toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('current-appraisal.ts')), 'the definition itself is missing').toBe(true);
    const anyRead = files.some((f) => [...readFileSync(f, 'utf8').matchAll(READ)].some(([, , body]) => /isCurrent:\s*true/.test(body!)));
    expect(anyRead, 'the matcher found no reads at all, so it would pass whatever the code said').toBe(true);
  });

  it('is the only place that spells the query out', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(READ)) {
        // `isCurrent` inside a `select` is asking for the FLAG, not filtering on
        // it — `appraisal.versions` lists every version and reports which is current
        const body = m[2]!;
        const where = body.match(/where:\s*\{([^}]*)\}/)?.[1] ?? '';
        if (/isCurrent:\s*true/.test(where)) {
          offenders.push(`${relative(API_SRC, file)}: ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(
      offenders,
      'reads the current appraisal directly — use currentAppraisal()/currentAppraisals() from current-appraisal.ts',
    ).toEqual([]);
  });
});

describe('the portfolio rollup and a single deal agree', () => {
  it('keeps the newest row per deal, not the last one to arrive', () => {
    /**
     * The rows arrive newest-first from `currentAppraisals`. If a deal ever has
     * two current rows, a rollup must land on the same one the deal's own report
     * does — first-wins over a newest-first list. `new Map(rows.map(...))`, what
     * both rollups used to do, keeps the OLDEST of the two.
     */
    const newest = { dealId: 'd1', id: 'newest' };
    const older = { dealId: 'd1', id: 'older' };
    expect(currentByDeal([newest, older]).get('d1')).toBe(newest);
    expect(new Map([newest, older].map((a) => [a.dealId, a])).get('d1'), 'the old behaviour, for contrast').toBe(older);
  });

  it('keeps every deal', () => {
    const rows = [{ dealId: 'a', id: 1 }, { dealId: 'b', id: 2 }, { dealId: 'a', id: 3 }];
    expect([...currentByDeal(rows).keys()].sort()).toEqual(['a', 'b']);
  });
});

/**
 * Which of two current rows wins, pinned against the database.
 *
 * `CURRENT_FIRST` is the whole definition — reverse it to `asc` and every
 * surface silently starts reporting the OLDEST current row instead of the
 * newest, with no test above noticing. The mutation survived until this existed.
 *
 * Two current rows for one deal is the state `a51595a` made unreachable through
 * the API, so they are written here directly. That is the point: this asks what
 * happens if the invariant is ever broken by something the API cannot see — a
 * bad migration, a restored backup — and the answer has to be "every surface
 * still agrees with every other".
 */
describe('with two rows current, which one is "the" one', () => {
  it('is the most recently updated, everywhere that asks', async () => {
    resetDatabase();
    const T = await makeTenant('TwoCurrent');
    const base = { orgId: T.orgId, dealId: T.dealId, isCurrent: true, units: '[]', trades: '[]', otherCosts: '[]' };
    const older = await prisma.appraisal.create({ data: { ...base, label: 'older' } });
    await new Promise((r) => setTimeout(r, 20));
    const newer = await prisma.appraisal.create({ data: { ...base, label: 'newer' } });
    expect(newer.updatedAt.getTime()).toBeGreaterThan(older.updatedAt.getTime());

    const one = await currentAppraisal(prisma.appraisal, T.dealId, T.orgId);
    expect(one?.label, 'the single-deal read returned the older row').toBe('newer');

    const many = await currentAppraisals(prisma.appraisal, T.orgId);
    expect(currentByDeal(many).get(T.dealId)?.label, 'the portfolio rollup disagreed with the deal').toBe('newer');
  });
});
