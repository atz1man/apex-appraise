/**
 * Portfolio exposure.
 *
 * The developer's question is "is this deal any good?". The lender's is a
 * different one: "how much of my book is riding on one borrower, one asset class,
 * one town?" — and no amount of per-deal appraisal answers it. Concentration is
 * what turns a book of individually sound loans into a bad year.
 *
 * Everything here is arithmetic over figures the engine has already produced. It
 * introduces no new financial model: a portfolio total that disagreed with the
 * deals it sums would be worse than no total at all.
 */

import type { DrawdownResult } from './drawdown.js';
import type { CovenantResult } from './covenants.js';

export interface ExposurePosition {
  dealId: string;
  name: string;
  /** INDUSTRIAL | RESIDENTIAL | COMMERCIAL | MIXED_USE */
  assetType: string;
  /** UK postcode area — "BH", "SW1" collapses to "SW" */
  region: string;
  stage: string;
  gdv: number;
  totalCost: number;
  /** peak debt: the most the facility is ever asked to carry */
  facility: number;
  equity: number;
  /** committed spend to date, or actual drawdowns once a bank feed exists */
  drawn: number;
  /** which of those it is — the pack states it rather than implying confidence */
  drawnSource?: 'bank' | 'committed';
  /** money actually out of the account, where known */
  paid?: number;
  invoicedUnpaid?: number;
  paidUnbilled?: number;
  /** money in that nobody has classified yet */
  unclassifiedIn?: number;
  /**
   * How that spend compares with the works done. Optional because a deal with no
   * cost monitoring has nothing to compare — and null is the honest answer there,
   * not a zero that would read as "no works, all fine".
   */
  drawdown?: DrawdownResult | null;
  /** how this position stands against the firm's own facility covenants */
  covenants?: CovenantResult | null;
}

export interface ExposureGroup {
  key: string;
  facility: number;
  /** share of total facility, 0–1 */
  share: number;
  deals: number;
}

export interface ExposureSummary {
  positions: ExposurePosition[];
  totals: {
    deals: number;
    gdv: number;
    totalCost: number;
    facility: number;
    drawn: number;
    /** facility not yet drawn — what is still committed but unfunded */
    undrawn: number;
    equity: number;
    /** drawn as a share of facility, 0–1 */
    utilisation: number;
    /** total facility against total GDV — the book's loan to value */
    loanToGdv: number;
  };
  byAssetType: ExposureGroup[];
  byRegion: ExposureGroup[];
  /** the single largest concentration in the book, whatever dimension it is on */
  largest: { dimension: 'deal' | 'assetType' | 'region'; key: string; share: number } | null;
}

/**
 * UK postcode area: the letters before the first digit. "BH15 1AA" → "BH".
 *
 * The area, not the district: a lender cares that a fifth of the book is in
 * Bournemouth, not that it is split across BH15 and BH17 — those are the same
 * market and will move together.
 */
export function postcodeArea(postcode: string | null | undefined): string {
  if (!postcode) return 'Unknown';
  const m = /^[A-Za-z]{1,2}/.exec(postcode.trim());
  return m ? m[0]!.toUpperCase() : 'Unknown';
}

const groupBy = (positions: ExposurePosition[], key: (p: ExposurePosition) => string, total: number): ExposureGroup[] => {
  const acc = new Map<string, { facility: number; deals: number }>();
  for (const p of positions) {
    const k = key(p) || 'Unknown';
    const cur = acc.get(k) ?? { facility: 0, deals: 0 };
    cur.facility += p.facility;
    cur.deals += 1;
    acc.set(k, cur);
  }
  return [...acc.entries()]
    .map(([k, v]) => ({ key: k, facility: v.facility, share: total > 0 ? v.facility / total : 0, deals: v.deals }))
    .sort((a, b) => b.facility - a.facility);
};

export function aggregateExposure(positions: ExposurePosition[]): ExposureSummary {
  const sum = (f: (p: ExposurePosition) => number) => positions.reduce((a, p) => a + f(p), 0);
  const facility = sum((p) => p.facility);
  const drawn = sum((p) => p.drawn);
  const gdv = sum((p) => p.gdv);

  const byAssetType = groupBy(positions, (p) => p.assetType, facility);
  const byRegion = groupBy(positions, (p) => p.region, facility);

  /**
   * The largest single concentration, across all three dimensions. A book can be
   * comfortable by asset type and still have half its money in one scheme, so the
   * answer is whichever is worst — not a per-dimension league table the reader
   * has to compare themselves.
   */
  const candidates: Array<{ dimension: 'deal' | 'assetType' | 'region'; key: string; share: number }> = [];
  if (facility > 0) {
    const biggestDeal = [...positions].sort((a, b) => b.facility - a.facility)[0];
    if (biggestDeal) candidates.push({ dimension: 'deal', key: biggestDeal.name, share: biggestDeal.facility / facility });
    if (byAssetType[0]) candidates.push({ dimension: 'assetType', key: byAssetType[0].key, share: byAssetType[0].share });
    if (byRegion[0]) candidates.push({ dimension: 'region', key: byRegion[0].key, share: byRegion[0].share });
  }
  candidates.sort((a, b) => b.share - a.share);

  return {
    positions: [...positions].sort((a, b) => b.facility - a.facility),
    totals: {
      deals: positions.length,
      gdv,
      totalCost: sum((p) => p.totalCost),
      facility,
      drawn,
      // never negative: a deal drawn beyond its appraised facility is a real
      // situation, and reporting "-£200k undrawn" would read as a rounding fault
      undrawn: Math.max(0, facility - drawn),
      equity: sum((p) => p.equity),
      utilisation: facility > 0 ? drawn / facility : 0,
      loanToGdv: gdv > 0 ? facility / gdv : 0,
    },
    byAssetType,
    byRegion,
    largest: candidates[0] ?? null,
  };
}
