import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engine from '@apex/appraisal-engine';

/**
 * A figure the marketing page says this product COMPUTES, something computes.
 *
 * `Landing.tsx` listed "CIL, S106, SDLT & VAT computed, not guessed". Three of
 * those are true: `cilCharge` and `sdltCommercial` are in the engine and S106 is
 * carried as a stated input. Nothing anywhere computes VAT — there is no VAT in
 * the engine at all — and the appraisal screen's own row said "Opted — neutral",
 * which is not a missing figure but a substantive professional assertion: it says
 * the scheme has opted to tax and VAT is therefore cash-neutral. For new-build
 * residential, which is zero-rated and cannot be opted, that is usually wrong.
 *
 * "Computed, not guessed" is the strongest claim on that page and the one a buyer
 * would check, so it is the one worth tying to a symbol. Each named quantity maps
 * to the engine export that performs it, and the test asserts both directions: the
 * exports exist, and the page names nothing the table does not cover.
 *
 * NOT a general prose check, and it could not be: no matcher reads a marketing
 * sentence and decides whether the product keeps its promise. What it does is make
 * ADDING a name to that list a two-line change — the copy, and the function that
 * justifies it — which is exactly the step that was skipped.
 */

const LANDING = readFileSync(join(__dirname, '..', 'routes', 'Landing.tsx'), 'utf8');

/**
 * The claim line, and what keeps it.
 *
 * `null` means "not a single engine export": S106 is a figure the valuer states
 * and the engine carries into the residual rather than deriving, which is a
 * different kind of "not guessed" — it comes from the planning agreement — and
 * saying so here is the point of the column.
 */
const COMPUTED: Array<{ name: string; by: keyof typeof engine | null; note?: string }> = [
  { name: 'CIL', by: 'cilCharge' },
  { name: 'SDLT', by: 'sdltCommercial' },
  { name: 'S106', by: null, note: 'a figure stated in the planning agreement, carried into the residual as an input' },
];

/** The one sentence under test, read out of the real page. */
const claimLine = (): string => {
  const m = LANDING.match(/'([^']*computed, not guessed)'/);
  expect(m, 'the "computed, not guessed" claim has moved or been reworded').toBeTruthy();
  return m![1]!;
};

describe('the marketing page claims no computation this product does not perform', () => {
  it('finds the claim, from the real page', () => {
    expect(claimLine()).toMatch(/computed, not guessed$/);
  });

  it('names something that computes each figure, or says why there is no function', () => {
    for (const c of COMPUTED) {
      if (c.by) {
        expect(typeof (engine as Record<string, unknown>)[c.by], `${c.name} claims ${c.by}, which the engine does not export`).toBe(
          'function',
        );
      } else {
        expect(c.note?.length, `${c.name} has no function and no reason written down`).toBeGreaterThan(30);
      }
    }
  });

  /**
   * The direction that caught VAT. Every quantity the sentence names has to be in
   * the table — so putting VAT back means either naming the function that computes
   * it or writing down why there is none, and neither can be done quietly.
   */
  it('names nothing the table does not cover', () => {
    const line = claimLine();
    const named = line
      .replace(/computed, not guessed/, '')
      .split(/[,&]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const known = new Set(COMPUTED.map((c) => c.name));
    const unbacked = named.filter((n) => !known.has(n));
    expect(
      unbacked,
      'the page claims these are computed and nothing in the table says what computes them. VAT was one: '
        + 'modelling it properly means zero-rated new residential, standard-rated commercial, the option to tax, '
        + 'partial exemption and the capital goods scheme — and a VAT figure computed wrongly under a signature is '
        + `worse than none.\n  ${unbacked.join(', ')}`,
    ).toEqual([]);
    expect(named.length, 'the sentence parsed to nothing, so this proves nothing').toBeGreaterThanOrEqual(3);
  });

  /** And VAT is not asserted as settled anywhere a valuer reads a figure. */
  it('does not state a VAT treatment the firm never entered', () => {
    const auto = readFileSync(join(__dirname, '..', 'routes', 'AutoAppraisal.tsx'), 'utf8');
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
    expect(
      strip(auto),
      'the appraisal asserted a VAT position: "Opted — neutral" says the scheme has opted to tax and VAT is '
        + 'cash-neutral, which for zero-rated new-build residential is usually wrong',
    ).not.toMatch(/Opted\s*—\s*neutral/);
    // and it does say what IS true, so the row was not simply deleted
    expect(strip(auto)).toMatch(/Not modelled — figures are net of VAT/);
  });

  /**
   * Finds what it is meant to be sweeping: run the same parse over the sentence
   * as it stood, where VAT is named and nothing backs it.
   */
  it('names VAT when the old sentence is put back', () => {
    const old = 'CIL, S106, SDLT & VAT computed, not guessed';
    const named = old
      .replace(/computed, not guessed/, '')
      .split(/[,&]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const known = new Set(COMPUTED.map((c) => c.name));
    expect(named.filter((n) => !known.has(n))).toEqual(['VAT']);
  });
});
