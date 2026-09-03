import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No hook below an early return.
 *
 * React calls hooks in order and matches them up between renders by position.
 * A component that returns a spinner while its data loads, and calls a hook
 * two hundred lines further down, calls a different NUMBER of hooks on its
 * second render than its first — so React throws and the component renders as
 * nothing at all.
 *
 * Measured, and it is why this file exists: `useUnits()` was added to
 * `RedBookReport` beside the value that first uses it, which is below the
 * spinner and below the refusal for a deal with nothing to value. Twenty-one
 * e2e specs went red at once — every Red Book spec there is — and the whole
 * certificate rendered blank. Neither typecheck saw it, and neither could:
 * `pnpm lint` in this app is `tsc --noEmit`, and hook ORDER is not a type.
 * The usual answer is `eslint-plugin-react-hooks`; this repo runs no eslint,
 * and one rule is cheaper to keep than a linter is to introduce.
 *
 * Narrow on purpose. It asks one question — is there a hook STATEMENT after a
 * top-level `if` that returns — and it asks it of top-level function bodies
 * only. A hook inside a callback or a nested component is out of reach and
 * would need its own rule rather than this one loosened: the first matcher
 * written here allowed anything between the indent and the `use`, and read an
 * `onClick={() => useOption(s)}` deep inside JSX as a hook call.
 */

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** a function declared at column 0 — a component or a plain helper */
const FN = /^(?:export default (?:async )?function|export (?:async )?function|(?:async )?function)\s+[A-Za-z0-9_]+/;
/** `  if (` at the top level of that function's body */
const IF = /^ {2}if\s*\(/;
/** a return one level in, i.e. the `if` bails out of the component */
const GUARD_RETURN = /^ {4}return\b/;
/**
 * A hook CALL as a statement at the top level of the body: `  useX(` or
 * `  const a = useX(`, `  const { a } = useX(`, `  const a: T = useX(`.
 * Anything deeper is inside a callback or JSX and is a different question.
 */
const HOOK = /^ {2}(?:(?:const|let|var)\s+(?:\{[^}]*\}|[A-Za-z0-9_]+)(?:\s*:\s*[^=]+)?\s*=\s*)?use[A-Z][A-Za-z0-9_]*\(/;

/** Hook statements sitting after a bailing-out `if`, with the guard that shadows them. */
export function hooksBelowAGuard(text: string): Array<{ line: number; hook: string; guard: number }> {
  const lines = text.split('\n');
  const starts = lines.map((l, i) => (FN.test(l) ? i : -1)).filter((i) => i >= 0);
  const out: Array<{ line: number; hook: string; guard: number }> = [];

  starts.forEach((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const body = lines.slice(start, end);

    let guard: number | null = null;
    for (let i = 0; i < body.length && guard === null; i++) {
      if (!IF.test(body[i]!)) continue;
      // `if (x) return y;` on one line
      if (/\breturn\b/.test(body[i]!)) guard = i;
      else if (body[i]!.trimEnd().endsWith('{')) {
        for (let k = i + 1; k < body.length && !/^ {2}\}/.test(body[k]!); k++) {
          if (GUARD_RETURN.test(body[k]!)) { guard = i; break; }
        }
      }
    }
    if (guard === null) return;

    for (let i = guard + 1; i < body.length; i++) {
      if (HOOK.test(body[i]!)) out.push({ line: start + i + 1, hook: body[i]!.trim().slice(0, 80), guard: start + guard + 1 });
    }
  });
  return out;
}

describe('every component calls its hooks before it can return', () => {
  const files = walk(SRC).map((p) => relative(SRC, p));

  it('sweeps the real tree, not an empty list', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('routes/RedBookReport.tsx');
  });

  it('finds no hook below an early return', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      for (const s of hooksBelowAGuard(readFileSync(join(SRC, rel), 'utf8'))) {
        offenders.push(`${rel}:${s.line}  ${s.hook}  — unreachable on the render that returns at line ${s.guard}`);
      }
    }
    expect(
      offenders,
      `a hook below an early return renders the component as nothing — move it up with the other hooks:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('finds what it is meant to find', () => {
    // the shape that cost twenty-one e2e specs: a spinner, then a hook
    const broken = [
      'export default function Report() {',
      '  const { data, isLoading } = useQuery();',
      '  if (isLoading) {',
      '    return <Spinner />;',
      '  }',
      '  const U = useUnits();',
      '  return <div>{U.unit}</div>;',
      '}',
    ].join('\n');
    expect(hooksBelowAGuard(broken)).toEqual([{ line: 6, hook: 'const U = useUnits();', guard: 3 }]);

    // and the one-line form of the same guard
    const oneLine = 'function C() {\n  if (!x) return null;\n  const m = useMemo(() => 1, []);\n}';
    expect(hooksBelowAGuard(oneLine).map((s) => s.line)).toEqual([3]);

    // the same hook ABOVE the guard is the fix, and is not reported
    const fixed = [
      'export default function Report() {',
      '  const { data, isLoading } = useQuery();',
      '  const U = useUnits();',
      '  if (isLoading) return <Spinner />;',
      '  return <div>{U.unit}</div>;',
      '}',
    ].join('\n');
    expect(hooksBelowAGuard(fixed)).toEqual([]);

    // an `if` that does not return is not a guard — components branch constantly
    const branch = 'function C() {\n  if (a) { b(); }\n  const m = useMemo(() => 1, []);\n}';
    expect(hooksBelowAGuard(branch)).toEqual([]);

    // NOT a hook: a local callback that happens to start with "use", called
    // from inside JSX. The first matcher here read this as a violation.
    const jsx = 'function C() {\n  if (!x) return null;\n  return (\n  onClick={() => useOption(s)}\n  );\n}';
    expect(hooksBelowAGuard(jsx)).toEqual([]);
  });
});
