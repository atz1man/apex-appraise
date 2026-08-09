import type { ReactNode } from 'react';
import { brand } from '@apex/ui-tokens';

/**
 * A4 page chrome, in one place.
 *
 * This is the fourth document in the product and the first not to carry its own
 * copy of these forty lines. The constants below are not styling preferences —
 * each one is a bug that was found by measuring a rendered PDF:
 *
 *   1122, not 1123: chromium prints A4 at 1122.5px, and a page sized to the
 *   rounded-up height spills a blank sheet and desyncs every "Page n of N".
 *
 *   the :last-child rule: without it the final page-break emits a trailing blank
 *   sheet, so every PDF printed one page more than its footers claimed.
 *
 * Copies of that knowledge drift. AppraisalReport, RedBookReport and
 * TermsDocument still have their own and should move here — they are left alone
 * for now because they are verified working and a refactor of three live
 * documents does not belong in the same change as a new one.
 */

export const PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  body { background: #fff !important; }
  .no-print { display: none !important; }
  .a4-canvas { padding: 0 !important; gap: 0 !important; background: #fff !important; }
  .a4-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; page-break-after: always; break-after: page; }
  /* without this the final break emits a trailing blank sheet */
  .a4-page:last-child { page-break-after: auto !important; break-after: auto !important; }
}
`;

/** Usable content height inside a page, after padding, head and foot. */
export const PAGE_CONTENT_PX = 924;

export function A4Page({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return (
    <div
      className="a4-page bg-surface flex flex-col overflow-hidden"
      style={{
        width: 794,
        // 1122, not 1123 — see the note above
        minHeight: 1122,
        borderRadius: 3,
        boxShadow: '0 4px 24px rgba(20,30,25,0.12)',
        padding: pad ? '56px 60px' : 0,
      }}
    >
      {children}
    </div>
  );
}

export function PageHead({ title, scheme }: { title: string; scheme: string }) {
  return (
    <div className="flex items-center justify-between pb-3" style={{ borderBottom: `2px solid ${brand[700]}` }}>
      <span className="text-[15px] font-bold">{title}</span>
      <span className="fig text-[10px] font-medium text-ink-3">{scheme}</span>
    </div>
  );
}

export function PageFoot({
  no,
  total,
  refCode,
  firmName,
}: {
  no: number;
  total: number;
  refCode: string;
  firmName: string;
}) {
  return (
    <div className="mt-auto pt-3 flex items-center justify-between border-t border-border-std">
      <span className="text-[10px] text-ink-3">
        <b className="font-semibold text-brand-ink">{firmName}</b> · portfolio funding pack
      </span>
      <span className="fig text-[10px] text-ink-3">{refCode}</span>
      <span className="fig text-[10px] text-ink-3">
        Page {no} of {total}
      </span>
    </div>
  );
}
