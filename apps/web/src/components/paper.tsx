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

/**
 * `padding` is a parameter, not a constant, and deliberately so. The documents do
 * not agree: the appraisal report and funding pack use 56/60, the Red Book and
 * terms of engagement 54/64. Standardising them here would re-wrap two documents
 * and quietly move every page break in them — which, for a valuation and a signed
 * engagement letter, is not a cosmetic change.
 */
export function A4Page({
  children,
  pad = true,
  padding = '56px 60px',
}: {
  children: ReactNode;
  pad?: boolean;
  padding?: string;
}) {
  return (
    <div
      className="a4-page bg-surface flex flex-col overflow-hidden"
      style={{
        width: 794,
        // 1122, not 1123 — see the note above
        minHeight: 1122,
        borderRadius: 3,
        boxShadow: '0 4px 24px rgba(20,30,25,0.12)',
        padding: pad ? padding : 0,
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

/**
 * Dates on a printed document — in the firm's time, never the reader's.
 *
 * `toLocaleDateString` without a zone formats in whatever timezone the browser
 * is in. Measured: a terms of engagement whose valuation date the valuer typed
 * as 30 June 2026 renders as **29 June 2026** to a client opening the same
 * document from New York, because a date input stores UTC midnight and any
 * negative offset lands on the day before.
 *
 * The buyer and investor portals and the terms-signing link are built for people
 * outside the firm, so a reader abroad is the ordinary case, not the exotic one.
 * This is the same rule these documents already follow for colour: a signed
 * valuation must not change because of a setting on the reader's machine. Dates
 * matter more than colour — a valuation date is what the opinion is "as at", and
 * an inspection date is a statement about a day somebody attended a property.
 *
 * Europe/London rather than UTC because the figures, the conventions and the
 * regulator are all UK (see CLAUDE.md) — a report produced at 00:30 BST on the
 * 5th is dated the 5th, which is the day the valuer would say they produced it.
 */
export const DOC_TIMEZONE = 'Europe/London';

const docDateFmt = (opts: Intl.DateTimeFormatOptions) => (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { ...opts, timeZone: DOC_TIMEZONE });

/** 30 June 2026 — the long form every document uses for a date it asserts. */
export const docDate = docDateFmt({ day: 'numeric', month: 'long', year: 'numeric' });

/** 30 Jun — for dense tables and exhibit captions. */
export const docDay = docDateFmt({ day: 'numeric', month: 'short' });
