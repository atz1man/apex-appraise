import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A control whose only label is a symbol has no name.
 *
 * `accessible-names.test.ts` covers what a person TYPES into — `input`,
 * `select`, `textarea`. It says nothing about buttons, and buttons had their
 * own version of the same defect wearing a disguise: "×" is a text node, so
 * every "does this control have text?" check passes it, and a screen reader
 * reads it as "multiplication sign". Three were found by hand, one at a time,
 * which is this repo's threshold for writing the rule down: the drawer's close
 * button (reached from six screens), the payment dialog's, and the toast's.
 *
 * The rule is narrow on purpose — a button whose entire visible text is one or
 * two characters with no letter or digit in them, and no `aria-label`. That is
 * ×, ✕, ‹, ›, +, ⋯: glyphs standing in for a verb. A `title` does NOT excuse
 * one: it is a name to some assistive technology and a mouse-only tooltip to
 * the rest, so it is a hint rather than a name.
 */

const WEB_SRC = join(__dirname, '..');
const SYMBOL_ONLY = /^[^\w\s]{1,2}$/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.tsx') && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Comments out, LINE NUMBERS intact — each comment becomes the same number of
 * blank lines it occupied. The first version simply deleted them and then
 * counted newlines in the shortened text, so every offender it reported was
 * named at a line that had drifted upwards by however much prose sat above it.
 * A sweep that names the wrong line is the `destructive` lesson again: the
 * right count under the wrong address, and the address is what somebody opens.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Where the opening tag ends — tracked by brace depth rather than by the first
 * `>`, and that is not fussiness. `onClick={() => setToasts(...)}` contains a
 * `>`, so a matcher splitting on the first one cuts the tag in the middle of an
 * arrow function and reads half the handler as the button's content. Measured:
 * the naive version found two of the three known buttons and silently missed
 * the toast's, which is the one with an arrow function in its handler.
 */
export function openTagEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** Buttons whose entire name is a symbol, as `file:line`. */
export function symbolButtons(file: string, source: string): string[] {
  const t = stripComments(source);
  const out: string[] = [];
  for (const m of t.matchAll(/<button\b/g)) {
    const gt = openTagEnd(t, m.index!);
    const close = t.indexOf('</button>', gt);
    if (gt === -1 || close === -1) continue;
    const attrs = t.slice(m.index!, gt);
    if (/aria-label|aria-labelledby/.test(attrs)) continue;
    const inner = t.slice(gt + 1, close).replace(/<[^>]*>/g, '');
    /**
     * Anything interpolated means the button renders something we cannot read
     * from here, and it is almost always the label. Two real buttons were
     * reported before this line existed — a filter chip rendering
     * `{f.label} · {count}` and a document toggle rendering `{d.label}` — where
     * stripping the expressions left the SEPARATOR behind and a middle dot
     * looks exactly like a symbol-only name. The separator was never the name;
     * it was what sat between two of them.
     */
    if (inner.includes('{')) continue;
    const text = inner.trim();
    if (text && SYMBOL_ONLY.test(text)) out.push(`${file}:${t.slice(0, m.index!).split('\n').length}`);
  }
  return out;
}

describe('buttons labelled with a symbol', () => {
  it('do not exist — every one of them says what it does', () => {
    const offenders = sources(WEB_SRC).flatMap((f) => symbolButtons(f.replace(`${WEB_SRC}/`, ''), readFileSync(f, 'utf8')));
    expect(
      offenders,
      `these read as "multiplication sign" to a screen reader — give them an aria-label:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('recognises one when there is one', () => {
    expect(symbolButtons('x.tsx', '<button onClick={onClose}>×</button>')).toEqual(['x.tsx:1']);
  });

  /**
   * The case the first version of this matcher got wrong, and the reason
   * `openTagEnd` exists. Splitting the tag at the first `>` cuts through the
   * arrow function and reads part of the handler as the button's content, so
   * the button is not reported. It found two of the three known offenders and
   * missed exactly this one.
   */
  it('is not fooled by an arrow function in a handler', () => {
    const src = '<button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>';
    expect(symbolButtons('x.tsx', src)).toEqual(['x.tsx:1']);
  });

  it('accepts a named one', () => {
    expect(symbolButtons('x.tsx', '<button aria-label="Close" onClick={onClose}>×</button>')).toEqual([]);
  });

  /**
   * And does not sweep in a button that says something. `{inner}`,
   * `{busy ? <Spinner /> : \'Save\'}` and plain words are all names — a rule
   * that reported those would be reporting most of the product.
   */
  it('leaves buttons with real labels alone', () => {
    expect(symbolButtons('x.tsx', '<button onClick={go}>Save appraisal</button>')).toEqual([]);
    expect(symbolButtons('x.tsx', '<button onClick={go}>{inner}</button>')).toEqual([]);
    expect(symbolButtons('x.tsx', "<button onClick={go}>{busy ? <Spinner /> : 'Save'}</button>")).toEqual([]);
  });

  /**
   * The second thing the first matcher got wrong, and the one that would have
   * cost somebody an afternoon: a SEPARATOR between two interpolated labels.
   * Strip the expressions and a middle dot is left standing on its own, which
   * looks exactly like a symbol-only name. Both real buttons it reported were
   * of this shape.
   */
  it('does not mistake a separator between two labels for a name', () => {
    const chip = '<button onClick={() => setFilter(f.id)}><Dot /> {f.label} · <span>{count}</span></button>';
    expect(symbolButtons('x.tsx', chip)).toEqual([]);
  });

  /**
   * And it names the line it means. Comments become blank lines rather than
   * disappearing, so an offender under a long comment is still reported where
   * it actually sits.
   */
  it('reports the line the button is on in the real file', () => {
    const src = ['/**', ' * four', ' * lines', ' */', '<button onClick={onClose}>×</button>'].join('\n');
    expect(symbolButtons('x.tsx', src)).toEqual(['x.tsx:5']);
  });
});
