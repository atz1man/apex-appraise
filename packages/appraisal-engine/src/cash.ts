/**
 * Cash against the ledger.
 *
 * Three different numbers get called "spend" on a development, and confusing them
 * is how monitoring goes wrong:
 *
 *   COMMITTED — what suppliers have invoiced. It is what the accounting system
 *   knows, and it can sit unpaid for months.
 *   PAID — what has actually left the bank. It is what the borrower has really
 *   funded, and it is never larger than committed unless something is being paid
 *   without an invoice, which is itself the finding.
 *   DRAWN — what the lender has actually advanced. Until a bank feed exists this
 *   is guessed at from committed spend, which is a proxy a lender will not accept
 *   for long.
 *
 * Nothing here decides what a payment IS. A credit on a development account might
 * be a facility drawdown, an equity injection or a sale receipt, and only the firm
 * knows which — so only transactions somebody has classified are counted. An
 * unclassified credit is reported as unclassified, never quietly booked as a
 * drawdown that would flatter or damn the position.
 */

export type CashClassification = 'unclassified' | 'drawdown' | 'equity' | 'receipt' | 'cost';

export interface CashTransaction {
  /** pence, signed — negative is money out */
  amount: number;
  classification: CashClassification;
}

export interface CashReconciliation {
  committed: number;
  paid: number;
  /** invoiced and not yet paid — a payables position, not an overspend */
  invoicedUnpaid: number;
  /** paid beyond what was invoiced — money out with no bill behind it */
  paidUnbilled: number;
  /** advanced by the lender, from transactions somebody has classified */
  drawn: number;
  /** money in that nobody has said what it is */
  unclassifiedIn: number;
  /**
   * Where `drawn` came from. The funding pack says which, because a figure
   * derived from invoices and one taken from a bank statement do not deserve the
   * same confidence.
   */
  drawnSource: 'bank' | 'committed';
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

export function reconcileCash(input: {
  /** from the accounting system, in pounds */
  committed: number;
  /** the deal's bank transactions; omit when no account is mapped */
  transactions?: CashTransaction[];
}): CashReconciliation {
  const txs = input.transactions ?? [];
  const hasFeed = txs.length > 0;

  // money out, as a positive figure — a statement's signs are not a reader's
  const paid = sum(txs.filter((t) => t.amount < 0).map((t) => -t.amount)) / 100;
  const drawnFromBank = sum(txs.filter((t) => t.amount > 0 && t.classification === 'drawdown').map((t) => t.amount)) / 100;
  const unclassifiedIn = sum(txs.filter((t) => t.amount > 0 && t.classification === 'unclassified').map((t) => t.amount)) / 100;

  /**
   * Without a feed, the old proxy stands — and says so. Falling back silently
   * would make a pack sourced from invoices indistinguishable from one sourced
   * from a bank, which is precisely the distinction a lender is paying for.
   */
  const drawnSource: 'bank' | 'committed' = hasFeed ? 'bank' : 'committed';
  const drawn = hasFeed ? drawnFromBank : input.committed;

  return {
    committed: input.committed,
    paid,
    invoicedUnpaid: Math.max(0, input.committed - paid),
    paidUnbilled: Math.max(0, paid - input.committed),
    drawn,
    unclassifiedIn,
    drawnSource,
  };
}
