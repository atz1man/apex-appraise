import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A screen that KNOWS its work is unsaved says so before the tab closes.
 *
 * Measured before `useUnsavedWarning` existed: `beforeunload` appeared nowhere
 * in the source, and neither did any navigation blocker. Three screens track a
 * `dirty` flag and each PRINTS it — a button reading "Save appraisal" rather
 * than "Saved" — so the information was there, on screen, and no use was made
 * of it when the work was about to be thrown away.
 *
 * The rule keys on a TRACKED dirty flag — `const [dirty, setDirty] =
 * useState(...)` — rather than on any variable called `dirty`, and that is a
 * distinction rather than an exemption. Tracked state means edits accumulating
 * over time in a component and nowhere else: the appraisal's financial inputs,
 * the Market Value opinion, the terms a client signs. Settings derives a
 * `dirty` by comparing one text field to the saved organisation name, which is
 * not work — and it is computed below that panel's loading return, where a
 * hook could not go anyway.
 */

const WEB_SRC = join(__dirname, '..');
const TRACKED_DIRTY = /const\s+\[\s*dirty\s*,\s*set\w*\s*\]\s*=\s*useState/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.tsx') && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const screensTrackingUnsavedWork = () =>
  sources(WEB_SRC)
    .map((f) => ({ file: f.replace(`${WEB_SRC}/`, ''), src: readFileSync(f, 'utf8') }))
    .filter(({ src }) => TRACKED_DIRTY.test(src));

describe('screens holding unsaved work', () => {
  it('all warn before the tab closes on it', () => {
    const silent = screensTrackingUnsavedWork()
      .filter(({ src }) => !src.includes('useUnsavedWarning('))
      .map(({ file }) => file);
    expect(
      silent,
      'these track unsaved edits and would let the tab close on them without a word',
    ).toEqual([]);
  });

  /**
   * A sweep over an empty file list passes in silence. This says it is reading
   * the real tree, and names the three screens it is actually about — the
   * financial inputs behind a residual, the Market Value opinion that goes on
   * to the Red Book, and the terms a client will sign.
   */
  it('finds the screens it is meant to be checking', () => {
    const files = screensTrackingUnsavedWork().map((s) => s.file);
    expect(files).toEqual(
      expect.arrayContaining(['routes/DevelopmentAppraisal.tsx', 'routes/Workbench.tsx', 'routes/Engagement.tsx']),
    );
  });

  /**
   * And that it is keying on TRACKED state. A derived comparison is not work
   * accumulating in a component, and a rule that swept those in would need an
   * exemption list — which is how a rule stops meaning anything.
   */
  it('does not sweep in a derived dirty flag', () => {
    expect(TRACKED_DIRTY.test("const dirty = draft.trim() !== org.name;")).toBe(false);
    expect(TRACKED_DIRTY.test("const [dirty, setDirty] = useState(false);")).toBe(true);
  });
});
