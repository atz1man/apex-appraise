import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every control a person types into says what it is for.
 *
 * A `placeholder` is not a name. It disappears the moment somebody types, it is
 * not reliably announced, and it fails WCAG 4.1.2 on its own — so a form that
 * reads perfectly to a sighted user can be a row of unlabelled boxes to anyone
 * using a screen reader. Two of the worst were the region and asset-class
 * pickers on Benchmarking: both announced as "combo box", neither saying which.
 *
 * The matcher took three passes to become worth trusting, and the two it failed
 * are recorded here because they are the reason it is shaped the way it is.
 *
 *   48 flagged  — counting a `<select>` in a JSDoc comment, and every control
 *                 wrapped in a plain `<label>`, which is a valid implicit label
 *   29 flagged  — after teaching it about wrapping labels; still counting
 *                 `htmlFor={`cred-${f.key}`}`, because the id matcher did not
 *                 know about backticks, and every control inside a wrapper
 *                 COMPONENT that renders the label for it
 *   the real set — below
 *
 * A number arrived at by a matcher nobody has checked against the source is not
 * a measurement. Each refinement here came from reading the code it accused.
 */

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Components that render a wrapping `<label>` around whatever they are given,
 * so a control inside one is named by it.
 *
 * Asserted against their own source below, not trusted: an entry here that
 * stops rendering a label would otherwise go on excusing every control it
 * wraps, silently and for ever.
 */
const LABEL_WRAPPERS = ['Field', 'NumField', 'NumBox', 'TextBox'] as const;

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

/**
 * `id=` / `htmlFor=` in any of the three quote styles React allows.
 *
 * NOT PROVEN, and said here rather than left to look thorough: removing the
 * backtick from these character classes survives every case below and every
 * file in the tree. It survives because `htmlFor` and `id` are always written
 * in the SAME style at a given site — `htmlFor={\`cred-${f.key}\`}` beside
 * `id={\`cred-${f.key}\`}` — so whatever the matcher captures, it captures
 * identically on both sides and they still pair up. The backtick stays because
 * the matcher is more correct with it, not because a test forces it.
 */
const attrValues = (source: string, attr: string): Set<string> =>
  new Set([...source.matchAll(new RegExp(`${attr}=[{\`'"]+([^}\`'"]+)`, 'g'))].map((m) => m[1]!));

/** Controls with nothing that names them, as `{file, line, tag}`. */
export function unnamedControls(source: string): Array<{ line: number; tag: string }> {
  const t = stripComments(source);
  const labelled = attrValues(t, 'htmlFor');
  const wrapperOpen = new RegExp(`<(?:label\\b|${LABEL_WRAPPERS.join('|')})\\b`, 'g');
  const wrapperClose = new RegExp(`</(?:label|${LABEL_WRAPPERS.join('|')})>`, 'g');
  const out: Array<{ line: number; tag: string }> = [];

  for (const m of t.matchAll(/<(input|select|textarea)\b/g)) {
    const start = m.index!;
    // the element's own attributes: to the first '>' outside a JSX expression
    let depth = 0;
    let k = m.index! + m[0].length;
    for (; k < t.length; k++) {
      if (t[k] === '{') depth++;
      else if (t[k] === '}') depth--;
      else if (t[k] === '>' && depth === 0) break;
    }
    const attrs = t.slice(start, k);
    if (/aria-label|aria-labelledby|type="hidden"/.test(attrs)) continue;
    const id = [...attrValues(attrs, 'id')][0];
    if (id && labelled.has(id)) continue;
    // inside a <label> or a wrapper component that renders one?
    const before = t.slice(0, start);
    if ((before.match(wrapperOpen) ?? []).length > (before.match(wrapperClose) ?? []).length) continue;
    out.push({ line: source.slice(0, start).split('\n').length, tag: m[1]! });
  }
  return out;
}

describe('every control says what it is for', () => {
  const files = walk(SRC).map((p) => relative(SRC, p));

  it('sweeps the real tree', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('routes/Benchmarking.tsx');
  });

  it('every declaration of every label-wrapper really renders a label', () => {
    /*
     * EVERY declaration, not "one somewhere in the tree". `Field` is declared
     * twice — in `Investors.tsx` and in `SalesCrm.tsx` — and a first version of
     * this searched the whole tree joined together, so breaking one of them
     * left the test green on the strength of the other while every control the
     * broken one wraps went on being excused.
     */
    let found = 0;
    for (const rel of files) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      for (const w of LABEL_WRAPPERS) {
        for (const m of src.matchAll(new RegExp(`function ${w}\\b`, 'g'))) {
          found++;
          const body = src.slice(m.index!, m.index! + 700);
          expect(
            body.includes('<label'),
            `${rel} declares ${w}, which is exempted as a label wrapper, and it does not render a <label>`,
          ).toBe(true);
        }
      }
    }
    // and the list must name components that exist at all
    expect(found, 'LABEL_WRAPPERS names nothing this tree declares').toBeGreaterThanOrEqual(LABEL_WRAPPERS.length);
  });

  it('leaves no control unnamed', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      for (const c of unnamedControls(readFileSync(join(SRC, rel), 'utf8'))) {
        offenders.push(`${rel}:${c.line}  <${c.tag}>`);
      }
    }
    expect(
      offenders,
      'a screen reader announces these as an unnamed box. Add an aria-label, or wrap it in a ' +
        `<label>. A placeholder is not a name:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('finds what it is meant to find', () => {
    expect(unnamedControls('<input className="x" placeholder="Search" />')).toEqual([{ line: 1, tag: 'input' }]);
    // a placeholder is NOT a name — the whole point
    expect(unnamedControls('<input placeholder="Region" />')).toHaveLength(1);
    // the four things that are
    expect(unnamedControls('<input aria-label="Region" />')).toEqual([]);
    expect(unnamedControls('<label className="b"><span>Region</span><input /></label>')).toEqual([]);
    expect(unnamedControls('<label htmlFor="r">Region</label><input id="r" />')).toEqual([]);
    expect(unnamedControls('<Field label="Region"><input /></Field>')).toEqual([]);
    // …including the backtick form, which the second version of this matcher missed
    expect(unnamedControls('<label htmlFor={`cred-${k}`}>K</label><input id={`cred-${k}`} />')).toEqual([]);
    // and a <select> written in a comment is not a control
    expect(unnamedControls('/* a styled replacement for <select> */')).toEqual([]);
  });
});
