/**
 * The scenario compare — one set of assumptions, one derivation.
 *
 * These existed twice: `ASSUMPTIONS` in apps/web/src/routes/Scenarios.tsx and
 * `SCENARIO_ASSUMPTIONS` in apps/api/src/routers/appraisal.ts, thirteen numbers
 * each, with the API's copy carrying the comment "kept in lockstep with the grid
 * in apps/web/src/routes/Scenarios.tsx". Kept in lockstep by hand.
 *
 * The derivation was duplicated too, and had already drifted in FORM. The screen
 * takes the engine's figures straight, under a comment recording why:
 *
 *   "This screen used to re-add the cost lines and regross the land itself, with
 *    its own copy of the acquisition-cost rule — so a scenario table could
 *    quietly disagree with the appraisal it was varying, and the two would have
 *    looked equally authoritative."
 *
 * The server still did exactly that. Measured across three scenarios the two
 * agree to the pound — the re-derivation happens to reproduce the engine's
 * totalCost today — so this is not a wrong number on a screen. It is one change
 * to how the engine composes totalCost or grosses land away from being two, in
 * the figures a valuation's comparative risk commentary is written from.
 *
 * The webhook-event list on this branch was the same shape, and taught the same
 * lesson: a duplicate that agrees today passes a value comparison.
 */

import { autoAppraise } from './engine.js';

/**
 * Fixed assumptions behind every scenario option: fees 11%, contingency 5%,
 * CIL £40/m² + S106 £150k, disposal 2%, 60% LTC at 7.5% over 18+3 months,
 * 1.5% arrangement, 6.8% acquisition.
 *
 * Deliberately fixed rather than taken from the deal's own appraisal: the point
 * of the compare is to vary four levers with everything else held still. That is
 * a modelling choice, and it is stated on the screen and in the commentary.
 */
export const SCENARIO_ASSUMPTIONS = {
  efficiency: 90,
  profFeePct: 11,
  contingencyPct: 5,
  cilPerSqm: 40,
  s106: 150_000,
  agentPct: 1.5,
  legalPct: 0.5,
  ltcPct: 60,
  ratePct: 7.5,
  periodMonths: 18,
  salesMonths: 3,
  arrangementFeePct: 1.5,
  acqPct: 6.8,
} as const;

/** The four levers a scenario varies. */
export interface ScenarioLevers {
  blendedPsf: number;
  buildPsf: number;
  gia: number;
  targetProfitPct: number;
}

export interface ScenarioMetrics {
  residual: number;
  gdv: number;
  totalCost: number;
  profit: number;
  poc: number;
}

/** Levers → figures, straight from the engine. Nothing re-added, nothing regrossed. */
export function scenarioMetrics(s: ScenarioLevers): ScenarioMetrics {
  const A = SCENARIO_ASSUMPTIONS;
  const r = autoAppraise({
    units: [{ label: 'Blended', count: 1, area: s.gia * (A.efficiency / 100), cap: s.blendedPsf }],
    efficiency: A.efficiency,
    buildPerSqft: s.buildPsf,
    profFeePct: A.profFeePct,
    contingencyPct: A.contingencyPct,
    cilPerSqm: A.cilPerSqm,
    s106: A.s106,
    agentPct: A.agentPct,
    legalPct: A.legalPct,
    ltcPct: A.ltcPct,
    ratePct: A.ratePct,
    periodMonths: A.periodMonths,
    salesMonths: A.salesMonths,
    arrangementFeePct: A.arrangementFeePct,
    targetProfitPct: s.targetProfitPct,
    acqPct: A.acqPct,
    asking: 0,
  });
  return { residual: r.residualNet, gdv: r.gdv, totalCost: r.totalCost, profit: r.profit, poc: r.poc };
}
