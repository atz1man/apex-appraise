import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * Every export has something that reads it.
 *
 * "Who reads this?" is the lens that has found more here than any other, and
 * every time by someone remembering to ask it. Three icons were exported and
 * drawn by nobody — the exact shape this catches. So that much stops being a
 * question someone has to remember.
 *
 * Only that much, and the limit is worth writing down rather than leaving to
 * be discovered. This sweep sees EXPORTS. It does not see a dead field
 * (`clockStart` sat on all twenty shops unread, and it is a property, not an
 * export), a switch nothing consults (`settings.policyWatch` was read by its
 * own Settings row, which is a read), or a constant duplicated instead of
 * imported (`ONBOARDING_STEPS` was exported and used, beside a reducer that
 * typed the last index as a literal). Those still need the question asked by
 * hand. A guard is worth exactly what it checks, and saying so here is
 * cheaper than someone later assuming this covered them.
 *
 * The rule is deliberately narrow, because the first draft was not and the
 * difference is the whole value of the check. It asked for every export to be
 * IMPORTED, and reported twenty-one types and fifteen functions — nearly all
 * of them fine. A type naming the return of an exported function must itself
 * be exported or a caller cannot write the type down; a helper used inside its
 * own module and exported for a test is this codebase's own deliberate shape.
 * A check that reports thirty-six things when none is wrong is a check that
 * gets an exemption list and then gets ignored.
 *
 * So: dead means nothing anywhere reads it — no other source file, no test,
 * and not its own file either. That is a claim with no honest exceptions,
 * which is why this has none.
 *
 * It walks the real source with the TypeScript parser rather than a regex,
 * because `export const x = 1, y = 2` and `export { a as b }` are the shapes a
 * regex gets wrong, and a sweep that silently misses a form reports success
 * for a question it never asked.
 */

const SRC = new URL('../src/', import.meta.url).pathname;
const TESTS = new URL('./', import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

/** Every name this file exports, and the node that declares it. */
function exportsOf(sf: ts.SourceFile): { name: string; declaredAt: number }[] {
  const found: { name: string; declaredAt: number }[] = [];
  const exported = (n: ts.Node) =>
    ts.canHaveModifiers(n) &&
    (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && exported(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) found.push({ name: d.name.text, declaredAt: d.name.pos });
      }
    } else if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      exported(st) &&
      st.name
    ) {
      found.push({ name: st.name.text, declaredAt: st.name.pos });
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      // `export { a as b }` — b is the name the rest of the app can import.
      for (const e of st.exportClause.elements) found.push({ name: e.name.text, declaredAt: e.name.pos });
    }
  }
  return found;
}

/** Every identifier this file mentions, with where. Includes JSX tag names. */
function identifiersOf(sf: ts.SourceFile): { name: string; pos: number }[] {
  const out: { name: string; pos: number }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) out.push({ name: n.text, pos: n.pos });
    n.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return out;
}

/** True where a file pulls in every export of a module without naming one. */
function hasNamespaceImport(sf: ts.SourceFile): boolean {
  return sf.statements.some(
    (st) =>
      ts.isImportDeclaration(st) &&
      st.importClause?.namedBindings !== undefined &&
      ts.isNamespaceImport(st.importClause.namedBindings),
  );
}

const srcFiles = walk(SRC);
const testFiles = walk(TESTS).filter((f) => !f.endsWith('reachable.test.ts'));
const parsed = new Map([...srcFiles, ...testFiles].map((f) => [f, parse(f)]));

const namespaceImporters = [...srcFiles, ...testFiles].filter((f) => hasNamespaceImport(parsed.get(f)!));

/** Where each name is mentioned, keyed by name → set of "file:pos". */
const mentions = new Map<string, Set<string>>();
for (const [file, sf] of parsed) {
  for (const { name, pos } of identifiersOf(sf)) {
    if (!mentions.has(name)) mentions.set(name, new Set());
    mentions.get(name)!.add(`${file}:${pos}`);
  }
}

interface Dead { name: string; file: string; }
const dead: Dead[] = [];

for (const file of srcFiles) {
  for (const { name, declaredAt } of exportsOf(parsed.get(file)!)) {
    const seen = mentions.get(name) ?? new Set<string>();
    // Every mention that is not the declaration itself. One is enough: an
    // export used only inside its own module is exported more widely than it
    // needs to be, which is untidy and not a defect.
    const elsewhere = [...seen].filter((where) => where !== `${file}:${declaredAt}`);
    if (elsewhere.length === 0) dead.push({ name, file: file.slice(SRC.length) });
  }
}

describe('everything declared has something reading it', () => {
  it('parsed a source tree that is actually there', () => {
    // A sweep over an empty file list passes silently, reporting success for a
    // question it never asked. It has to have found the app first.
    expect(srcFiles.length).toBeGreaterThan(30);
    expect(testFiles.length).toBeGreaterThan(15);
    expect(mentions.size).toBeGreaterThan(300);
  });

  it('finds the shapes an export is written in', () => {
    // The four forms this codebase uses, named so that a parser change which
    // stops seeing one fails loudly rather than quietly sweeping less.
    const all = new Set(srcFiles.flatMap((f) => exportsOf(parsed.get(f)!).map((e) => e.name)));
    for (const known of ['derive', 'FREE_TIER_LIMIT', 'Receipt', 'Screen', 'App']) {
      expect(all, `${known} should have been seen as an export`).toContain(known);
    }
  });

  it('counts a mention that is not the declaration', () => {
    // The comparison the verdict rests on. `derive` is declared once in
    // receipts.ts and read by screens; if this stopped being true the sweep
    // would call live code dead, or dead code live, without saying so.
    const declaringFile = srcFiles.find((f) => f.endsWith('lib/receipts.ts'))!;
    const decl = exportsOf(parsed.get(declaringFile)!).find((e) => e.name === 'derive')!;
    const seen = [...(mentions.get('derive') ?? [])];
    expect(seen).toContain(`${declaringFile}:${decl.declaredAt}`);
    expect(seen.filter((w) => w !== `${declaringFile}:${decl.declaredAt}`).length).toBeGreaterThan(0);
  });

  it('has no export nothing reads', () => {
    const listed = dead.map((d) => `  ${d.name}  (src/${d.file})`).join('\n');
    expect(dead, `\n${listed}\n`).toEqual([]);
  });

  it('is not blinded by a namespace import', () => {
    // `import * as ns` makes every export of a module reachable without naming
    // one, so a dead export could hide behind it. There are none; if one is
    // added this sweep has to learn about it rather than go quiet.
    expect(namespaceImporters).toEqual([]);
  });
});
