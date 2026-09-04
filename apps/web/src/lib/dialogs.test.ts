import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every overlay is a dialog, and says so.
 *
 * Measured across the five this app renders: ONE — the marketing page's product
 * tour — declared `role="dialog"`. The primitive the product itself uses,
 * `Drawer`, declared none of it and managed no focus at all, and six screens
 * open one. The payment dialog had no Escape either.
 *
 * An overlay that does not declare itself is not announced when it opens, and
 * everything underneath it stays in the accessibility tree — so a screen reader
 * user is reading a page that is, to everyone else, greyed out behind a
 * backdrop and unusable.
 *
 * `role="dialog"` is the claim; `useDialog` in `components/ui.tsx` is what
 * makes it true. This sweep checks the claim, because it is the half a static
 * matcher can see, and `e2e/dialogs.spec.ts` presses Tab.
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
 * An overlay is a full-viewport fixed element carrying a backdrop — that is
 * what makes it modal in fact, whatever it claims in markup. Matched on
 * `fixed inset-0` plus either a backdrop colour or a click-to-dismiss, so a
 * `fixed inset-0` used for a full-bleed layout (the field app's camera view) is
 * not dragged in.
 */
function undeclaredOverlays(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!/className="[^"]*\bfixed inset-0\b/.test(line)) return;
    // the element and what follows it — the dialog panel is the child, and the
    // role sits on the panel rather than on the backdrop, which is correct
    const block = lines.slice(i, i + 22).join('\n');
    const isModal = /background: 'rgba\(/.test(block) || /onClick=\{onClose\}/.test(block) || /onClick=\{\(\) =>/.test(block);
    if (!isModal) return;
    if (/role="dialog"/.test(block) && /aria-modal="true"/.test(block)) return;
    out.push(`${file.replace(WEB_SRC, 'src')}:${i + 1}`);
  });
  return out;
}

describe('overlays', () => {
  it('declare themselves as modal dialogs', () => {
    const offenders = sources(WEB_SRC).flatMap(undeclaredOverlays);
    expect(
      offenders,
      `an overlay that does not declare role="dialog" and aria-modal is not announced when it opens, and everything behind the backdrop stays readable to a screen reader:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The sweep passes over an empty file list in silence. These two say it can
   * still tell the two cases apart — which is the whole question, because the
   * naive matcher reported the field app's full-bleed camera view, and an
   * exemption list is how a rule stops meaning anything.
   */
  it('recognises an overlay that has not declared itself', () => {
    const tmp = join(WEB_SRC, 'lib', '__overlay-fixture.tsx');
    const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(
      tmp,
      [
        'export function Sheet({ onClose }: { onClose: () => void }) {',
        '  return (',
        `    <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>`,
        '      <div className="p-5">hello</div>',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n'),
    );
    try {
      expect(undeclaredOverlays(tmp)).toHaveLength(1);
    } finally {
      rmSync(tmp);
    }
  });

  it('does not report a full-bleed layout that is not a dialog', () => {
    const tmp = join(WEB_SRC, 'lib', '__layout-fixture.tsx');
    const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(
      tmp,
      [
        'export function Camera() {',
        '  return (',
        '    <div className="fixed inset-0 bg-canvas flex flex-col overflow-hidden">',
        '      <video />',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n'),
    );
    try {
      expect(undeclaredOverlays(tmp)).toEqual([]);
    } finally {
      rmSync(tmp);
    }
  });
});
