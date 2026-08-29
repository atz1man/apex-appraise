/**
 * Fitting a name someone typed into the middle of a sentence.
 *
 * The hero reads "2 days left to return your …" and the policy banner reads
 * "your … is affected", so the item wants to be lower case there. It was done
 * with `toLowerCase()`, which is right for "Wool-blend overcoat" and wrong for
 * everything with a brand or a model number in it: the seeded Currys receipt
 * rendered as "return your jbl tune 770nc headphones", which reads as a typo
 * about a product whose name is the thing the person has to recognise.
 *
 * So only the FIRST word is touched, and only when it looks like an ordinary
 * capitalised word — a leading capital followed by lower case. "Wool-blend"
 * becomes "wool-blend"; "JBL", "iPhone", "No7" and "kMix" are left exactly as
 * they were written, because a word that is not simply Capitalised is carrying
 * information in its case.
 */
/**
 * A leading capital, then nothing but lower case — allowing the hyphens and
 * apostrophes ordinary words carry, and no digits, because a digit inside a
 * word is a model number rather than a word.
 *
 *   Wool-blend  ✓      JBL     ✗ (capitals after the first)
 *   Kenwood     ✓      No7     ✗ (a digit)
 *   Men's       ✓      iPhone  ✗ (does not start capitalised)
 */
const ORDINARY_WORD = /^\p{Lu}[\p{Ll}'’-]*$/u;

export function midSentence(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.split(/\s/, 1)[0];
  if (!first || !ORDINARY_WORD.test(first)) return trimmed;
  return first.toLowerCase() + trimmed.slice(first.length);
}
