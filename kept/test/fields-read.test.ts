import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * Every field on the stored model is READ by something, not just written.
 *
 * The sibling sweep in reachable.test.ts asks "who reads this?" of exports,
 * and says at its top that it cannot ask it of a FIELD. This asks it of the
 * fields, because that is where two of the three worst versions of this defect
 * actually lived.
 *
 * `clockStart` sat on all twenty entries of the store table — every one of
 * them written by hand, with three entries' own prose explaining the
 * limitation it was there to remove — and nothing ever read it. Every Zara
 * receipt anyone added counted its 30 days from the order rather than from
 * dispatch, which can say "window closed" on a day Zara would still take the
 * coat back. `returnedOn` was written by the reducer on every return and shown
 * on no screen. Both look exactly like a field in use if you only grep for the
 * name: the writes are there, in quantity, and they are not the question.
 *
 * So the parser distinguishes them. A write is a key in an object literal or
 * the left of an assignment; a read is a property access or a destructuring.
 * Only reads count.
 *
 * And one distinction beyond that, which the first version of this file did
 * not draw and `returnedOn` slipped straight through. Its reads were real —
 * `backup.ts` reads it to copy it into an export and back out of one. But
 * copying a value through a serialiser is not looking at it, and a field that
 * is written, saved, restored and never consulted by anything that decides or
 * displays is exactly as dead as one with no reads at all. So the persistence
 * layer is counted separately, and a field only IT reads is reported in its
 * own words. Neither list has an entry today; both were confirmed to fill by
 * putting the original defect back.
 */

const SRC = new URL('../src/', import.meta.url).pathname;

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

const srcFiles = walk(SRC);
const parsed = new Map(srcFiles.map((f) => [f, parse(f)]));

/**
 * The shapes the app persists and passes around. Named rather than "every
 * interface", because a props interface is read by the component's own
 * parameter list and would be noise here.
 */
const MODELS = ['Receipt', 'PolicyUpdate', 'Warranty', 'Settings', 'StorePolicy'];

function declaredFields(): { model: string; field: string; file: string }[] {
  const out: { model: string; field: string; file: string }[] = [];
  for (const [file, sf] of parsed) {
    for (const st of sf.statements) {
      if (!ts.isInterfaceDeclaration(st) || !MODELS.includes(st.name.text)) continue;
      for (const m of st.members) {
        if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) {
          out.push({ model: st.name.text, field: m.name.text, file: file.slice(SRC.length) });
        }
      }
    }
  }
  return out;
}

/**
 * Every field name this file READS.
 *
 * `r.status` counts. `{ status: 'active' }` does not — that is a write, and a
 * field written a hundred times and read nowhere is precisely the defect.
 * `const { status } = r` counts, since destructuring is how half this codebase
 * reads a receipt.
 */
function fieldsRead(sf: ts.SourceFile): Set<string> {
  const read = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) {
      // `x.foo = 1` writes; `x.foo` anywhere else reads. `x.foo += 1` reads too.
      const isAssignedTo =
        n.parent &&
        ts.isBinaryExpression(n.parent) &&
        n.parent.left === n &&
        n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (!isAssignedTo) read.add(n.name.text);
    } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const key = n.propertyName ?? n.name;
      if (ts.isIdentifier(key)) read.add(key.text);
    } else if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression)) {
      read.add(n.argumentExpression.text);
    }
    n.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return read;
}

/** The files whose job is moving the record in and out, not using it. */
const PLUMBING = /lib\/(backup|storage)\.ts$/;

const readAnywhere = new Set<string>();
const readOutsidePlumbing = new Set<string>();
for (const [file, sf] of parsed) {
  for (const f of fieldsRead(sf)) {
    readAnywhere.add(f);
    if (!PLUMBING.test(file)) readOutsidePlumbing.add(f);
  }
}

const fields = declaredFields();
const writtenOnly = fields.filter((f) => !readAnywhere.has(f.field));
const plumbingOnly = fields.filter((f) => readAnywhere.has(f.field) && !readOutsidePlumbing.has(f.field));

describe('every stored field is read, not only written', () => {
  it('found the models it is meant to be walking', () => {
    // A sweep that matched no interface would report a clean pass over
    // nothing. Every model named above has to have been found, so renaming one
    // fails here rather than silently shrinking what is swept.
    const seen = new Set(fields.map((f) => f.model));
    for (const m of MODELS) expect([...seen], `${m} was not found as an interface`).toContain(m);
    expect(fields.length).toBeGreaterThan(25);
  });

  it('tells a read from a write', () => {
    // The distinction the verdict rests on, checked on source written here
    // rather than trusted. If this stopped holding, every field would look
    // read and the sweep would pass on anything.
    const sample = ts.createSourceFile(
      'sample.ts',
      'const w = { onlyWritten: 1 }; const r = w.alsoRead; const { destructured } = w; w.assigned = 2;',
      ts.ScriptTarget.Latest,
      true,
    );
    const read = fieldsRead(sample);
    expect([...read].sort()).toEqual(['alsoRead', 'destructured']);
  });

  it('knows which files are the persistence layer', () => {
    // The second verdict rests on this pattern matching something. If backup.ts
    // were renamed, every field it copies would silently start counting as
    // used and this file would go on reporting a clean pass.
    expect(srcFiles.filter((f) => PLUMBING.test(f)).length).toBe(2);
  });

  it('has no field the app writes and never looks at', () => {
    const listed = writtenOnly.map((f) => `  ${f.model}.${f.field}  (src/${f.file})`).join('\n');
    expect(writtenOnly, `\n${listed}\n`).toEqual([]);
  });

  it('has no field only the saving and restoring of it reads', () => {
    const listed = plumbingOnly
      .map((f) => `  ${f.model}.${f.field}  (src/${f.file}) — saved and restored, and nothing decides or displays anything with it`)
      .join('\n');
    expect(plumbingOnly, `\n${listed}\n`).toEqual([]);
  });
});
