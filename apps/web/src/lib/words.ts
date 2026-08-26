/**
 * An amount of money written out in words.
 *
 * A Red Book report states its Market Value twice — in figures and in words —
 * for the reason a cheque does: a misread or altered digit is caught by the
 * words beside it. The words are not decoration, and a valuation whose two
 * statements of the same figure disagree is defective on its face.
 *
 * Lived unexported inside `RedBookReport.tsx` with no test of its own. See
 * `words.test.ts` for what that cost.
 */

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0–999 only. Anything larger belongs to the group above it. */
function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const tail = r === 0 ? '' : r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`;
  if (h === 0) return tail;
  return tail ? `${ONES[h]} hundred and ${tail}` : `${ONES[h]} hundred`;
}

/**
 * £625,000 → "Six hundred and twenty-five thousand pounds" (en-GB style).
 *
 * Grouped in billions, millions, thousands and units. The billions group is
 * what this function was missing: the millions group was being handed the whole
 * of everything above a million, so £1,000,000,000 asked `underThousand(1000)`
 * for a word and got "ten hundred" — a signed valuation reading
 * "Ten hundred million pounds". Below a billion every figure was already right,
 * which is why nothing had noticed.
 */
export function poundsInWords(pounds: number): string {
  const v = Math.round(Math.abs(pounds));
  if (v === 0) return 'Zero pounds';
  const bn = Math.floor(v / 1e9);
  const m = Math.floor((v % 1e9) / 1e6);
  const t = Math.floor((v % 1e6) / 1e3);
  const u = v % 1e3;
  const parts: string[] = [];
  if (bn) parts.push(`${underThousand(bn)} billion`);
  if (m) parts.push(`${underThousand(m)} million`);
  if (t) parts.push(`${underThousand(t)} thousand`);
  // en-GB puts "and" before a remainder under a hundred, but only when
  // something larger has already been said
  if (u) parts.push(bn || m || t ? (u < 100 ? `and ${underThousand(u)}` : underThousand(u)) : underThousand(u));
  const s = `${parts.join(' ')} pounds`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
