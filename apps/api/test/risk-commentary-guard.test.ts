import { describe, expect, it } from 'vitest';
import { unsupportedFigures } from '../src/narrative-guard.js';
import { acceptRiskDraft, riskFigures, riskTemplate, unsupportedRecommendation, type RiskFactsForGuard } from '../src/routers/appraisal.js';

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

/**
 * And WHICH option it recommends, which is a financial conclusion.
 *
 * The figure guard above checks that every number came from the engine. Choosing
 * which option those numbers make the better scheme is not a number — it is the
 * conclusion the whole comparison exists to produce, and the first
 * non-negotiable in this codebase is that the model never draws one.
 *
 * The instruction already tells the model which option to name: "name Option B
 * as the more resilient option and explain why its 25.8% profit on cost gives
 * the widest margin". That was the whole of the enforcement. Every figure in
 * "Option A is the more resilient option" is a figure the model was handed, so
 * `unsupportedFigures` returns [] and a commentary recommending the scheme the
 * engine ranks LOWER is shown to a promoter as the model's own work, next to a
 * grid showing the other one ahead.
 */
describe('the option a risk commentary is allowed to recommend', () => {
  // Option B: 25.8% on cost against Option A's 25.0%
  const engineChoice = 'Option B';

  it('is the one the engine ranks best on profit on cost', () => {
    expect(unsupportedRecommendation(riskTemplate(facts), facts)).toEqual([]);
    expect(riskTemplate(facts)).toContain(`${engineChoice} is considered the more resilient option`);
  });

  it('rejects a draft that recommends the other one', () => {
    const flipped = riskTemplate(facts)
      .replace(/Option B is considered the more resilient option/, 'Option A is considered the more resilient option');
    expect(
      unsupportedFigures({ commentary: flipped }, riskFigures(facts)),
      'the figure guard was never going to catch a recommendation — that is why this one exists',
    ).toEqual([]);
    expect(unsupportedRecommendation(flipped, facts).join('\n')).toContain('recommends Option A');
  });

  it('rejects the recommendation however it is worded', () => {
    for (const sentence of [
      'Option A is the preferred scheme.',
      'On balance Option A is recommended.',
      'Option A offers the widest margin.',
      'Option A is the most robust of the two.',
      'Option A is the strongest performer here.',
    ]) {
      expect(unsupportedRecommendation(`${riskTemplate(facts)} ${sentence}`, facts), sentence).not.toEqual([]);
    }
  });

  it('allows a comparison, which names both', () => {
    /**
     * "Option A is less resilient than Option B" carries a preference word and
     * the losing option's name, and is exactly right. Naming the engine's choice
     * in the same breath is what makes it a comparison rather than a rival
     * recommendation.
     */
    for (const sentence of [
      'Option A is less resilient than Option B.',
      'Option B is the more resilient of the two, with Option A carrying more planning exposure.',
    ]) {
      expect(unsupportedRecommendation(`${riskTemplate(facts)} ${sentence}`, facts), sentence).toEqual([]);
    }
  });

  it('rejects a draft that drops the conclusion altogether', () => {
    const noVerdict = 'The options carry distinct risk profiles, and planning exposure sits with the unconsented variant.';
    expect(unsupportedRecommendation(noVerdict, facts).join('\n')).toContain('never names Option B');
  });

  it('says nothing where there is nothing to choose between', () => {
    expect(unsupportedRecommendation('Anything at all.', { ...facts, options: [OPTIONS[0]!] })).toEqual([]);
  });

  it('matches whole names, so one option cannot be read inside another', () => {
    /**
     * The engine's choice is the SHORTER name, which is the direction that
     * breaks. A substring test finds "Option A" inside "Option A2", so a
     * recommendation of the rival reads as a mention of the engine's own choice
     * and is waved through — the guard silently stops guarding for any firm
     * whose scheme names nest, which is most of them ("Scheme 1"/"Scheme 1A").
     */
    const nested: RiskFactsForGuard = {
      subject: 'Harbour Reach',
      options: [
        { ...OPTIONS[0]!, name: 'Option A', poc: 0.3 },
        { ...OPTIONS[1]!, name: 'Option A2', poc: 0.25 },
      ],
    };
    expect(
      unsupportedRecommendation('Option A is set out above. Option A2 is the preferred scheme.', nested).join('\n'),
      'a recommendation of Option A2 was read as naming Option A',
    ).toContain('recommends Option A2');
    // and the honest version still passes
    expect(unsupportedRecommendation('Option A is the preferred scheme.', nested)).toEqual([]);
  });

  describe('and the draft that recommends the wrong one is not the one shown', () => {
    it('replaces it with the template, which names the engine’s choice', () => {
      const flipped = 'Option A is the more resilient option, on a residual land value of £1,197,577.';
      const out = acceptRiskDraft(flipped, facts);
      expect(out.source, 'a recommendation the engine contradicts was shown as the model’s own').toBe('template');
      expect(out.commentary).toContain(`${engineChoice} is considered the more resilient option`);
    });
  });
});
