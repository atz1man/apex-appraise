import { describe, expect, it } from 'vitest';
import { poundsInWords } from './words';

/**
 * The amount in words on a signed valuation.
 *
 * A Red Book report states its Market Value twice on purpose — in figures and
 * in words — for the same reason a cheque does: a misread or altered digit is
 * caught by the words beside it. So the words are not decoration, and a
 * valuation whose two statements of the same figure do not agree, or whose
 * words are not a number at all, is defective on its face.
 *
 * This lived unexported inside a nine-hundred-line page component and had no
 * test. Everything below a billion was right. At a billion it read
 * "Ten hundred million pounds" — `underThousand()` was being handed the
 * millions group, and 1,000 of anything is outside what it can say. Not exotic
 * for this product: a large mixed-use regeneration scheme runs to several
 * billion in GDV.
 */

describe('pounds in words', () => {
  it('writes the ordinary sizes a scheme is valued at', () => {
    expect(poundsInWords(625_000)).toBe('Six hundred and twenty-five thousand pounds');
    expect(poundsInWords(3_150_000)).toBe('Three million one hundred and fifty thousand pounds');
    expect(poundsInWords(4_278_000)).toBe('Four million two hundred and seventy-eight thousand pounds');
    expect(poundsInWords(2_580_480)).toBe('Two million five hundred and eighty thousand four hundred and eighty pounds');
  });

  it('keeps the en-GB "and" before a remainder under a hundred', () => {
    expect(poundsInWords(1_000_005)).toBe('One million and five pounds');
    expect(poundsInWords(1_000_200)).toBe('One million two hundred pounds');
    expect(poundsInWords(999_999)).toBe('Nine hundred and ninety-nine thousand nine hundred and ninety-nine pounds');
  });

  it('says billions, rather than counting them in hundreds of millions', () => {
    expect(poundsInWords(1_000_000_000)).toBe('One billion pounds');
    expect(poundsInWords(1_200_000_000)).toBe('One billion two hundred million pounds');
    expect(poundsInWords(2_500_000_000)).toBe('Two billion five hundred million pounds');
    expect(poundsInWords(1_000_000_005)).toBe('One billion and five pounds');
  });

  it('holds at the boundaries either side of a billion', () => {
    expect(poundsInWords(999_999_999)).toBe(
      'Nine hundred and ninety-nine million nine hundred and ninety-nine thousand nine hundred and ninety-nine pounds',
    );
    expect(poundsInWords(1_000_000_001)).toBe('One billion and one pounds');
  });

  it('never writes a group as a hundred or more of itself', () => {
    /**
     * The shape of the defect, stated as a property rather than a list: no
     * correctly written amount contains "hundred million" preceded by a
     * ten-or-more word, and none contains "thousand thousand" or the like.
     */
    for (let bn = 1; bn <= 40; bn++) {
      const said = poundsInWords(bn * 1_000_000_000 + 1_234_567);
      expect(said, `£${(bn * 1e9).toLocaleString('en-GB')} was written as "${said}"`).toContain('billion');
      expect(said).not.toMatch(/(ten|eleven|twelve|thirteen|twenty|thirty|forty) hundred/);
    }
  });

  it('says something for nothing, and ignores a sign', () => {
    expect(poundsInWords(0)).toBe('Zero pounds');
    expect(poundsInWords(-500)).toBe('Five hundred pounds');
  });

  /**
   * The property the whole thing exists for: the words and the figures on a
   * signed valuation state the same number.
   *
   * `RedBookReport.tsx` prints Market Value as `formatMoneyFull(mv)` and again
   * as `poundsInWords(mv)`. They agree today because both are handed `mv` — and
   * that is exactly the kind of thing that stops being true when somebody edits
   * a nine-hundred-line component. This reads the words back into a number and
   * requires them to match.
   */
  it('reads back as the number it was given', () => {
    const SCALE: Record<string, number> = { billion: 1e9, million: 1e6, thousand: 1e3 };
    const WORD: Record<string, number> = Object.fromEntries([
      ...['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
        'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].map((w, i) => [w, i]),
      ...['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].map((w, i) => [w, (i + 2) * 10]),
    ]);
    const backToNumber = (said: string): number => {
      let total = 0;
      let group = 0;
      for (const token of said.toLowerCase().replace(' pounds', '').split(/[\s-]+/)) {
        if (token === 'and') continue;
        if (token === 'hundred') group *= 100;
        else if (token in SCALE) {
          total += group * SCALE[token]!;
          group = 0;
        } else if (token in WORD) group += WORD[token]!;
        else throw new Error(`unreadable word "${token}" in "${said}"`);
      }
      return total + group;
    };

    for (const v of [0, 1, 99, 625_000, 3_150_000, 4_278_000, 2_580_480, 999_999, 1_000_005,
      1_000_200, 20_000_000, 999_999_999, 1_000_000_000, 1_000_000_001, 2_500_000_000, 12_345_678_901]) {
      const said = poundsInWords(v);
      expect(backToNumber(said), `"${said}" does not read back as £${v.toLocaleString('en-GB')}`).toBe(v);
    }
  });
});
