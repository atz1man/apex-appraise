import { daysBetween, startOfDay, toISODate } from './dates';
import { toPence, type Pence } from './money';
import { ALIASES_BY_LENGTH, type StorePolicy } from './stores';

/**
 * The paste parser. Runs entirely on-device — an order email is pasted, read,
 * and the text is discarded; nothing is uploaded to be "understood" by a
 * server. That constraint is the reason this is a set of explicit rules
 * rather than a model call, and it is why every rule below has to be
 * defensible on its own.
 */
export interface ParsedReceipt {
  store: string | null;
  policy: StorePolicy | null;
  amount: Pence | null;
  /** ISO date; falls back to today when the paste carries no readable date. */
  purchasedOn: string;
  /** True when the date was actually found rather than assumed. */
  dateFound: boolean;
  windowDays: number;
}

export type ParseOutcome =
  | { ok: true; value: ParsedReceipt }
  | { ok: false; reason: 'empty' | 'nothing-found' };

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Every £ amount in the text, in order, as pence. */
function amountsIn(text: string): Pence[] {
  const out: Pence[] = [];
  const re = /£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  for (const m of text.matchAll(re)) out.push(toPence(parseFloat(m[1].replace(/,/g, ''))));
  return out;
}

/**
 * The order total, not the first price on the page. An order email lists
 * every line item before it lists the total, so "first £ found" reliably
 * picks a single sock out of a £240 basket. A labelled total wins; failing
 * that the largest figure is the only defensible guess.
 */
function pickAmount(text: string): Pence | null {
  const labelled = /(?:order\s+)?(?:grand\s+)?total[^£\n]{0,40}£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i.exec(text);
  if (labelled) return toPence(parseFloat(labelled[1].replace(/,/g, '')));
  const all = amountsIn(text);
  if (all.length === 0) return null;
  return Math.max(...all);
}

/** A date found in the paste, and where it sat — the position is what lets a
 *  label beside it be read. */
interface DateHit {
  date: Date;
  index: number;
}

/** Candidate dates in the text, with their positions. */
function datesIn(text: string, today: Date): DateHit[] {
  const found: DateHit[] = [];
  const push = (y: number, m: number, d: number, index: number) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return;
    const dt = new Date(y, m, d);
    if (dt.getMonth() === m && dt.getDate() === d) found.push({ date: dt, index });
  };

  // "25 Aug", "25 August 2026", "25th Aug"
  const dmy = /\b(\d{1,2})(?:st|nd|rd|th)?[ .\-/]+([a-z]{3,9})\.?,?(?:[ .\-/]+(\d{2,4}))?\b/gi;
  for (const m of text.matchAll(dmy)) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon === undefined) continue;
    push(resolveYear(m[3], mon, Number(m[1]), today), mon, Number(m[1]), m.index ?? 0);
  }
  // "Aug 25", "August 25, 2026"
  const mdy = /\b([a-z]{3,9})\.?[ .\-/]+(\d{1,2})(?:st|nd|rd|th)?,?(?:[ .\-/]+(\d{2,4}))?\b/gi;
  for (const m of text.matchAll(mdy)) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon === undefined) continue;
    push(resolveYear(m[3], mon, Number(m[2]), today), mon, Number(m[2]), m.index ?? 0);
  }
  // "25/08/2026" — day first. This is a UK app; 05/08 is 5 August, never 8 May.
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const y = Number(m[3]);
    push(y < 100 ? 2000 + y : y, Number(m[2]) - 1, Number(m[1]), m.index ?? 0);
  }
  // ISO
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m.index ?? 0);
  }
  return found;
}

/**
 * A bare "25 Aug" means the most recent 25 August, not one in the future: an
 * order confirmation describes a purchase that has already happened. Reading
 * it as this year when this year is still ahead would start the return clock
 * on a date that has not arrived and report a window months too generous.
 */
function resolveYear(raw: string | undefined, month: number, day: number, today: Date): number {
  if (raw) return raw.length === 2 ? 2000 + Number(raw) : Number(raw);
  const thisYear = new Date(today.getFullYear(), month, day);
  return daysBetween(today, thisYear) > 0 ? today.getFullYear() - 1 : today.getFullYear();
}

/**
 * Phrases that name the day the order was PLACED.
 *
 * Deliberately whole phrases rather than the word "order" alone: an order
 * email is full of dates that sit near that word and mean something else —
 * "return your order by 5 Sept" most dangerously of all.
 */
const ORDER_DATE_LABEL =
  /\b(?:order(?:ed)?\s*date|date\s+order(?:ed)?|date\s+of\s+order|order(?:ed)?\s+(?:on|placed)|order\s+placed(?:\s+on)?|purchase(?:d)?\s*(?:date|on)|bought\s+on)\b/gi;

/** How far after its label a date may sit and still belong to it. */
const LABEL_REACH = 40;

/**
 * Words that introduce a date which is NOT the day of purchase — when the
 * parcel is coming, when it left, by when it has to go back.
 *
 * Applied as a preference rather than a filter: a date introduced by one of
 * these is the LAST thing to fall back on, never something to discard. A
 * delivery date is still evidence about when the order happened, and the
 * alternative fallback — assuming today — is further from the truth and in the
 * same dangerous direction.
 */
const NOT_A_PURCHASE = /\b(?:deliver\w*|arriv\w*|dispatch\w*|ship\w*|expect\w*|estimat\w*|return\w*|collect\w*|due)\b[^\n]{0,24}$/i;

/**
 * The purchase date.
 *
 * A labelled order date wins, exactly as a labelled total does above, and for
 * the same reason: an order confirmation carries several dates and only one of
 * them is the day the thing was bought. Without this the rule was "the most
 * recent date that is not in the future", which on a real Currys email quietly
 * read the ESTIMATED DELIVERY line — six days after the order — and started
 * the return clock there. That is the dangerous direction: the app then
 * promises days the shop will not honour, on the one number it exists to get
 * right.
 *
 * Failing a label, the most recent past date is still the best guess — but not
 * one announced as a delivery, a dispatch or a return-by, which is the same
 * mistake one step quieter: "ordered 10 Aug, dispatched 12 Aug" used to yield
 * the 12th. A future date cannot be a purchase that has already happened, so
 * those are out first whatever introduces them.
 */
function pickDate(text: string, today: Date): Date | null {
  const past = datesIn(text, today)
    .filter((hit) => daysBetween(today, hit.date) <= 0)
    .sort((a, b) => a.index - b.index);
  if (past.length === 0) return null;

  const labels = [...text.matchAll(ORDER_DATE_LABEL)].map((m) => (m.index ?? 0) + m[0].length);
  const labelled = past.find((hit) => labels.some((end) => hit.index >= end && hit.index - end <= LABEL_REACH));
  if (labelled) return labelled.date;

  const newest = (hits: DateHit[]) => hits.reduce((best, hit) => (hit.date > best ? hit.date : best), hits[0].date);
  const plain = past.filter((hit) => !NOT_A_PURCHASE.test(text.slice(Math.max(0, hit.index - 40), hit.index)));
  return newest(plain.length > 0 ? plain : past);
}

/**
 * Words that make a mention of a shop a mention of THE SHOP.
 *
 * An order email says "your Boots order" or "boots.com". Something bought
 * elsewhere says "walking boots". Only the ambiguous names need this — see
 * `commonWord` in stores.ts.
 */
const STORE_CUE = '(?:your|from|at|orders?|receipt|purchased?)';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this text name this shop?
 *
 * On word boundaries, not as a substring: "pineapple print tea towel" was
 * being read as an Apple purchase, and a receipt for a £12 tea towel then
 * carried Apple's 14-day window and Apple's policy sentence.
 *
 * A name that is also an ordinary word needs more than a boundary, because
 * "walking boots" and "next day delivery" clear one comfortably. It has to sit
 * beside something that makes it the shop — the possessive an order email uses
 * about itself, or the shop's own domain. Failing that the parser names no
 * shop at all, which the add screen shows as "Not recognised" against an
 * assumed 28-day window: an assumption the person can see and correct, rather
 * than a wrong retailer they have no reason to doubt.
 */
function mentions(text: string, alias: string, commonWord: boolean): boolean {
  const a = escape(alias);
  if (!commonWord) return new RegExp(`\\b${a}\\b`, 'i').test(text);
  return new RegExp(
    `(?:\\b${STORE_CUE}\\s+${a}\\b|\\b${a}\\s+${STORE_CUE}\\b|\\b${a}\\.(?:com|co\\.uk))`,
    'i',
  ).test(text);
}

function pickStore(text: string): StorePolicy | null {
  // Longest alias first, so a shop whose name contains another's still
  // resolves to itself.
  for (const { alias, store } of ALIASES_BY_LENGTH) {
    if (mentions(text, alias, store.commonWord === true)) return store;
  }
  return null;
}

/** The window used when the shop is not one Kept has verified. */
export const UNKNOWN_STORE_WINDOW_DAYS = 28;

export function parseReceiptText(text: string, today: Date = new Date()): ParseOutcome {
  if (!text.trim()) return { ok: false, reason: 'empty' };

  const policy = pickStore(text);
  const amount = pickAmount(text);
  // Neither a shop nor a price means there is nothing to build a deadline
  // from — better to say so than to save a receipt made of assumptions.
  if (!policy && amount === null) return { ok: false, reason: 'nothing-found' };

  const date = pickDate(text, today);
  return {
    ok: true,
    value: {
      store: policy?.name ?? null,
      policy,
      amount,
      purchasedOn: toISODate(date ?? startOfDay(today)),
      dateFound: date !== null,
      windowDays: policy?.windowDays ?? UNKNOWN_STORE_WINDOW_DAYS,
    },
  };
}
