import type { Pence } from './money';

export interface Warranty {
  /** Quoted the way manufacturers quote them: 12, 24, 120 months. */
  months: number;
  /** Anything the months cannot say — "10-year guarantee on MALM frames". */
  note?: string;
}

export type Category = 'audio' | 'kitchen' | 'clothing' | 'beauty' | 'furniture' | 'other';

export type ReceiptStatus = 'active' | 'returned';

/**
 * What the app persists per receipt.
 *
 * Dates are stored, never day-counts. The prototype carried `offset: 2` —
 * "two days left" frozen at design time — which is correct for exactly one
 * day and then quietly wrong forever. Everything a screen shows (days left,
 * deadline, elapsed) is derived from `purchasedOn` at read time, so a phone
 * left in a drawer for a week reopens telling the truth.
 */
export interface Receipt {
  id: string;
  store: string;
  item: string;
  cat: Category;
  /** Integer pence. */
  amount: Pence;
  /** ISO calendar date the item was bought. */
  purchasedOn: string;
  /**
   * ISO date the retailer's clock actually starts, when it is not the
   * purchase date. Zara counts from dispatch; this is the field that makes
   * that gotcha a computation rather than a sentence.
   */
  windowStartsOn?: string;
  windowDays: number;
  /**
   * ISO date the goods came into the buyer's hands, when that is known and is
   * not the purchase date.
   *
   * Both statutory clocks legally start here — the 30-day right to reject and
   * the 14-day right to cancel — and for a delivered order that is not the day
   * it was paid for. Without it the app can only say "at least until", because
   * what it computes from the order date is the EARLIEST either right could
   * end; with it the dates are exact.
   *
   * Optional and stays optional. Nobody should have to fill in a field to use
   * a receipt, an order that has not arrived yet genuinely has no such date,
   * and a counter purchase arrives when it is bought. Distinct from
   * `windowStartsOn`, which is the RETAILER's clock (Zara counts from
   * dispatch); these are different rules from different sources and conflating
   * them is how the app came to state one when it meant the other.
   */
  arrivedOn?: string;
  policy: string;
  /**
   * Whether this was a DISTANCE purchase — ordered online, by phone, or away
   * from the trader's premises.
   *
   * It is a property of how the thing was bought, not a number of days,
   * because the two statutory rights are not alternatives. The 30-day right to
   * reject faulty goods (Consumer Rights Act 2015 s.22) applies to every
   * purchase; the 14-day right to cancel for any reason (Consumer Contracts
   * Regulations 2013) applies ONLY on top of it, and only to a distance or
   * off-premises contract. The field this replaced was `legalDays: 14 | 30`,
   * which made them exclusive and so could only ever state one — see legal.ts.
   */
  distance: boolean;
  /**
   * A tracked clock, not a sentence. "Warranty clocks added to your receipts
   * automatically" was the claim; a free-text string could not answer the
   * question the claim implies — is the repair still free today?
   */
  warranty?: Warranty;
  gotcha?: string;
  status: ReceiptStatus;
  /** ISO date the refund landed — set when the receipt is marked returned. */
  returnedOn?: string;
  /**
   * True for the five receipts a fresh install arrives with.
   *
   * They exist so a first launch is a working app rather than an empty list,
   * and they were being charged for: the free tier is ten receipts, the demo
   * set is five of them, so someone who had added nothing at all opened
   * Settings to "5 of 10 free receipts" and hit "That's your 10 free
   * receipts" after adding five of their own. Half the allowance went on
   * data they never entered, and the wall it produced asked them for money.
   *
   * A flag rather than an id prefix, because "this is demo data" is a fact
   * about the receipt and should be legible as one — including in an exported
   * backup, which is why it survives the round trip.
   */
  demo?: boolean;
}

export interface PolicyUpdate {
  id: string;
  store: string;
  /** ISO date the change was published; the "2d ago" label is derived. */
  changedOn: string;
  text: string;
  /** Only the receipts the user actually holds decide this at render time. */
  affectsStores: string[];
  affectNote: string;
  /**
   * The retailer's window AFTER the change, when the change moved it. Used to
   * tell someone what a change would have meant — never to rewrite a receipt
   * they already hold, which keeps the terms it was bought under.
   */
  newWindowDays?: number;
}

export type Screen = 'onboard' | 'home' | 'watch' | 'detail' | 'edit' | 'add' | 'settings' | 'celebrate';
