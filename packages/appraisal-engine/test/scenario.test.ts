import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENARIO_ASSUMPTIONS, scenarioMetrics } from '../src/scenario.js';
import { autoAppraise } from '../src/engine.js';

/**
 * The scenario compare, which had two copies of everything.
 *
 * Thirteen assumptions in apps/web and thirteen in apps/api, with the API's copy
 * carrying the comment "kept in lockstep with the grid in Scenarios.tsx". And
 * two derivations: the screen took the engine's figures straight, the server
 * re-added the cost lines and re-grossed the land with its own copy of the
 * acquisition-cost rule — which is precisely what the screen's own comment
 * records having been fixed for.
 *
 * Measured across three scenarios, the two agreed to the pound. That is the
 * point: a duplicate that agrees today passes a value comparison, and the same
 * thing on this branch's webhook-event list stayed green through a revert.
 */

const BASE = { blendedPsf: 420, buildPsf: 185, gia: 24_000, targetProfitPct: 20 };

describe('the figures come from the engine', () => {
  it('are the engine’s own totals, not a re-derivation', () => {
    const A = SCENARIO_ASSUMPTIONS;
    const r = autoAppraise({
      units: [{ label: 'Blended', count: 1, area: BASE.gia * (A.efficiency / 100), cap: BASE.blendedPsf }],
      efficiency: A.efficiency,
      buildPerSqft: BASE.buildPsf,
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
      targetProfitPct: BASE.targetProfitPct,
      acqPct: A.acqPct,
      asking: 0,
    });
    const m = scenarioMetrics(BASE);
    expect(m.totalCost).toBe(r.totalCost);
    expect(m.profit).toBe(r.profit);
    expect(m.poc).toBe(r.poc);
    expect(m.gdv).toBe(r.gdv);
    expect(m.residual).toBe(r.residualNet);
  });

  it('holds the profit target the lever asks for, which is on GDV', () => {
    // the residual absorbs the difference, which is what a residual is for.
    // targetProfitPct is profit on GDV, not on cost — the first version of this
    // test asserted profit on cost and read 13.6% against a 12% target
    for (const target of [12, 20, 28]) {
      const m = scenarioMetrics({ ...BASE, targetProfitPct: target });
      expect((m.profit / m.gdv) * 100, `target ${target}%`).toBeCloseTo(target, 6);
      // and profit on cost is the higher number, always
      expect(m.poc).toBeGreaterThan(m.profit / m.gdv);
    }
  });

  it('leaves less for the land the more profit is demanded', () => {
    const lean = scenarioMetrics({ ...BASE, targetProfitPct: 12 });
    const rich = scenarioMetrics({ ...BASE, targetProfitPct: 28 });
    expect(rich.residual).toBeLessThan(lean.residual);
    expect(rich.gdv).toBe(lean.gdv);
  });

  it('moves with each lever', () => {
    const base = scenarioMetrics(BASE);
    expect(scenarioMetrics({ ...BASE, blendedPsf: 520 }).gdv).toBeGreaterThan(base.gdv);
    expect(scenarioMetrics({ ...BASE, gia: 32_000 }).gdv).toBeGreaterThan(base.gdv);
    // a dearer build leaves less for the land, at a held profit target
    expect(scenarioMetrics({ ...BASE, buildPsf: 240 }).residual).toBeLessThan(base.residual);
  });
});

describe('the derivation itself', () => {
  it('does not re-add the cost lines or re-gross the land', () => {
    /**
     * Measured: the server's re-derivation and the engine's own totals were
     * algebraically IDENTICAL — bit-for-bit — so no comparison of values can
     * tell them apart, and moving the re-derivation in here passes every other
     * test in this file. The defect was duplication, not divergence, and the
     * only way to hold it is on the shape.
     *
     * The screen and the API carry the same assertion; see
     * apps/api/test/scenario-shared.test.ts.
     */
    const src = readFileSync(new URL('../src/scenario.ts', import.meta.url), 'utf8');
    expect(src, 'the acquisition re-grossing came back').not.toMatch(/residualNet\s*\*\s*\(1\s*\+/);
    expect(src, 'the cost lines were re-added').not.toMatch(/saleCosts\s*\+\s*r?\.?build/);
    expect(src).toContain('totalCost: r.totalCost');
  });
});

describe('the assumptions', () => {
  it('are the thirteen the screen and the commentary both name', () => {
    expect(SCENARIO_ASSUMPTIONS).toEqual({
      efficiency: 90, profFeePct: 11, contingencyPct: 5, cilPerSqm: 40, s106: 150_000,
      agentPct: 1.5, legalPct: 0.5, ltcPct: 60, ratePct: 7.5, periodMonths: 18,
      salesMonths: 3, arrangementFeePct: 1.5, acqPct: 6.8,
    });
  });
});
