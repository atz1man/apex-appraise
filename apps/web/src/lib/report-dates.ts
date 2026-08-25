import { docDate } from '../components/paper';

/**
 * The dates a valuation report carries.
 *
 * All three of these were `new Date()` — the moment the file was opened. So a
 * Red Book report stated an **inspection date** for a property nobody had
 * attended, a **valuation date** that contradicted the terms of engagement the
 * client had signed, and a **signature date** that moved every time anyone
 * looked at it. Measured on the demo workspace: the accepted terms state
 * 30 June 2026 and the report printed 25 August 2026 in all three places, with
 * no inspection on file at all.
 *
 * This is the same rule the page already applies to the valuer's name, in its
 * own words: "an unsigned valuation is a fixable state and a falsely signed one
 * is not." A missing inspection date is fixable — somebody goes and inspects.
 * An invented one is a statement about a day a professional attended a
 * property, in a document carrying professional indemnity.
 */
export interface ReportDateSources {
  appraisal?: {
    updatedAt: Date | string;
    reviewStatus?: string | null;
    reviewedAt?: Date | string | null;
  } | null;
  terms?: { valuationDate?: Date | string | null } | null;
  inspection?: { inspectedAt: Date | string } | null;
  /** injectable so a test does not depend on the day it runs */
  now?: Date;
}

export interface ReportDates {
  /**
   * The date of the report, which is also the date under the signature.
   *
   * The version that was signed off, when one was — a signed valuation is dated
   * when it was signed, not when it is read. Failing that, the version's own
   * last save: the report is a rendering of those figures and nothing has
   * happened to it since. Printing the same document twice must give the same
   * document.
   */
  report: string;
  /** What the opinion is "as at" (RICS VPS 3). */
  valuation: string;
  /** The day somebody attended, or null when nobody has. */
  inspection: string | null;
  /** true when the report date is a real sign-off rather than a last save */
  signedOff: boolean;
}

export function reportDates(src: ReportDateSources): ReportDates {
  const approved = src.appraisal?.reviewStatus === 'approved' && !!src.appraisal.reviewedAt;
  const reportOn = approved
    ? src.appraisal!.reviewedAt!
    : src.appraisal?.updatedAt ?? src.now ?? new Date();
  const report = docDate(reportOn);
  return {
    report,
    /**
     * The terms when they state one. Where they do not, the terms themselves
     * say what happens — "The date of the report, unless otherwise agreed in
     * writing" — so the fallback is the firm's own printed rule rather than a
     * new one invented here.
     */
    valuation: src.terms?.valuationDate ? docDate(src.terms.valuationDate) : report,
    inspection: src.inspection?.inspectedAt ? docDate(src.inspection.inspectedAt) : null,
    signedOff: approved,
  };
}
