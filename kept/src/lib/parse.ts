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

/** Candidate dates in the text, in the order they appear. */
function datesIn(text: string, today: Date): Date[] {
  const found: Date[] = [];
  const push = (y: number, m: number, d: number) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return;
    const dt = new Date(y, m, d);
    if (dt.getMonth() === m && dt.getDate() === d) found.push(dt);
  };

  // "25 Aug", "25 August 2026", "25th Aug"
  const dmy = /\b(\d{1,2})(?:st|nd|rd|th)?[ .\-/]+([a-z]{3,9})\.?,?(?:[ .\-/]+(\d{2,4}))?\b/gi;
  for (const m of text.matchAll(dmy)) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon === undefined) continue;
    push(resolveYear(m[3], mon, Number(m[1]), today), mon, Number(m[1]));
  }
  // "Aug 25", "August 25, 2026"
  const mdy = /\b([a-z]{3,9})\.?[ .\-/]+(\d{1,2})(?:st|nd|rd|th)?,?(?:[ .\-/]+(\d{2,4}))?\b/gi;
  for (const m of text.matchAll(mdy)) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon === undefined) continue;
    push(resolveYear(m[3], mon, Number(m[2]), today), mon, Number(m[2]));
  }
  // "25/08/2026" — day first. This is a UK app; 05/08 is 5 August, never 8 May.
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const y = Number(m[3]);
    push(y < 100 ? 2000 + y : y, Number(m[2]) - 1, Number(m[1]));
  }
  // ISO
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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

/** The purchase date: the most recent candidate that is not in the future. */
function pickDate(text: string, today: Date): Date | null {
  const past = datesIn(text, today).filter((d) => daysBetween(today, d) <= 0);
  if (past.length === 0) return null;
  return past.reduce((best, d) => (d > best ? d : best));
}

function pickStore(text: string): StorePolicy | null {
  const low = text.toLowerCase();
  for (const { alias, store } of ALIASES_BY_LENGTH) if (low.includes(alias)) return store;
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
