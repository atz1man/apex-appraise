import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_CLASSES, ASSET_TYPES, assetClass, assetLabel, isIncomeLed } from '@apex/types/asset-classes';
import { assetFamilyTag } from '@apex/ui-tokens';
import { startingIncome, startingIncomeLine } from './starting-income';

/**
 * The asset taxonomy, and the sweep that keeps it the only copy.
 *
 * Adding the operated classes (build-to-rent, student, co-living, care homes,
 * hotels) meant nine edits before this file existed: five hand-kept label
 * tables, a chip-colour table keyed by code, a use-class table on the
 * certificate, and four screens that derived a label from the stored code with
 * `.replace('_', '-')`. None of them knew about the others, and they already
 * disagreed — "Mixed use" on one screen, "Mixed-use" on three.
 */
describe('the asset taxonomy', () => {
  it('is the list zod, the database and every dropdown use', () => {
    expect([...ASSET_TYPES]).toEqual(ASSET_CLASSES.map((c) => c.code));
    // development classes first — a firm that builds and sells sees its own work at the top
    expect(ASSET_CLASSES.slice(0, 4).map((c) => c.code)).toEqual(['INDUSTRIAL', 'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE']);
    expect(ASSET_CLASSES.filter((c) => c.incomeLed).map((c) => c.code)).toEqual(['BTR', 'STUDENT', 'CO_LIVING', 'CARE_HOME', 'HOTEL']);
  });

  it('gives every class a distinct code, label, chip and colour', () => {
    for (const key of ['code', 'label', 'tag', 'reportLabel'] as const) {
      const seen = ASSET_CLASSES.map((c) => c[key]);
      expect(new Set(seen).size, `two classes share a ${key}`).toBe(seen.length);
    }
    for (const c of ASSET_CLASSES) {
      // the chip is mono capitals with no underscore — it is read, not parsed
      expect(c.tag, `${c.code} chip`).toMatch(/^[A-Z0-9-]+$/);
      expect(assetFamilyTag[c.family], `${c.code} has no chip colour`).toBeTruthy();
      expect(c.useClass.length, `${c.code} has no planning use class`).toBeGreaterThan(0);
    }
  });

  it('leaves every figure and every chip on the four original classes exactly where it was', () => {
    // the point of the refactor is that NOTHING existing moves. These are the
    // values the five tables held between them before they were deleted.
    expect(ASSET_CLASSES.slice(0, 4).map((c) => [c.code, c.label, c.tag, c.family])).toEqual([
      ['INDUSTRIAL', 'Industrial', 'INDUSTRIAL', 'industrial'],
      ['RESIDENTIAL', 'Residential', 'RESIDENTIAL', 'residential'],
      ['COMMERCIAL', 'Commercial', 'COMMERCIAL', 'commercial'],
      ['MIXED_USE', 'Mixed-use', 'MIXED-USE', 'mixed'],
    ]);
    expect(ASSET_CLASSES.slice(0, 4).map((c) => [c.reportLabel, c.useClass])).toEqual([
      ['Industrial / trade', 'B2 / B8'],
      ['Residential dwelling', 'C3 — Dwelling'],
      ['Commercial', 'E — Commercial'],
      ['Mixed-use', 'Sui generis'],
    ]);
  });

  it('answers undefined for a code it does not know, rather than a confident wrong one', () => {
    // the chip table used to fall back to INDUSTRIAL, so an uncoloured class
    // printed a green "INDUSTRIAL"-family chip and looked deliberate
    expect(assetClass('LEISURE')).toBeUndefined();
    expect(assetClass(null)).toBeUndefined();
    expect(assetClass(undefined)).toBeUndefined();
    expect(assetLabel('LEISURE')).toBe('LEISURE');
    expect(assetLabel(null)).toBe('');
    expect(isIncomeLed('LEISURE')).toBe(false);
  });
});

describe('the rent roll a scheme starts from', () => {
  it('is byte-for-byte what the appraisal screen hard-coded, for the development classes', () => {
    for (const code of ['INDUSTRIAL', 'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE']) {
      expect(startingIncome(code), code).toEqual({
        lines: [{ label: 'Let space', count: 1, area: 5000, rentPsf: 15, voidPct: 5 }],
        nonRecoverablePct: 5,
        annualDeductions: 0,
        yieldPct: 7,
        purchaserCostsPct: 6.8,
        letUpMonths: 6,
      });
      expect(startingIncomeLine(code), code).toEqual({ label: 'Let space', count: 1, area: 2000, rentPsf: 15, voidPct: 5 });
    }
  });

  it('names the line and prices the yield by class for an operated asset', () => {
    expect(startingIncome('BTR').lines[0]!.label).toBe('Apartments');
    expect(startingIncome('BTR').yieldPct).toBe(4.25);
    expect(startingIncome('STUDENT').lines[0]!.label).toBe('Study bedrooms');
    expect(startingIncome('CARE_HOME').lines[0]!.label).toBe('Beds');
    expect(startingIncome('HOTEL').lines[0]!.label).toBe('Keys');
    // "Let space" on a scheme whose value IS the operating income is not a
    // starting point, it is a correction waiting to happen
    for (const c of ASSET_CLASSES.filter((x) => x.incomeLed)) {
      expect(startingIncome(c.code).lines[0]!.label, c.code).not.toBe('Let space');
    }
  });

  it('guesses no fact about a particular scheme — only the name and the yield move', () => {
    const generic = startingIncome('INDUSTRIAL');
    for (const c of ASSET_CLASSES) {
      const s = startingIncome(c.code);
      expect([s.lines[0]!.count, s.lines[0]!.area, s.lines[0]!.rentPsf, s.lines[0]!.voidPct], c.code).toEqual([
        generic.lines[0]!.count,
        generic.lines[0]!.area,
        generic.lines[0]!.rentPsf,
        generic.lines[0]!.voidPct,
      ]);
      expect([s.nonRecoverablePct, s.annualDeductions, s.purchaserCostsPct, s.letUpMonths], c.code).toEqual([
        generic.nonRecoverablePct,
        generic.annualDeductions,
        generic.purchaserCostsPct,
        generic.letUpMonths,
      ]);
    }
  });

  it('falls back to the generic roll for a class it does not know', () => {
    expect(startingIncome('LEISURE')).toEqual(startingIncome('INDUSTRIAL'));
    expect(startingIncomeLine(undefined).label).toBe('Let space');
  });
});

// ---------------------------------------------------------------------------

const SRC = join(__dirname, '..');
/**
 * The design tokens are swept too, and not as an afterthought: the chip table
 * lived THERE, keyed by asset code, and it is the copy nobody would have
 * thought to look for.
 */
const TOKENS = join(__dirname, '../../../../packages/ui-tokens/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * The codes a source text spells out, deduplicated.
 *
 * ONE is legitimate and common — a form's starting value, a fallback on a
 * report. TWO in one file is a table: every one of the five copies this
 * taxonomy replaced named all four.
 *
 * A code counts whether it is quoted OR used as an object key, and the second
 * half is not decoration: three of the five tables (`assetTypeTag`, and the
 * certificate's `assetLabel` and `useClass`) wrote their codes as bare keys, so
 * a matcher that only saw quoted strings would have passed over the majority of
 * what it was written to find.
 */
export function assetCodesNamed(text: string): string[] {
  const found = new Set<string>();
  for (const c of ASSET_CLASSES) {
    if (new RegExp(`(['"\`]${c.code}['"\`]|\\b${c.code}\\s*:)`).test(text)) found.add(c.code);
  }
  return [...found];
}

/** A displayed label carved out of the stored code by string surgery. */
export function labelFromCodeSites(text: string): Array<{ line: number; snippet: string }> {
  const out: Array<{ line: number; snippet: string }> = [];
  text.split('\n').forEach((l, i) => {
    const m = l.match(/\bassetType\b[^\n]{0,40}?\.replace\(/);
    if (m) out.push({ line: i + 1, snippet: l.trim().slice(0, 90) });
  });
  return out;
}

describe('the browser keeps no second copy of the taxonomy', () => {
  const files = [...walk(SRC), ...walk(TOKENS)].map((p) => relative(SRC, p));

  it('sweeps the real tree, not an empty list', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('routes/Board.tsx');
    expect(files).toContain('routes/RedBookReport.tsx');
    expect(files).toContain('../../../packages/ui-tokens/src/tokens.ts');
  });

  it('no component or route spells out more than one asset code', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const named = assetCodesNamed(readFileSync(join(SRC, rel), 'utf8'));
      if (named.length > 1) offenders.push(`${rel}  names ${named.join(', ')}`);
    }
    expect(
      offenders,
      `an asset-class table outside @apex/types/asset-classes — import the taxonomy instead:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no screen carves a label out of the stored code', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      for (const s of labelFromCodeSites(readFileSync(join(SRC, rel), 'utf8'))) offenders.push(`${rel}:${s.line}  ${s.snippet}`);
    }
    expect(offenders, `use assetLabel() — a code is a database value, not wording:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('finds what it is meant to find', () => {
    // the five tables, as they actually stood — Benchmarking's is the shortest
    expect(assetCodesNamed(`const USE_CLASSES = [['INDUSTRIAL', 'Industrial'], ['MIXED_USE', 'Mixed-use']];`).sort()).toEqual([
      'INDUSTRIAL',
      'MIXED_USE',
    ]);
    // the chip table's shape — bare keys, which is the half a quoted-string matcher misses
    expect(assetCodesNamed(`INDUSTRIAL: { text: brandInk }, RESIDENTIAL: { text: blue },`).sort()).toEqual(['INDUSTRIAL', 'RESIDENTIAL']);
    expect(assetCodesNamed(`"INDUSTRIAL": 'B2 / B8', "MIXED_USE": 'Sui generis'`).length).toBe(2);
    // one code is a default, not a table
    expect(assetCodesNamed(`useState({ assetType: 'RESIDENTIAL' })`)).toEqual(['RESIDENTIAL']);
    expect(assetCodesNamed(`assetClass(deal?.assetType ?? 'RESIDENTIAL')`)).toEqual(['RESIDENTIAL']);
    // an operated class added to a stale table trips it the same way
    expect(assetCodesNamed(`[['BTR', 'Build to rent'], ['HOTEL', 'Hotel']]`).sort()).toEqual(['BTR', 'HOTEL']);
    // and a word that merely contains a code is not one
    expect(assetCodesNamed(`const HOTELS = 4; // 'INDUSTRIALISED' schemes`)).toEqual([]);

    // the four label-from-code sites, verbatim from the commit before this one
    expect(labelFromCodeSites(`<KvRow k="Asset type" v={(deal?.assetType ?? '—').replace('_', ' / ')} />`)).toHaveLength(1);
    expect(labelFromCodeSites("{deal ? `${deal.assetType.replace('_', ' / ')} · ${deal.address}` : ''}")).toHaveLength(1);
    expect(labelFromCodeSites(`{d.address} · {d.assetType.replace('_', '-').toLowerCase()}`)).toHaveLength(1);
    expect(labelFromCodeSites(`['Asset type', deal.assetType.replace('_', '-').toLowerCase()],`)).toHaveLength(1);
    // and not a stage, which is a different enum with its own list
    expect(labelFromCodeSites(`{deal?.stage?.replace('_', ' / ').toLowerCase()}`)).toEqual([]);
    // NOT reached, and said out loud rather than quietly: a label carved out of
    // a PARAMETER (`AssetTag`'s `type.replace('_', '-')`) is invisible to a
    // static matcher, because the parameter is named `type` and so is every
    // other one. Both such sites now read the taxonomy; a third would need a
    // rule of its own rather than this one loosened into matching `.replace('_'`
    // everywhere, which deal stages would trip on every screen.
    expect(labelFromCodeSites(`return <span>{type.replace('_', '-')}</span>;`)).toEqual([]);
  });
});
