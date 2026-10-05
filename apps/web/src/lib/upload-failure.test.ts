import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * An upload that fails says so.
 *
 * tRPC mutations get this for free — the link chain toasts a rejection, and
 * `announcements` made sure the toast is in a live region — but the four places
 * this app POSTs a FILE are raw `fetch` calls, outside that chain entirely. Three
 * of them reported a failure: the data room threw on a non-ok status and caught it
 * into a `FormError`, the logo upload read the server's message, and the field
 * app's shutter leaves the shot marked failed with a Retry.
 *
 * The fourth did not. The cost monitor's site-photo upload was
 *
 *     if (res.ok) { setPhotoCap(''); utils.photos.list.invalidate(dealId); }
 *
 * with no else: the spinner stopped, the caption stayed in the box, no photograph
 * appeared, and nothing said why — so a surveyor on a phone with a dropped
 * connection could not tell a refused upload from a slow one. That route's own
 * comment calls the site log "what a disputed valuation of works-in-progress is
 * argued from". Three siblings getting it right is what makes the fourth an
 * omission rather than a decision, which is the same argument `destructive` makes
 * about its four unguarded controls.
 *
 * NOT PROVEN, and said here rather than left to look thorough: that the message
 * REACHES somebody. This checks the non-ok path is handled at all — the shape the
 * cost monitor was missing — and a `throw` into a `catch` that swallows would pass
 * it. What makes the channel audible is the toast live regions mounted at startup,
 * which `announcements` covers; what makes it correct for a given site is reading
 * the site.
 */

const WEB_SRC = join(__dirname, '..');

const sources = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
};

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');

/**
 * Every raw upload, as `{file, line, handled}`.
 *
 * The window is the 600 characters of CONTENT after the fetch, not the whole
 * function: a file's other uploads would otherwise excuse each other, and all
 * four of these sites act on the response within a dozen lines.
 *
 * Content, because a raw character count is a guess about how far away the
 * handling is. Comments are blanked rather than removed so the reported line
 * numbers stay true, and the first version then measured those blanks — the
 * paragraph explaining the cost monitor's fix sat between its fetch and its
 * `if (!res.ok)` and pushed the check out of the window, so the sweep reported
 * the very site that had just been fixed. `provenance-sweep`'s helper window was
 * the same mistake with a different number. Whitespace runs are collapsed before
 * the slice; the line number comes from the untouched offset.
 */
export function uploadSites(file: string, src: string): Array<{ file: string; line: number; handled: boolean }> {
  const t = stripComments(src);
  const out: Array<{ file: string; line: number; handled: boolean }> = [];
  for (const m of t.matchAll(/fetch\(\s*['"`]\/uploads\/[^'"`]*['"`]/g)) {
    const after = t.slice(m.index!).replace(/\s+/g, ' ').slice(0, 600);
    out.push({
      file,
      line: t.slice(0, m.index!).split('\n').length,
      // the non-ok path, by any of the three shapes this app uses
      handled: /if\s*\(\s*!\s*res\.ok\s*\)/.test(after) || /res\.ok\s*\?/.test(after) || /!response\.ok/.test(after),
    });
  }
  return out;
}

const allSites = () => sources(WEB_SRC).flatMap((f) => uploadSites(f.replace(`${WEB_SRC}/`, ''), readFileSync(f, 'utf8')));

describe('every file upload reports a failure', () => {
  it('finds the raw uploads, from the real tree', () => {
    const sites = allSites();
    expect(sites.length, 'no raw upload was found — the matcher is broken').toBeGreaterThanOrEqual(4);
    expect(sites.map((s) => s.file)).toContain('routes/CostMonitoring.tsx');
    expect(sites.map((s) => s.file)).toContain('routes/DataRoom.tsx');
  });

  it('handles the non-ok path at every one of them', () => {
    const silent = allSites().filter((s) => !s.handled).map((s) => `${s.file}:${s.line}`);
    expect(
      silent,
      'these POST a file and act only on success, so a refused upload stops the spinner and says nothing. '
        + `Throw on a non-ok status and show it — the other upload sites do.\n  ${silent.join('\n  ')}`,
    ).toEqual([]);
  });

  describe('the matcher itself', () => {
    it('reports an upload that acts only on success', () => {
      const src = "const res = await fetch('/uploads/photo', { method: 'POST' });\nif (res.ok) { done(); }";
      expect(uploadSites('x.tsx', src)[0]!.handled).toBe(false);
    });

    it('accepts each shape this app uses to handle one', () => {
      const thrown = "await fetch('/uploads/document', {});\nif (!res.ok) throw new Error('nope');";
      expect(uploadSites('x.tsx', thrown)[0]!.handled).toBe(true);
      const ternary = "await fetch('/uploads/logo', {});\nconst msg = res.ok ? 'done' : 'failed';";
      expect(uploadSites('x.tsx', ternary)[0]!.handled).toBe(true);
    });

    /**
     * A long comment between the fetch and the check does not hide the check.
     * This is the case the sweep failed on its first run, against the fix it was
     * written for.
     */
    it('measures content, not characters, so a comment cannot push the check out of range', () => {
      const prose = '*'.repeat(900);
      const src = `await fetch('/uploads/photo', {});\n/* ${prose} */\nif (!res.ok) throw new Error('nope');`;
      expect(uploadSites('x.tsx', src)[0]!.handled, 'a comment hid the handling').toBe(true);
    });

    it('does not read a comment about an upload as an upload', () => {
      const prose = "/* it was fetch('/uploads/photo') with no else */\nconst x = 1;";
      expect(uploadSites('x.tsx', prose)).toEqual([]);
    });

    /** A tRPC mutation is not one of these: the link chain already reports it. */
    it('ignores an ordinary fetch that is not an upload', () => {
      expect(uploadSites('x.tsx', "await fetch('/trpc/deals.create', {});")).toEqual([]);
    });
  });
});
