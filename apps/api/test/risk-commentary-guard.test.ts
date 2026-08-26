import { describe, expect, it } from 'vitest';
import { unsupportedFigures } from '../src/narrative-guard.js';
import { acceptRiskDraft, riskFigures, riskTemplate, type RiskFactsForGuard } from '../src/routers/appraisal.js';

/**
 * The other prose a model writes with money in it.
 *
 * `narrative-guard.ts` exists because an instruction is not a guard: the Red
 * Book sections are drafted under an instruction to use the engine's figures
 * verbatim, and every figure in the draft is checked against what the engine
 * actually produced, because "please do not invent numbers" is a request.
 *
 * `draftRiskCommentary` is drafted the same way, under the same instruction,
 * and its own comment claims "every number it may cite is supplied
 * (engine-computed) — it authors register, never arithmetic". Nothing checked.
 * A transposed digit put a residual land value nobody calculated into the
 * commentary a promoter takes to a lender or a JV partner, beside a comparison
 * grid showing the real one.
 *
 * The stated non-negotiable is "the LLM NEVER computes financials". A figure it
 * merely re-typed wrongly is a figure it computed.
 */

const OPTIONS = [
  {
    name: 'Option A',
    descriptor: 'Consented scheme',
    blendedPsf: 420,
    buildPsf: 110,
    gia: 24_000,
    targetProfitPct: 20,
    residual: 1_197_577,
    gdv: 3_150_000,
    totalCost: 2_520_000,
    profit: 630_000,
    poc: 0.25,
  },
  {
    name: 'Option B',
    descriptor: 'Denser variant',
    blendedPsf: 440,
    buildPsf: 118,
    gia: 28_000,
    targetProfitPct: 20,
    residual: 1_640_000,
    gdv: 3_900_000,
    totalCost: 3_100_000,
    profit: 800_000,
    poc: 0.258,
  },
];

const facts: RiskFactsForGuard = { subject: 'Harbour Reach', options: OPTIONS };

describe('the figures a risk commentary is allowed to carry', () => {
  it('are exactly the ones the engine produced for the options being compared', () => {
    const allowed = riskFigures(facts);
    // every option's own figures, so the model can cite any of them
    for (const o of OPTIONS) {
      expect(allowed.money, `${o.name}'s GDV is not allowed`).toContain(o.gdv);
      expect(allowed.money, `${o.name}'s residual is not allowed`).toContain(o.residual);
      expect(allowed.money, `${o.name}'s profit is not allowed`).toContain(o.profit);
      expect(allowed.percents).toContain(Number((o.poc * 100).toFixed(1)));
    }
  });

  /**
   * The deterministic fallback interpolates the engine's figures, so it must
   * itself pass. A guard the fallback fails would reject every draft and then
   * print prose it had just called unsupported — which is worse than no guard,
   * because it would look like one.
   */
  it('accept the template the guard falls back to', () => {
    const bad = unsupportedFigures({ commentary: riskTemplate(facts) }, riskFigures(facts));
    expect(bad, `the deterministic fallback carries figures the guard rejects: ${bad.join(', ')}`).toEqual([]);
  });

  it('reject a residual land value nobody calculated', () => {
    // one transposed digit: £1,197,577 -> £1,917,577
    const draft = `The options for Harbour Reach carry distinct risk profiles. Option A returns 25.0% on cost against a GDV of £3,150,000 and a residual of £1,917,577.`;
    const bad = unsupportedFigures({ commentary: draft }, riskFigures(facts));
    expect(bad.join(' ')).toContain('1,917,577');
  });

  it('reject a profit on cost the engine never produced', () => {
    const draft = `Option B is the more resilient, its 31.4% profit on cost giving the widest margin.`;
    const bad = unsupportedFigures({ commentary: draft }, riskFigures(facts));
    expect(bad.join(' ')).toContain('31.4%');
  });

  it('accept a figure that is merely written shortly', () => {
    const draft = `Option B shows a GDV of £3.9m against Option A's £3,150,000.`;
    expect(unsupportedFigures({ commentary: draft }, riskFigures(facts))).toEqual([]);
  });

  /**
   * The decision itself, not only the detector. A guard that is written and not
   * called is the shape this whole branch keeps finding.
   */
  describe('and the draft that carries one is not the one shown', () => {
    it('replaces it with the template, and says the template wrote it', () => {
      const invented = `Option A returns 25.0% on cost against a GDV of £3,150,000 and a residual of £1,917,577.`;
      const out = acceptRiskDraft(invented, facts);
      expect(out.source, 'an unsupported draft was shown as the model’s work').toBe('template');
      expect(out.commentary, 'the invented residual reached the reader').not.toContain('1,917,577');
      expect(out.commentary).toBe(riskTemplate(facts));
    });

    it('shows a clean draft as the model’s own, so the disclosure stays honest', () => {
      const clean = `Option B is the more resilient, its 25.8% profit on cost against a GDV of £3,900,000 giving the widest margin.`;
      const out = acceptRiskDraft(clean, facts);
      expect(out.source).toBe('model');
      expect(out.commentary).toBe(clean);
    });
  });
});
