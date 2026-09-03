import { createHash } from 'node:crypto';
import type { Appraisal } from '@prisma/client';
import { ENGINE_VERSION, computeAppraisal, reportedMarketValue } from '@apex/appraisal-engine';
import { appraisalRowToEngineInput } from './mappers.js';

/**
 * What an approval is worth, made checkable.
 *
 * An approved version stored its inputs and a `resultCache` from the day it was
 * SAVED, and the reports — the Red Book a lender receives, the appraisal report
 * a client signs — recompute from those inputs in the browser with whatever
 * engine ships today. `appraisal.compare` names the exposure in its own words:
 * "a cache records what the engine said on the day it was written". So a rate
 * rule fixed after an approval moved the Market Value under the valuer's
 * signature, and nothing anywhere could say so: no row recorded which engine
 * produced the signed figure, and no procedure could re-derive it and compare.
 *
 * The pin closes that. At approval the row records the engine version, a hash
 * of the canonical inputs, and the headline figures to the penny. `verify`
 * re-derives with the engine in hand and reports three things separately —
 * whether the engine is the one that signed, whether the inputs are the ones
 * that were signed, and whether the figures agree — because each has a
 * different remedy: a bumped engine needs re-approval, changed inputs on an
 * approved row are a breach of `approved-immutable`, and figures that differ
 * under the same engine and inputs cannot happen and would be a bug in this
 * file.
 */

/** the figures a signed valuation is known by; all £ except poc, which is a fraction */
export const PINNED_FIGURES = ['marketValue', 'gdv', 'residualNet', 'landGross', 'build', 'totalCost', 'profit', 'poc'] as const;
export type PinnedFigure = (typeof PINNED_FIGURES)[number];

export interface ApprovalPin {
  engineVersion: string;
  /** sha256 of the canonical engine input — sorted keys, no undefineds */
  inputHash: string;
  figures: Record<PinnedFigure, number>;
  pinnedAt: string;
}

export interface Drift {
  key: PinnedFigure;
  pinned: number;
  now: number;
}

export interface Verification {
  engineVersion: { pinned: string; current: string; same: boolean };
  inputsUnchanged: boolean;
  figuresMatch: boolean;
  drift: Drift[];
  pinned: Record<PinnedFigure, number>;
  now: Record<PinnedFigure, number>;
  pinnedAt: string;
}

/** JSON with keys sorted at every level and `undefined` dropped, so the same inputs always hash the same */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const inputHashOf = (row: Appraisal): string =>
  createHash('sha256').update(stableStringify(appraisalRowToEngineInput(row))).digest('hex');

/** to the penny; a pin compared at floating precision would report drift that is only binary noise */
const penny = (n: number) => Math.round(n * 100) / 100;

export function figuresOf(row: Appraisal): Record<PinnedFigure, number> {
  const R = computeAppraisal(appraisalRowToEngineInput(row));
  return {
    marketValue: reportedMarketValue(R.gdv),
    gdv: penny(R.gdv),
    residualNet: penny(R.residualNet),
    landGross: penny(R.landGross),
    build: penny(R.build),
    totalCost: penny(R.totalCost),
    profit: penny(R.profit),
    // a fraction, held to a basis point of a basis point rather than a penny
    poc: Math.round(R.poc * 1e6) / 1e6,
  };
}

/** The pin for a version as it stands now — written at the moment of approval. */
export function pinFor(row: Appraisal, at = new Date()): ApprovalPin {
  return { engineVersion: ENGINE_VERSION, inputHash: inputHashOf(row), figures: figuresOf(row), pinnedAt: at.toISOString() };
}

export function readPin(row: Pick<Appraisal, 'approvalPin'>): ApprovalPin | null {
  if (!row.approvalPin) return null;
  try {
    const p = JSON.parse(row.approvalPin) as ApprovalPin;
    return p && typeof p.inputHash === 'string' && p.figures ? p : null;
  } catch {
    return null;
  }
}

/** Re-derive with the engine in hand and say, separately, what still holds. */
export function verify(row: Appraisal): Verification | null {
  const pin = readPin(row);
  if (!pin) return null;
  const now = figuresOf(row);
  const drift: Drift[] = PINNED_FIGURES.filter((k) => pin.figures[k] !== now[k]).map((k) => ({ key: k, pinned: pin.figures[k], now: now[k] }));
  return {
    engineVersion: { pinned: pin.engineVersion, current: ENGINE_VERSION, same: pin.engineVersion === ENGINE_VERSION },
    inputsUnchanged: pin.inputHash === inputHashOf(row),
    figuresMatch: drift.length === 0,
    drift,
    pinned: pin.figures,
    now,
    pinnedAt: pin.pinnedAt,
  };
}
