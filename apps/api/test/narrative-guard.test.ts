import { describe, expect, it } from 'vitest';
import { moneyIn, percentIn, unsupportedFigures } from '../src/narrative-guard.js';

/**
 * The model is told to use the engine's figures verbatim and invent nothing.
 * This checks it did — because the valuation rationale is required to end with
 * the Market Value opinion, and a transposed digit there is a figure nobody
 * calculated, printed in a signed valuation, in the sentence a reader trusts
 * most. Nothing downstream would catch it: the tiles and the export stay right,
 * and only the prose disagrees.
 */

const facts = {
  // Market Value, GDV, profit, £/ft² analysed, supported £/ft²
  money: [8_575_000, 8_575_165, 1_430_000, 205, 198],
  percents: [20.4],
};

describe('reading figures out of prose', () => {
  it('finds money however it is written', () => {
    const found = moneyIn('The value is £8,575,000, or £8.6m, at £205/ft² and a £12k fee.');
    expect(found.map((f) => f.value)).toEqual([8_575_000, 8_600_000, 205, 12_000]);
  });

  it('finds percentages', () => {
    expect(percentIn('a 20.4% return, versus 15%').map((f) => f.value)).toEqual([20.4, 15]);
  });
});

describe('a draft that used the figures it was given', () => {
  it('passes when every figure matches the engine', () => {
    const sections = {
      valuationRationale: "The valuer's opinion of Market Value is £8,575,000, a 20.4% profit on cost.",
      riskCommentary: 'Sales rates moving away from the supported £198/ft² are the principal risk.',
    };
    expect(unsupportedFigures(sections, facts)).toEqual([]);
  });

  it('accepts a figure said shortly', () => {
    /**
     * "£8.6m" is 8,575,000 written to two significant digits — the same figure,
     * abbreviated, which is ordinary valuation prose.
     */
    expect(unsupportedFigures({ marketCommentary: 'Against a GDV of £8.6m the market is active.' }, facts)).toEqual([]);
  });

  it('rounds the same way whatever engine it runs on', () => {
    /**
     * Both directions of one rounding step, pinned. The arithmetic behind this
     * used to disagree between Node versions — `10 ** -4` differs — so 8,575,000
     * to three significant figures was 8,580,000 where the tests ran and
     * 8,570,000 in the production container. The guard then ACCEPTED the
     * transposed digit it exists to catch, in the image customers use.
     */
    expect(unsupportedFigures({ marketCommentary: 'a GDV of £8.58m' }, facts)).toEqual([]);
    expect(unsupportedFigures({ marketCommentary: 'a GDV of £8.57m' }, facts)).toHaveLength(1);
  });

  it('ignores prose that is not a valuation figure', () => {
    const sections = {
      marketCommentary: 'Marketing periods are typically six to eight weeks and volumes over twelve months were stable.',
    };
    expect(unsupportedFigures(sections, facts)).toEqual([]);
  });
});

describe('a draft that wrote a figure nobody calculated', () => {
  it('catches a transposed digit in the Market Value', () => {
    /**
     * The failure this exists for. £8,570,000 is £5,000 away from the opinion the
     * engine produced, reads as entirely plausible, and would be printed as the
     * valuer's concluded figure.
     */
    const bad = unsupportedFigures(
      { valuationRationale: "The valuer's opinion of Market Value is £8,570,000." },
      facts,
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain('£8,570,000');
  });

  it('is not fooled by a near miss inside a percentage tolerance', () => {
    // a tolerance wide enough to allow abbreviations would swallow this
    expect(unsupportedFigures({ riskCommentary: 'compressing the 20.9% profit on cost' }, facts)).toHaveLength(1);
  });

  it('catches an invented rate', () => {
    expect(unsupportedFigures({ riskCommentary: 'the supported £215/ft²' }, facts)).toHaveLength(1);
  });

  it('names the section so the fault can be found', () => {
    const bad = unsupportedFigures({ marketCommentary: 'a GDV of £9,100,000' }, facts);
    expect(bad[0]).toMatch(/^marketCommentary: /);
  });

  it('reports every offending figure, not just the first', () => {
    const bad = unsupportedFigures(
      { valuationRationale: 'Market Value of £8,570,000 at £215/ft², a 20.9% return.' },
      facts,
    );
    expect(bad).toHaveLength(3);
  });
});

/**
 * A round number written out in full.
 *
 * The allowance for abbreviation used to be granted on the significant digits
 * of the VALUE, and a value's trailing zeros are not significant — so
 * "£8,000,000" counted as one significant digit, exactly like "£8m", and earned
 * the same latitude. Against a Market Value of £7,600,000 the draft could say
 * "the Market Value is £8,000,000" and pass.
 *
 * Four hundred thousand pounds, written to the pound as a precise figure, in
 * the one sentence a reader trusts most — which is the failure this whole file
 * exists to prevent, arriving through the tolerance meant to permit shorthand.
 */
describe('shorthand versus a claim to precision', () => {
  const facts = { money: [7_600_000], percents: [20.4] };
  const draft = (text: string) => unsupportedFigures({ valuationRationale: text }, facts);

  it('accepts the figure said shortly', () => {
    // one and two significant digits, and 7,600,000 rounds to each of them
    expect(draft('The Market Value is £8m.')).toEqual([]);
    expect(draft('The Market Value is £7.6m.')).toEqual([]);
    expect(draft('The Market Value is £7,600,000.')).toEqual([]);
  });

  it('refuses a different figure written out in full', () => {
    const bad = draft('The valuer’s opinion of Market Value is £8,000,000.');
    expect(bad, '£400,000 out, and written as though it were exact').toHaveLength(1);
    expect(bad[0]).toContain('£8,000,000');
  });

  it('refuses an abbreviation that claims more precision than it has', () => {
    // "£8.0m" asserts two significant digits; 7.6m is not 8.0m at two
    expect(draft('The Market Value is £8.0m.')).toHaveLength(1);
  });

  it('holds the same line on percentages', () => {
    expect(draft('a return of 20.4% on cost')).toEqual([]);
    expect(draft('a return of 20% on cost'), '20% is 20.4 to two digits').toEqual([]);
    expect(draft('a return of 20.0% on cost'), '20.0% claims three, and 20.4 is not 20.0').toHaveLength(1);
  });

  it('still lets an exact round figure through when that is what the engine said', () => {
    const round = { money: [8_000_000], percents: [] };
    expect(unsupportedFigures({ valuationRationale: 'Market Value of £8,000,000.' }, round)).toEqual([]);
  });
});
