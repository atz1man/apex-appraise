import { describe, expect, it } from 'vitest';
import { midSentence } from '../src/lib/words';
import { seedReceipts } from '../src/lib/seed';

describe('fitting an item name into the middle of a sentence', () => {
  it.each([
    ['Wool-blend overcoat', 'Wool-blend overcoat'],
    ['No7 skincare set', 'No7 skincare set'],
    ['JBL Tune 770NC headphones', 'JBL Tune 770NC headphones'],
    ['iPhone 18 Pro', 'iPhone 18 Pro'],
    ['MALM chest of 6 drawers', 'MALM chest of 6 drawers'],
    ['  Wool-blend overcoat  ', 'Wool-blend overcoat'],
    ['', ''],
  ])('renders %j as %j', (given, expected) => {
    expect(midSentence(given)).toBe(expected);
  });

  it('does not lower-case a brand', () => {
    // The rule that used to run here lower-cased the first word when it
    // looked ordinary, which "Kenwood" does — so the hero read "9 days left
    // to return your kenwood kMix stand mixer": a proper noun misspelled, on
    // the one word the reader has to recognise.
    expect(midSentence('Kenwood kMix stand mixer')).toBe('Kenwood kMix stand mixer');
    expect(midSentence('Sony headphones')).toBe('Sony headphones');
  });

  it('leaves every seeded item exactly as it was written', () => {
    // The seed is the copy every first-run screenshot shows.
    for (const r of seedReceipts(new Date(2026, 7, 28))) {
      expect(midSentence(r.item)).toBe(r.item);
    }
  });
});
