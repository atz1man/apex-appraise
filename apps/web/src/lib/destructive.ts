/**
 * Which controls in this app destroy something, and how they ask first.
 *
 * The matching is here rather than in the test beside it because getting it
 * wrong is the interesting part: a first pass looked for `confirm(` near the
 * call and reported EIGHT unguarded controls, of which four were guarded — by
 * the two patterns this product uses that are not `window.confirm`. A matcher
 * that finds what it was written to look for and calls the rest offenders is
 * worse than no matcher, because somebody will act on its list.
 */

/** A mutation whose whole job is to destroy a record. */
export const DESTRUCTIVE_BINDING =
  /const\s+(\w+)\s*=\s*trpc\.([a-zA-Z]+\.(?:remove|delete)[A-Za-z]*)\.useMutation/g;

export type Site = { file: string; line: number; procedure: string; gate: Gate };
export type Gate = 'confirm' | 'arm' | 'typed-name' | 'none';

/**
 * The three ways this product asks before it destroys, all of them already in
 * use before this file existed:
 *
 *   confirm      `window.confirm` in the handler. What the ROW-level controls
 *                use — a comparable, a task, a photo, a unit.
 *   arm          the control appears only after another one arms it, with a
 *                Cancel beside it. What the PANEL-level ones use — removing a
 *                member, an investor, a contractor.
 *   typed-name   the name of the thing typed back before the control will fire.
 *                Used once, for deleting the workspace, which is right: it is
 *                the only control that ends everything at once.
 *
 * Recognising all three is the point. Recognising only the first is how four
 * properly-guarded controls get reported as defects.
 */
export function gateFor(lines: string[], i: number): Gate {
  const handler = lines.slice(Math.max(0, i - 14), i + 2).join('\n');
  const after = lines.slice(i, i + 5).join('\n');
  // `confirm` is tested FIRST because the row-level sites write it as
  // `if (confirm(…)) x.mutate(…)` on one line, which the typed-name rule below
  // also matches — and reporting six of them as typed-name gates would have
  // made this file's own output a fiction while its total stayed right
  if (/\bconfirm\(/.test(handler)) return 'confirm';
  // a guard and the call in one statement: `if (typed === name) x.mutate(…)`
  if (/\bif\s*\(.+\)\s*\w+\.mutate\(/.test(lines[i])) return 'typed-name';
  if (/>\s*Cancel\s*</.test(after)) return 'arm';
  return 'none';
}

/** Every destructive control in one source file, and how each asks. */
export function destructiveSites(file: string, src: string): Site[] {
  /**
   * Bindings carry the line they were declared on, and a call site takes the
   * NEAREST one above it. `settings-integrations.tsx` binds `remove` twice —
   * once in the webhooks panel and once in the SSO panel — and a plain
   * name→procedure map let the second overwrite the first, so a webhook
   * endpoint was reported as an SSO configuration. The count was right and the
   * label was a lie, which is the worse of the two failures: somebody reads the
   * label.
   */
  const binds: Array<{ variable: string; procedure: string; at: number }> = [];
  for (const m of src.matchAll(DESTRUCTIVE_BINDING)) {
    binds.push({ variable: m[1], procedure: m[2], at: src.slice(0, m.index).split('\n').length });
  }
  if (binds.length === 0) return [];
  const lines = src.split('\n');
  const out: Site[] = [];
  lines.forEach((line, i) => {
    const candidates = binds.filter((b) => new RegExp(`\\b${b.variable}\\.mutate\\(`).test(line) && b.at <= i + 1);
    const bind = candidates[candidates.length - 1];
    if (!bind) return;
    out.push({ file, line: i + 1, procedure: bind.procedure, gate: gateFor(lines, i) });
  });
  return out;
}
