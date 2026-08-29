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
