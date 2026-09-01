/**
 * How the whole-codebase sweeps recognise a path by what it WRITES.
 *
 * Shared, because two sweeps ask "is this an approval path?" of the same
 * router — the benchmark feed and the approval pin — and a classifier written
 * twice is one edit away from meaning different things in each.
 *
 * Only the text INSIDE an update call is read, and only the value written to
 * `reviewStatus` is judged: a literal that is not "approved" is not an
 * approval; a variable might be. Two shapes a token-level match got wrong:
 * `restore` destructures `reviewStatus: _rs` OUT of a snapshot (not a write),
 * and a lookahead placed after `\s*` backtracked past itself and matched the
 * very `in_review` literal it was written to exclude. And the resolver source
 * read at run time has been through the transpiler, where every literal is
 * double-quoted — a classifier matching `'approved'` saw no approval path at
 * all and would have passed vacuously.
 */
const UPDATE_CALL = /prisma\.appraisal\.(?:update|updateMany)\(([\s\S]{0,800}?)\)\s*;/g;
const NOT_AN_APPROVAL = /^(?:["'](?:draft|in_review|changes_requested)["']|true|false)$/;

/** writes an appraisal row's reviewStatus to something that can be "approved" */
export const approves = (s: string): boolean =>
  [...s.matchAll(UPDATE_CALL)].some(([, call]) =>
    [...call!.matchAll(/reviewStatus:\s*([^,}\n]+)/g)].some(([, value]) => !NOT_AN_APPROVAL.test(value!.trim())),
  );

/** writes a deal's stage */
export const completes = (s: string): boolean => /prisma\.deal\.update\(/.test(s) && /\bstage:/.test(s);
