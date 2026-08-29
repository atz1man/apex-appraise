import { describe, expect, it } from 'vitest';
import { midSentence } from '../src/lib/words';

describe('fitting an item name into the middle of a sentence', () => {
  it.each([
    ['Wool-blend overcoat', 'wool-blend overcoat'],
    ['Headphones', 'headphones'],
    ['No7 skincare set', 'No7 skincare set'],
    ['JBL Tune 770NC headphones', 'JBL Tune 770NC headphones'],
    ['iPhone 18 Pro', 'iPhone 18 Pro'],
    ['kMix stand mixer', 'kMix stand mixer'],
    ['MALM chest of 6 drawers', 'MALM chest of 6 drawers'],
    ['  Wool-blend overcoat  ', 'wool-blend overcoat'],
    ['Men’s walking boots', 'men’s walking boots'],
    ['', ''],
  ])('renders %j as %j', (given, expected) => {
    expect(midSentence(given)).toBe(expected);
  });

  it('leaves every word after the first alone', () => {
    // "Kenwood kMix stand mixer" is the case that rules out a blanket
    // lowercase: the brand is capitalised and the model is not, and both are
    // carrying information.
    expect(midSentence('Kenwood kMix stand mixer')).toBe('kenwood kMix stand mixer');
  });
});
