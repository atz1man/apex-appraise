import { describe, expect, it } from 'vitest';
import { moneyIn, percentIn, unsupportedClaims, unsupportedFigures } from '../src/narrative-guard.js';

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

/**
 * The claims, which had no check at all.
 *
 * The figure guard above exists because "use these figures verbatim" is only an
 * instruction. The same prompt carries rules about what the draft may ASSERT,
 * and those were enforced by nothing — a gap hidden by where the tests run:
 * `narrative-claims.test.ts` asserts all of them, but its harness sets no
 * ANTHROPIC_API_KEY, so every assertion there exercises the deterministic
 * template. On the model path, which is the one production takes, a sentence
 * like "transaction volumes have been stable and marketing periods are
 * typically six to eight weeks" carries no money and no percentage, so the
 * figure guard finds nothing to object to and it prints into a signed valuation.
 *
 * Every sentence rejected below was written by this product's own template until
 * 238d265 — which is why a model drafting in the same house style reaches for
 * them.
 */
describe('claims nothing established', () => {
  const none = { specialAssumptions: null };
  const claims = (text: string, facts = none) => unsupportedClaims({ marketCommentary: text }, facts);

  it('rejects market conditions this product has never measured', () => {
    for (const sentence of [
      'The local market remains active, with steady occupier and investor demand.',
      'There is a limited supply of directly comparable stock.',
      'Transaction volumes over the preceding twelve months have been stable.',
      'Marketing periods for well-presented accommodation are typically six to eight weeks.',
      'No material valuation uncertainty is reported.',
    ]) {
      expect(claims(sentence), sentence).not.toEqual([]);
    }
  });

  it('rejects a declaration that the evidence base is adequate', () => {
    expect(claims('The evidence base of 1 comparable is considered adequate for the class.')).not.toEqual([]);
    expect(claims('Adequate comparable evidence is available.')).not.toEqual([]);
  });

  it('rejects denying a special assumption the signed terms record', () => {
    const denial = 'No special assumptions have been made.';
    expect(claims(denial, { specialAssumptions: 'That planning permission is granted.' })).not.toEqual([]);
    // and says so where the terms genuinely record none
    expect(claims(denial, none)).toEqual([]);
  });

  it('names the section and quotes the sentence, so a rejection can be read', () => {
    const [first] = unsupportedClaims({ riskCommentary: 'Transaction volumes have been stable.' }, none);
    expect(first).toContain('riskCommentary');
    expect(first).toContain('Transaction volumes have been stable.');
  });

  it('accepts naming a gap, which is the opposite of asserting it', () => {
    /**
     * This has to hold or the guard rejects the honest prose it exists to fall
     * back to. The template's own market paragraph names demand, supply,
     * transaction volumes and marketing periods in one breath — to say none of
     * them were looked at.
     */
    for (const sentence of [
      'Local market conditions — occupier and investor demand, supply of comparable stock, transaction volumes and marketing periods — have not been assessed in this draft and are for the valuer to state.',
      'The evidence base is 1 comparable, and its adequacy for the class is for the valuer to confirm.',
      'Material valuation uncertainty has not been assessed in this draft.',
      'Demand in the locality has not been measured.',
    ]) {
      expect(claims(sentence), sentence).toEqual([]);
    }
  });

  it('does not object to ordinary valuation prose', () => {
    for (const sentence of [
      'Primary reliance is placed on the comparable method, cross-checked against the depreciated replacement cost and investment approaches.',
      "Reconciling the approaches, the valuer's opinion of Market Value is £3,150,000.",
      'Planning status is recorded as outline consent, and the valuation assumes all stated consents remain in effect.',
      'No comparables have been logged, so the figure is appraisal-led and should be read accordingly.',
    ]) {
      expect(claims(sentence), sentence).toEqual([]);
    }
  });

  it('reads one sentence at a time, so a disclaimer cannot cover an assertion beside it', () => {
    const mixed =
      'Demand in the locality has not been measured. Transaction volumes over the preceding twelve months have been stable.';
    const found = claims(mixed);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('Transaction volumes');
  });
});

/**
 * The guard could only see a figure that wore a pound sign.
 *
 * That made it depend on the model's formatting, which is the circularity this
 * module exists to break: the prompt says write £, and this file was written
 * because a prompt is not a guard. Measured against an engine Market Value of
 * £8,575,000, using the transposition the whole module is for — the same wrong
 * number, dressed four ways:
 *
 *     "the Market Value is £8,570,000."      FLAGGED
 *     "the Market Value is 8,570,000."       passed
 *     "the Market Value is 8,570,000 pounds" passed
 *     "the Market Value is 8,570,000 GBP."   passed
 *     "the Market Value is 8,570,000£."      passed
 *     "a return on cost of 31.2 per cent"    passed
 *
 * A transposed digit in a signed valuation does not become acceptable because
 * the drafter left the symbol off.
 */
describe('a figure that does not wear a pound sign', () => {
  const FACTS = { money: [8_575_000, 406_711.36], percents: [25, 20.4] };
  const check = (text: string) => unsupportedFigures({ rationale: text }, FACTS);

  it('is caught when the marker follows the number', () => {
    expect(check('The Market Value is 8,570,000 pounds.')).toHaveLength(1);
    expect(check('The Market Value is 8,570,000 GBP.')).toHaveLength(1);
    expect(check('The Market Value is 8,570,000 sterling.')).toHaveLength(1);
    expect(check('The Market Value is 8,570,000£.')).toHaveLength(1);
  });

  it('is caught when a percentage is spelled out', () => {
    expect(check('This reflects a return on cost of 31.2 per cent.')).toHaveLength(1);
    expect(check('This reflects a return on cost of 31.2 percent.')).toHaveLength(1);
  });

  /**
   * The multipliers only worked by accident before: `m` matched the first letter
   * of "million", and "billion" matched nothing at all, so "£8.6 billion" was
   * read as the number 8.6.
   */
  it('reads a spelled-out multiplier as the figure it is', () => {
    expect(check('The Market Value is £8.6 million.'), 'the abbreviation of a true figure').toHaveLength(0);
    expect(check('The Market Value is £8.6 billion.'), 'a thousand times the true figure').toHaveLength(1);
    expect(check('The Market Value is 8.6 million pounds.')).toHaveLength(0);
    /**
     * The line above passes both when the figure is read correctly AND when it
     * is not read at all, so on its own it proves nothing about the trailing
     * marker. This is the discriminating half: a WRONG figure in the same dress
     * has to be caught, which it can only be if the words were understood.
     */
    expect(check('The Market Value is 8.7 million pounds.'), 'a wrong figure in words went unread').toHaveLength(1);
    /**
     * `thousand` needs a fact it can be RIGHT about. Asserting only that
     * "£500 thousand" is flagged proves nothing: it is flagged whether the word
     * is understood (500,000) or ignored (500), because both are wrong here.
     */
    const withHalfMillion = (t: string) => unsupportedFigures({ rationale: t }, { money: [500_000], percents: [] });
    expect(withHalfMillion('The fee is £500 thousand.'), 'thousand was not read as a multiplier').toHaveLength(0);
    expect(withHalfMillion('The fee is £600 thousand.')).toHaveLength(1);
  });

  /**
   * Written out in full, a figure is a claim to that precision and is held to
   * it — the abbreviation allowance is only for three digits or fewer. So a
   * residual of £406,711.36 is not "£406,711": that is six digits of asserted
   * precision against a figure the engine did not produce.
   */
  it('holds a fully written figure to the precision it claims', () => {
    expect(check('The residual land value is £406,711.'), 'six digits earned the abbreviation allowance').toHaveLength(1);
    expect(check('The residual land value is £406,712.')).toHaveLength(1);
    // and the allowance still works where it is meant to
    expect(check('The Market Value is £8.6m.')).toHaveLength(0);
  });

  /** The correct figure keeps passing in every dress. */
  it('does not object to the right number however it is written', () => {
    for (const t of [
      'The Market Value is £8,575,000.',
      'The Market Value is 8,575,000 GBP.',
      'The Market Value is £8.6m.',
      'The Market Value is £8.6 million.',
    ]) {
      expect(check(t), t).toHaveLength(0);
    }
  });

  /**
   * The gap this deliberately does NOT close, pinned so the reasoning is not
   * rediscovered as a bug. A number with no marker at all shares its shape with
   * an area, and the facts handed to the drafter carry no areas — so catching
   * the first would reject the second, and rejecting every honest draft removes
   * the model path silently rather than loudly.
   */
  it('still cannot see a number wearing no marker at all', () => {
    expect(check('The Market Value is 8,570,000.'), 'if this ever flags, areas must be in the facts first').toHaveLength(0);
    expect(check('The scheme provides 8,750 sq ft of net internal area.')).toHaveLength(0);
  });
});
