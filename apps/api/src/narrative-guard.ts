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

/** Money written as £8,575,000, £8.6m, £205 or £205/ft². */
const MONEY = /£\s?([\d,]+(?:\.\d+)?)\s?(m|bn|k)?/gi;
/** Percentages, including "20.4% on cost". */
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;

const MULTIPLIER: Record<string, number> = { k: 1_000, m: 1_000_000, bn: 1_000_000_000 };

export interface FoundFigure {
  /** as written, for the message a human reads */
  raw: string;
  value: number;
}

export function moneyIn(text: string): FoundFigure[] {
  const out: FoundFigure[] = [];
  for (const m of text.matchAll(MONEY)) {
    const digits = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(digits)) continue;
    const suffix = m[2]?.toLowerCase();
    out.push({ raw: m[0].trim(), value: digits * (suffix ? (MULTIPLIER[suffix] ?? 1) : 1) });
  }
  return out;
}

export function percentIn(text: string): FoundFigure[] {
  const out: FoundFigure[] = [];
  for (const m of text.matchAll(PERCENT)) {
    const v = Number(m[1]!);
    if (Number.isFinite(v)) out.push({ raw: m[0].trim(), value: v });
  }
  return out;
}

const significantDigits = (n: number) => {
  const s = String(Math.abs(n)).replace(/[.,]/g, '').replace(/0+$/, '');
  return Math.max(1, s.length);
};

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
 */
function isSupported(value: number, allowed: number[]): boolean {
  for (const a of allowed) {
    if (value === a) return true;
    const digits = significantDigits(value);
    // only a genuinely abbreviated figure earns the rounding allowance
    if (digits <= 3 && roundToSigFigs(a, digits) === value) return true;
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
      if (!isSupported(f.value, facts.money)) bad.push(`${section}: ${f.raw}`);
    }
    for (const f of percentIn(text)) {
      if (!isSupported(f.value, facts.percents)) bad.push(`${section}: ${f.raw}`);
    }
  }
  return bad;
}
