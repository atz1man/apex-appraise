/**
 * What a Red Book report may say about its own certainty.
 *
 * Two claims on the valuation certificate depend entirely on there being
 * comparable evidence, and both used to be made whether there was any or not:
 *
 * - an **indicated value range**, printed identically whether it came from the
 *   comparables' own spread or from a flat ±2.5% of GDV that nothing supports;
 * - a **confidence grade** — "assessed as medium under the RICS confidence
 *   framework" — asserted with zero comparables on file.
 *
 * `238d265` fixed this file's sibling defect, where the narrative declared "the
 * evidence base of 1 comparable is considered adequate for the class" on any
 * count above zero. This is the same claim-without-support one panel over.
 *
 * The fix is to withhold the claim, not to invent a better one. How wide the
 * band should be where there is no market evidence, and which grade the RICS
 * framework gives that case, are a valuer's judgements — so this says the
 * evidence is absent and leaves the number to somebody qualified to give it.
 */

import { toNearestThousand } from '@apex/appraisal-engine';

export interface EvidenceBasedRange {
  /** null when no comparable evidence supports a range */
  range: { lo: number; hi: number } | null;
  /** where the opinion sits in the range, 5–95. null when there is no range. */
  marker: number | null;
  /** null when the framework has no evidence to grade */
  confidence: 'High' | 'Medium' | 'Low' | null;
  /** what the certificate says instead of a grade, when it has none */
  note: string;
}

export function valuationConfidence(input: {
  marketValue: number;
  /** the comparables' own supported range, £/ft², when there are comparables */
  compRange: { lo: number; hi: number } | null;
  netInternalArea: number;
  /** mean gross adjustment applied across the comparables, percentage points */
  avgGrossAdjustment: number;
  compCount: number;
}): EvidenceBasedRange {
  const { marketValue, compRange, netInternalArea, avgGrossAdjustment, compCount } = input;

  if (compCount === 0 || !compRange || netInternalArea <= 0) {
    /**
     * No evidence, so no range and no grade. The ±2.5% band this replaced was
     * indistinguishable on the page from one the comparables had produced,
     * which is the part that mattered: a reader cannot discount a figure they
     * cannot tell apart from a supported one.
     */
    return {
      range: null,
      marker: null,
      confidence: null,
      note: 'Not assessed — no comparable evidence is held for this property. A confidence grade under the RICS framework requires market evidence, and the opinion above rests on the development appraisal alone.',
    };
  }

  const range = { lo: toNearestThousand(compRange.lo * netInternalArea), hi: toNearestThousand(compRange.hi * netInternalArea) };
  const confidence = avgGrossAdjustment < 8 ? 'High' : avgGrossAdjustment < 15 ? 'Medium' : 'Low';
  return {
    range,
    marker:
      range.hi > range.lo
        ? Math.min(95, Math.max(5, ((marketValue - range.lo) / (range.hi - range.lo)) * 100))
        : 50,
    confidence,
    note: `Valuation confidence assessed as ${confidence.toLowerCase()} under the RICS confidence framework, on ${compCount} comparable ${compCount === 1 ? 'sale' : 'sales'} with average gross adjustment of ${avgGrossAdjustment.toFixed(1)}%.`,
  };
}
