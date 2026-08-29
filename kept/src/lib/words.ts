/**
 * Fitting a name someone typed into the middle of a sentence.
 *
 * The hero reads "9 days left to return your …" and the policy banner reads
 * "your … is affected", so the item wants to be lower case there. This did it
 * — carefully, it seemed: only the FIRST word, and only when that word looked
 * ordinary (a leading capital, then nothing but lower case), so "JBL", "No7",
 * "iPhone" and "kMix" were left alone because a word that is not simply
 * Capitalised is carrying information in its case.
 *
 * Read on the screen, the hero said:
 *
 *     9 days left to return your kenwood kMix stand mixer
 *
 * "Kenwood" is simply Capitalised and is also a brand, and the rule cannot
 * tell those apart — nor could any version of it: "Sony headphones", "Nike
 * trainers", "Adidas hoodie" are all a Capitalised proper noun followed by an
 * ordinary word, structurally identical to "Wool-blend overcoat". The
 * information is not in the string.
 *
 * So the transformation is gone, because the two mistakes are not the same
 * size. Leaving "Wool-blend overcoat" capitalised mid-sentence is at worst
 * inelegant, and it is the person's own text read back to them. Lower-casing
 * "Kenwood" is wrong — a proper noun spelled incorrectly, on the one word the
 * reader has to recognise, which is the exact fault the old rule was written
 * to prevent and then committed itself in the case it could not see.
 *
 * The function stays, rather than every caller learning to trim: the callers
 * are placing user text mid-sentence and that is a thing worth naming.
 */
export function midSentence(name: string): string {
  return name.trim();
}
