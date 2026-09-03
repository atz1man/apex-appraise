/**
 * Checking that the model wrote the figures it was given.
 *
 * The narrative sections of a Red Book report are drafted by a model, from facts
 * the engine computed, under an instruction to use them verbatim and invent
 * nothing. That instruction is the right one — and it is still only an
 * instruction. The valuation rationale is REQUIRED to end with the Market Value
 * opinion, so a single transposed digit puts a figure nobody calculated into a
 * signed valuation, in the sentence a reader trusts most.
 *
 * Nothing downstream would catch it. The engine's number is correct on the KPI
 * tiles and in the export; only the prose disagrees, and prose is not diffed.
 *
 * So every money and percentage figure in the draft is checked against what the
 * engine actually produced. A draft carrying anything else is discarded in favour
 * of the deterministic template, which interpolates the same figures and cannot
 * drift. A rejected draft is a small loss of prose quality; a wrong figure in a
 * signed valuation is not a small loss of anything.
 */

/**
 * A figure is only checked if this can SEE it, and the mark it looked for was a
 * leading pound sign.
 *
 * That made the guard depend on the model's formatting, which is the same
 * circularity the file exists to break: the prompt says write £, and this was
 * written because a prompt is not a guard. Measured against an engine Market
 * Value of £8,575,000, with the transposition this whole module is for:
 *
 *     "the Market Value is £8,570,000."      FLAGGED
 *     "the Market Value is 8,570,000."       passed
 *     "the Market Value is 8,570,000 pounds" passed
 *     "the Market Value is 8,570,000 GBP."   passed
 *     "the Market Value is 8,570,000£."      passed
 *     "a return on cost of 31.2 per cent"    passed
 *
 * So the marker may now come before or after, and may be a word. The suffix list
 * gained the spelled-out multipliers at the same time: "£8.6 million" only
 * worked before because `m` happened to match the first letter of the word, and
 * "£8.6 billion" did not work at all.
 *
 * WHAT IS STILL NOT SEEN, and why it is left: a number carrying no marker of any
 * kind — "the Market Value is 8,570,000." The shape that would catch it is a
 * comma-grouped number, and areas share it exactly. The facts handed to the
 * model are `[mv, gdv, profit, psf, supportedPsf]` and contain no areas, so
 * "the scheme provides 8,750 sq ft of net internal area" would be flagged as an
 * invented figure and the draft discarded. That is not the cheap failure it
 * looks like: rejecting every honest draft removes the model path silently,
 * leaving a feature that appears to work and never runs. Closing it properly
 * means putting areas in the facts, which is a change to what the drafter is
 * given rather than to what this reads.
 */
/** Money written as £8,575,000, £8.6m, 8,575,000 GBP, £205 or £205/ft². */
const MONEY = /£\s?([\d,]+(?:\.\d+)?)\s*(million|billion|thousand|bn|m|k)?/gi;
/** The same figure with its marker after it: "8,575,000 GBP", "£8.6m" reversed. */
const MONEY_TRAILING =
  /([\d,]+(?:\.\d+)?)\s*(million|billion|thousand|bn|m|k)?\s*(?:£|GBP\b|pounds?\b|sterling\b)/gi;
/** Percentages, including "20.4% on cost" and "20.4 per cent". */
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b|percent\b)/gi;

const MULTIPLIER: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
};

export interface FoundFigure {
  /** as written, for the message a human reads */
  raw: string;
  value: number;
  /**
   * Significant digits AS WRITTEN, which is not the same as the significant
   * digits of the value. "£8m" is one; "£8,000,000" is seven. The value cannot
   * tell them apart — both are 8000000 — and the difference is the whole
   * question of whether a figure is an abbreviation or a claim to precision.
   */
  writtenDigits: number;
}

/** Digits actually typed, ignoring separators and any leading zero. */
const digitsWritten = (literal: string) => {
  const bare = literal.replace(/[,\s]/g, '').replace(/\./g, '').replace(/^0+/, '');
  return Math.max(1, bare.length);
};

export function moneyIn(text: string): FoundFigure[] {
  const out: FoundFigure[] = [];
  // both marker positions; a figure carrying one at each end is simply checked
  // twice, which costs nothing and is cheaper than reasoning about overlap
  for (const re of [MONEY, MONEY_TRAILING]) {
    for (const m of text.matchAll(re)) {
      const digits = Number(m[1]!.replace(/,/g, ''));
      if (!Number.isFinite(digits)) continue;
      const suffix = m[2]?.toLowerCase();
      out.push({
        raw: m[0].trim(),
        value: digits * (suffix ? (MULTIPLIER[suffix] ?? 1) : 1),
        writtenDigits: digitsWritten(m[1]!),
      });
    }
  }
  return out;
}

export function percentIn(text: string): FoundFigure[] {
  const out: FoundFigure[] = [];
  for (const m of text.matchAll(PERCENT)) {
    const v = Number(m[1]!);
    if (Number.isFinite(v)) out.push({ raw: m[0].trim(), value: v, writtenDigits: digitsWritten(m[1]!) });
  }
  return out;
}


/**
 * Rounded by the language's own decimal rules, not by float arithmetic.
 *
 * This was `Math.round(n * 10 ** (digits - mag)) / 10 ** (digits - mag)`, and it
 * DISAGREED WITH ITSELF ACROSS NODE VERSIONS: `10 ** -4` is 0.0001 on Node 25 and
 * 0.00009999999999999999 on Node 22, which is what the production image runs.
 * 8,575,000 to 3 s.f. therefore came out as 8,580,000 on the machine the tests
 * pass on and 8,570,000 inside the container — so the guard accepted "£8,570,000"
 * as the engine's Market Value in production, the exact transposed digit it
 * exists to stop, while its test went green on the developer's laptop.
 *
 * `toPrecision` is specified decimal rounding on the exact value of the double.
 * It cannot drift between engines, which is the property this needs more than it
 * needs arithmetic.
 */
const roundToSigFigs = (n: number, digits: number) => {
  if (n === 0) return 0;
  return Number.parseFloat(n.toPrecision(digits));
};

/**
 * Is this figure one of the allowed ones, possibly abbreviated?
 *
 * "£8.6m" for 8,575,000 is the same figure said shortly — two significant digits,
 * and 8,575,000 rounded to two significant digits IS 8.6m. "£8,570,000" is not:
 * it is written to seven digits and does not match at seven digits. That
 * distinction matters, because a transposed digit lands inside any percentage
 * tolerance you would otherwise reach for.
 *
 * The precision is the one the author WROTE, not the one the value happens to
 * carry. This used to measure significantDigits(value), which strips trailing
 * zeros — so "£8,000,000" counted as one significant digit and earned the same
 * allowance as "£8m". Against an engine Market Value of £7,600,000, a draft
 * reading "the Market Value is £8,000,000" was accepted: four hundred thousand
 * pounds out, written to the penny-place as a precise figure, in the sentence
 * this guard exists for. Measured before the change and after.
 *
 * Written out in full, a round number is a claim about precision and is held to
 * it. "£8m" still passes, because saying a figure shortly is not the same as
 * saying a different figure.
 */
function isSupported(figure: FoundFigure, allowed: number[]): boolean {
  const { value, writtenDigits } = figure;
  for (const a of allowed) {
    if (value === a) return true;
    // only a genuinely abbreviated figure earns the rounding allowance
    if (writtenDigits <= 3 && roundToSigFigs(a, writtenDigits) === value) return true;
  }
  return false;
}

export interface NarrativeFacts {
  /** every money figure the model was handed, in pounds */
  money: number[];
  /** every percentage it was handed, as a number of percent */
  percents: number[];
}

/**
 * Figures in the draft that the engine did not produce.
 *
 * Small integers are ignored: "six to eight weeks", "the twelve months preceding"
 * and a comparable count are prose, not valuation figures, and only money and
 * percentages carry the weight this is protecting.
 */
export function unsupportedFigures(sections: Record<string, string>, facts: NarrativeFacts): string[] {
  const bad: string[] = [];
  for (const [section, text] of Object.entries(sections)) {
    if (typeof text !== 'string') continue;
    for (const f of moneyIn(text)) {
      if (!isSupported(f, facts.money)) bad.push(`${section}: ${f.raw}`);
    }
    for (const f of percentIn(text)) {
      if (!isSupported(f, facts.percents)) bad.push(`${section}: ${f.raw}`);
    }
  }
  return bad;
}

/**
 * Claims in the draft that nothing established.
 *
 * `unsupportedFigures` above exists because "use these figures verbatim" is only
 * an instruction. The same prompt carries a second set of rules — do not state
 * transaction volumes, marketing periods, demand levels or supply of comparable
 * stock; do not declare the evidence base adequate; state the special
 * assumptions exactly as given — and those had no check at all.
 *
 * That gap was invisible because of where the tests run. `narrative-claims.test.ts`
 * asserts all three rules, but the harness sets no ANTHROPIC_API_KEY, so every
 * one of its assertions exercises the DETERMINISTIC TEMPLATE. The model path is
 * the one production takes, and on that path a sentence like "transaction volumes
 * have been stable and marketing periods are typically six to eight weeks"
 * carries no money and no percentage — the figure guard finds nothing to object
 * to, and it prints into a signed valuation.
 *
 * Every claim below was made by this product's own template until 238d265, so
 * these are not hypothetical failure modes; they are the register the report was
 * written in, which is exactly the register a model drafting in that house style
 * will reach for.
 *
 * Sentence-level and negation-aware, because the honest prose has to survive it:
 * the template now SAYS "occupier and investor demand, supply of comparable
 * stock, transaction volumes and marketing periods — have not been assessed in
 * this draft and are for the valuer to state", and naming a gap is the opposite
 * of asserting it.
 */

/** What a sentence looks like when it hands the judgement back rather than making it. */
const DISCLAIMED =
  /\b(?:ha(?:ve|s)\s+not\s+been\s+(?:assessed|measured|investigated|verified|established)|not\s+been\s+assessed|(?:is|are)\s+for\s+the\s+valuer\s+to|for\s+the\s+valuer(?:'|’)?s?\s+(?:own\s+)?(?:judgement|assessment|confirmation)|left?\s+to\s+the\s+valuer|remains?\s+for\s+the\s+valuer)\b/i;

const CLAIMS: Array<{ what: string; re: RegExp }> = [
  /**
   * VPGA 10. "No material valuation uncertainty is reported" is a declaration a
   * valuer makes, not a sentence a drafter supplies; nothing in this product
   * assesses it.
   */
  { what: 'a material valuation uncertainty declaration', re: /\bmaterial\s+valuation\s+uncertainty\b/i },
  { what: 'transaction volumes', re: /\btransaction\s+volumes?\b/i },
  { what: 'marketing periods', re: /\bmarketing\s+period/i },
  { what: 'a level of demand', re: /\bdemand\b/i },
  { what: 'the supply of comparable stock', re: /\bsupply\s+of\b|\bstock\s+(?:is|remains|has\s+been)\b/i },
  {
    what: 'the state of the market',
    re: /\bmarket(?:\s+\w+){0,3}\s+(?:remains?|is|are|has\s+been|have\s+been|continues?\s+to\s+be)\s+(?:active|buoyant|strong|stable|steady|robust|healthy|firm|subdued|weak|soft|liquid|illiquid)\b/i,
  },
  {
    what: 'the adequacy of the evidence base',
    re: /\b(?:adequate|sufficient|ample|comprehensive|robust)\b[^.]{0,40}\b(?:evidence|comparable)|\b(?:evidence|comparables?)\b[^.]{0,40}\b(?:is|are|was|were|considered|deemed|judged)\b[^.]{0,20}\b(?:adequate|sufficient|ample|comprehensive|robust)\b/i,
  },
];

/** Denying a special assumption the signed terms record — measured, and fixed once already. */
const DENIES_SPECIAL_ASSUMPTIONS = /\bno\s+special\s+assumptions?\b/i;

/**
 * Sentences, near enough. A valuation report is plain prose with no abbreviations
 * that matter here, and splitting slightly wrong only ever widens the window a
 * disclaimer is looked for in — which fails safe towards accepting honest prose.
 */
const sentences = (text: string) => text.split(/(?<=[.;])\s+/).filter((s) => s.trim());

export function unsupportedClaims(
  sections: Record<string, string>,
  facts: { specialAssumptions: string | null },
): string[] {
  const bad: string[] = [];
  for (const [section, text] of Object.entries(sections)) {
    if (typeof text !== 'string') continue;
    for (const sentence of sentences(text)) {
      if (DISCLAIMED.test(sentence)) continue;
      for (const { what, re } of CLAIMS) {
        if (re.test(sentence)) bad.push(`${section}: ${what} — "${sentence.trim()}"`);
      }
      /**
       * Only a denial is caught, and only against terms that state one. Asserting
       * a special assumption the terms do not carry is the model inventing an
       * instruction, which the figure guard cannot see either — but the terms are
       * free text, so there is no way to tell an invented one from a faithful
       * paraphrase. Denial is exact, and it is the direction that was measured.
       */
      if (facts.specialAssumptions && DENIES_SPECIAL_ASSUMPTIONS.test(sentence)) {
        bad.push(`${section}: denied a special assumption the terms record — "${sentence.trim()}"`);
      }
    }
  }
  return bad;
}
