import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * When this app tells somebody something went wrong, it is audible.
 *
 * Measured across the whole browser tree before this: `role="alert"`,
 * `aria-invalid` and `aria-describedby` appeared in ZERO files. Seventeen
 * places render a refusal in red beside the control that caused it, and to
 * anyone not looking at that spot the app did nothing at all.
 *
 * The sharper half is that nineteen mutations declare `meta: { inlineError:
 * true }`, which SUPPRESSES the toast on the explicit grounds that "the screen
 * shows the error where it happened" — see the mutation cache in `App.tsx`.
 * It showed it in a colour. So for those nineteen the red line was not a second
 * channel, it was the only one.
 *
 * The rule: a message rendered in the error colour from an EXPRESSION — a
 * server message, a validation string, a caught upload failure — goes through
 * `FormError`, which carries `role="alert"`. Literal red text is not swept in:
 * a "Danger zone" heading and an overdue condition in a table are labels, not
 * events, and announcing them on render would be noise.
 */

const WEB_SRC = join(__dirname, '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.tsx') && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * A `<div>` in the error colour whose whole content is an interpolated
 * expression. That shape is a message that appeared BECAUSE something
 * happened, which is exactly what has to be announced.
 */
const SILENT_ERROR = /<div[^>]*className="[^"]*\btext-status-red\b[^"]*"[^>]*>\{[^}]+\}<\/div>/g;

/**
 * Comments go first, and that is not defensive tidying — this file tripped on
 * it. `Toast.tsx` explains in prose why a per-toast `role="status"` did not
 * work, and the assertion that no such attribute remains matched the
 * explanation. `route-reachable.test.ts` learned the same thing from a comment
 * that spelled a route: a rule whose only evidence is prose ABOUT the rule is
 * looking at the wrong text.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function silentErrors(file: string, src: string): string[] {
  const out: string[] = [];
  stripComments(src).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(SILENT_ERROR)) {
      if (m[0].includes('role="alert"')) continue;
      out.push(`${file}:${i + 1}`);
    }
  });
  return out;
}

describe('error messages', () => {
  it('are announced, not merely coloured', () => {
    const silent = sources(WEB_SRC).flatMap((f) => silentErrors(f.replace(`${WEB_SRC}/`, ''), readFileSync(f, 'utf8')));
    expect(
      silent,
      `these render a refusal in red with nothing to announce it — use FormError:\n  ${silent.join('\n  ')}`,
    ).toEqual([]);
  });

  it('recognises one that is not announced', () => {
    expect(silentErrors('x.tsx', '  <div className="mt-2 text-[12px] text-status-red">{err.message}</div>\n')).toHaveLength(1);
  });

  it('accepts one that carries its own role', () => {
    expect(silentErrors('x.tsx', '  <div role="alert" className="text-status-red">{err.message}</div>\n')).toEqual([]);
  });

  /**
   * And does not sweep in red text that is a LABEL rather than an event. The
   * "Danger zone" heading and an overdue condition in a table are permanently
   * on screen; announcing them on render would train people to ignore the
   * channel, which is the failure mode this whole rule exists to avoid.
   */
  it('leaves literal red text alone', () => {
    expect(silentErrors('x.tsx', '  <div className="text-[13.5px] font-semibold text-status-red">Danger zone</div>\n')).toEqual([]);
  });
});

describe('the announcing primitives', () => {
  const ui = () => readFileSync(join(WEB_SRC, 'components', 'ui.tsx'), 'utf8');

  it('put the alert role in FormError, so the sweep above guards something real', () => {
    expect(stripComments(ui())).toMatch(/export function FormError[\s\S]{0,600}role="alert"/);
  });

  /**
   * The toast regions are the product's whole feedback channel and must be in
   * the document BEFORE a message arrives — a live region inserted along with
   * its own text is the documented way not to be announced. So the assertion is
   * that the `aria-live` containers are rendered unconditionally, outside the
   * `.map` that fills them.
   */
  it('keep the toast live regions mounted, empty, from the start', () => {
    const toast = stripComments(readFileSync(join(WEB_SRC, 'components', 'Toast.tsx'), 'utf8'));
    expect(toast).toMatch(/aria-live="assertive"[\s\S]{0,200}\.map\(card\)/);
    expect(toast).toMatch(/aria-live="polite"[\s\S]{0,200}\.map\(card\)/);
    // and no per-toast region, which is the shape that did not work
    expect(toast).not.toMatch(/role="status"/);
  });
});
