import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldInterceptNavigation, unsavedMessage } from './unsaved';

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

/**
 * The click decision, at its boundaries.
 *
 * Every `false` here is a click that does NOT take the person off the screen,
 * so interrupting them would be a prompt for nothing — and a product that
 * prompts for nothing is one whose prompts get dismissed unread. That failure
 * mode is worse than the defect this whole file exists to fix, because it
 * disarms the prompt on the occasion that matters.
 */
const click = (over: Partial<Parameters<typeof shouldInterceptNavigation>[0]> = {}) =>
  shouldInterceptNavigation({
    dirty: true,
    button: 0,
    modifier: false,
    defaultPrevented: false,
    href: '/board',
    target: null,
    download: false,
    currentPath: '/deal/d1/appraisal',
    ...over,
  });

describe('shouldInterceptNavigation', () => {
  it('stops a plain left-click on an in-app link while work is unsaved', () => {
    expect(click()).toBe(true);
  });

  it('lets everything through when nothing is unsaved', () => {
    expect(click({ dirty: false })).toBe(false);
  });

  /** A new tab leaves this one — and its unsaved work — exactly where it is. */
  it('leaves a middle-click or a modified click alone', () => {
    expect(click({ button: 1 })).toBe(false);
    expect(click({ button: 2 })).toBe(false);
    expect(click({ modifier: true })).toBe(false);
  });

  it('does not fight a handler that has already cancelled the click', () => {
    expect(click({ defaultPrevented: true })).toBe(false);
  });

  it('ignores a click that is not on a link at all', () => {
    expect(click({ href: null })).toBe(false);
  });

  /**
   * An absolute URL is leaving the application, where `beforeunload` takes
   * over and gives the browser's own prompt. Two prompts for one departure is
   * worse than one.
   */
  it('leaves an external link to beforeunload', () => {
    expect(click({ href: 'https://example.com' })).toBe(false);
    expect(click({ href: 'mailto:someone@example.com' })).toBe(false);
  });

  /** The skip link — `#page` — moves focus and changes no route. */
  it('does not prompt on a fragment link', () => {
    expect(click({ href: '#page' })).toBe(false);
  });

  it('does not prompt on a new-tab link or a download', () => {
    expect(click({ target: '_blank' })).toBe(false);
    expect(click({ download: true })).toBe(false);
    // `_self` is the default written out, and does navigate here
    expect(click({ target: '_self' })).toBe(true);
  });

  it('does not prompt for the screen you are already on', () => {
    expect(click({ href: '/deal/d1/appraisal' })).toBe(false);
  });
});

describe('unsavedMessage', () => {
  /**
   * The sentence names the work. "Your changes" would be true of every screen
   * and useful on none — somebody deciding whether to throw away half an hour
   * should be told half an hour of what.
   */
  it('names what is at stake', () => {
    expect(unsavedMessage('this appraisal')).toContain('this appraisal');
    expect(unsavedMessage('these terms of engagement')).toContain('these terms of engagement');
  });
});
