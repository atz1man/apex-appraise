/**
 * Which controls in this app fire a write, and whether each one says so.
 *
 * `Button writes` greys a control out for a view-only member before any effort
 * is spent on it, and `read-only.ts` is honest that the marking is per-site:
 * "a control nobody has marked yet degrades to layer 1 rather than to a
 * defect". True for the rule and false for the person: a view-only member
 * pressing an unmarked "Delete task" is asked to confirm a deletion, agrees,
 * and is then told they cannot. That is the sequence the whole read-only
 * branch was written to end.
 *
 * Measured, signed in as a VIEWER on the demo workspace and walking every
 * route: the pipeline's "Advance stage →" on every card, "Advance stage →" on
 * the deal overview, every "Remove" on comparables and scenarios, and every
 * "Complete task" and "Delete task" on the calendar were live. Not one was a
 * `Button` — the destructive ones are raw icon `<button>`s with their own
 * chrome, which `writes` cannot reach, so per-site marking had no site to go
 * to. `writeAttrs()` in `components/ui.tsx` is the same affordance as a spread.
 *
 * The matching is here rather than in the test because getting it wrong is the
 * interesting part, and two decisions are recorded in it:
 *
 *   - A control writes if its OWN attributes call `.mutate(`, OR if they name a
 *     handler declared in the same file whose body does. "Add comp" calls
 *     `addComp`, which calls `upsert.mutate` three lines up; a matcher that
 *     only read the tag reported the comparables screen clean.
 *   - A `<form>` is judged by its SUBMIT control, because the handler sits on
 *     the form and the person presses the button: the rule is that a form whose
 *     `onSubmit` writes contains a marked `type="submit"` control.
 */

import { VIEWER_MAY_RUN } from './read-only';

/**
 * The indent is captured as spaces and tabs, NOT `\s*`: under the multiline
 * flag `\s*` swallows the blank line above a declaration, the declaration's
 * "indent" becomes newline-plus-two, and the body scan below ends on the
 * declaration line itself — so `addComp` read as a handler with no body and
 * "Add comp" was reported clean. Found because the viewer walk still listed it.
 */
const HANDLER_DECL = /^([ \t]*)(?:const|let)\s+(\w+)\s*=\s*(?:useCallback\()?\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|^([ \t]*)(?:async\s+)?function\s+(\w+)\s*\(/gm;
const CALLS_MUTATE = /\.mutate(?:Async)?\(/;
const MUTATION_BINDING = /const\s+(\w+)\s*=\s*trpc\.([a-zA-Z]+\.[a-zA-Z]+)\.useMutation/g;

/**
 * Routers whose principal is never a member of the firm. A buyer signing a
 * reservation is not a view-only member and never can be — `isViewOnly` asks
 * for `principalType === 'internal'` — so greying those controls out would be
 * marking for its own sake.
 */
const PORTAL_ROUTERS = ['buyer'];

export type Tag = 'Button' | 'button' | 'input' | 'select' | 'textarea' | 'form';
export type WriteControl = { file: string; line: number; tag: Tag; via: string; procedures: string[]; marked: boolean; exempt: boolean };

/** A write a view-only member is allowed, so a control firing it need not be greyed out. */
export const exemptProcedure = (p: string): boolean =>
  (VIEWER_MAY_RUN as readonly string[]).includes(p) || PORTAL_ROUTERS.some((r) => p.startsWith(`${r}.`));

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** the opening tag ends at the first `>` outside braces — `onClick={() => …}` holds one inside */
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

/**
 * Handlers declared in this file whose bodies call a mutation. A body runs
 * from its declaration to the next declaration at the same or a shallower
 * indent, which is what the source's own layout says it is — this repo is
 * prettier-formatted, and a resolver that reads braces has to be a parser.
 */
export function mutatingHandlers(src: string): Map<string, string> {
  const decls: Array<{ name: string; indent: number; at: number }> = [];
  for (const m of src.matchAll(HANDLER_DECL)) {
    decls.push({ name: m[2] ?? m[4], indent: (m[1] ?? m[3]).length, at: m.index! });
  }
  const lines = src.split('\n');
  const found = new Map<string, string>();
  decls.forEach((d) => {
    const startLine = src.slice(0, d.at).split('\n').length - 1;
    let end = lines.length;
    for (let i = startLine + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') continue;
      const indent = l.length - l.trimStart().length;
      if (indent <= d.indent && /^\s*(?:const|let|function|async function|return|<|\}|\)|export)/.test(l)) { end = i; break; }
    }
    const body = lines.slice(startLine, end).join('\n');
    if (CALLS_MUTATE.test(body)) found.set(d.name, body);
  });
  return found;
}

/**
 * Which procedures a piece of handler text fires. A binding is the NEAREST
 * `const x = trpc.a.b.useMutation` above the call — `settings-integrations.tsx`
 * binds `remove` twice, which is the lesson `destructive.ts` records.
 */
function proceduresOf(src: string, at: number, text: string): string[] {
  const binds = [...src.matchAll(MUTATION_BINDING)].map((m) => ({ variable: m[1], procedure: m[2], at: m.index! }));
  const out = new Set<string>();
  for (const m of text.matchAll(/(\w+)\.mutate(?:Async)?\(/g)) {
    const candidates = binds.filter((b) => b.variable === m[1] && b.at <= at);
    const bind = candidates[candidates.length - 1];
    out.add(bind ? bind.procedure : `?.${m[1]}`);
  }
  return [...out];
}

/** Does this attribute text fire a write — directly, or through a handler that does? */
function writesVia(attrs: string, handlers: Map<string, string>): { via: string; text: string } | null {
  if (CALLS_MUTATE.test(attrs)) return { via: attrs.match(/(\w+)\.mutate(?:Async)?\(/)![0], text: attrs };
  for (const [h, body] of handlers) {
    if (new RegExp(`\\bon\\w+=\\{[^}]*\\b${h}\\b`).test(attrs) || new RegExp(`\\bon\\w+=\\{${h}\\}`).test(attrs)) return { via: h, text: body };
  }
  return null;
}

/** Every control that writes in one source file, and whether it is marked. */
export function writeControls(file: string, source: string): WriteControl[] {
  const src = stripComments(source);
  const handlers = mutatingHandlers(src);
  const out: WriteControl[] = [];
  const re = /<(Button|button|input|select|textarea|form)\b/g;
  for (const m of src.matchAll(re)) {
    const tag = m[1] as Tag;
    const end = openTagEnd(src, m.index! + m[0].length);
    if (end < 0) continue;
    const attrs = src.slice(m.index! + m[0].length, end);
    const line = src.slice(0, m.index).split('\n').length;
    const hit = writesVia(attrs, handlers);
    if (!hit) continue;
    const procedures = proceduresOf(src, m.index!, hit.text);
    const exempt = procedures.length > 0 && procedures.every(exemptProcedure);
    let marked: boolean;
    if (tag === 'Button') marked = /(?:^|\s)writes(?:\s|=|$)/.test(attrs);
    else if (tag === 'form') {
      const close = src.indexOf('</form>', end);
      const inner = src.slice(end, close < 0 ? undefined : close);
      marked = /<Button\b[^]*?type="submit"[^]*?>/.test(inner) && [...inner.matchAll(/<(Button|button)\b/g)].some((b) => {
        const e2 = openTagEnd(inner, b.index! + b[0].length);
        const a2 = inner.slice(b.index! + b[0].length, e2);
        return /type="submit"/.test(a2) && (b[1] === 'Button' ? /(?:^|\s)writes(?:\s|=|$)/.test(a2) : /writeAttrs\(/.test(a2));
      });
    } else marked = /writeAttrs\(/.test(attrs);
    out.push({ file, line, tag, via: hit.via, procedures, marked, exempt });
  }
  return out;
}
