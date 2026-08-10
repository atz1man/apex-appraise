import { describe, expect, it } from 'vitest';
import { reconcileCash, type CashTransaction } from '../src/index.js';

const tx = (amountPounds: number, classification: CashTransaction['classification'] = 'unclassified'): CashTransaction => ({
  amount: Math.round(amountPounds * 100),
  classification,
});

describe('reconcileCash', () => {
  it('falls back to the invoice proxy when there is no bank feed, and says so', () => {
    /**
     * The important half. Without a feed the old behaviour stands — but the pack
     * must be able to tell a reader that "drawn" came from invoices rather than
     * from a bank statement, because those do not deserve equal confidence.
     */
    const r = reconcileCash({ committed: 1_000_000 });
    expect(r.drawn).toBe(1_000_000);
    expect(r.drawnSource).toBe('committed');
    expect(r.paid).toBe(0);
  });

  it('prefers the bank once a feed exists', () => {
    const r = reconcileCash({
      committed: 1_000_000,
      transactions: [tx(-400_000), tx(600_000, 'drawdown')],
    });
    expect(r.drawnSource).toBe('bank');
    expect(r.drawn).toBe(600_000);
    expect(r.paid).toBe(400_000);
  });

  it('separates invoiced-but-unpaid from paid-without-a-bill', () => {
    // a payables position, not an overspend
    const behind = reconcileCash({ committed: 900_000, transactions: [tx(-500_000)] });
    expect(behind.invoicedUnpaid).toBe(400_000);
    expect(behind.paidUnbilled).toBe(0);

    // money out with no invoice behind it — that IS a finding
    const ahead = reconcileCash({ committed: 300_000, transactions: [tx(-500_000)] });
    expect(ahead.paidUnbilled).toBe(200_000);
    expect(ahead.invoicedUnpaid).toBe(0);
  });

  it('never books an unclassified credit as a drawdown', () => {
    /**
     * A credit on a development account might be the facility, an equity
     * injection or a sale receipt. Guessing would either flatter or damn the
     * position, and only the firm knows which it is.
     */
    const r = reconcileCash({
      committed: 500_000,
      transactions: [tx(250_000), tx(100_000, 'equity'), tx(75_000, 'receipt'), tx(200_000, 'drawdown')],
    });
    expect(r.drawn).toBe(200_000);
    expect(r.unclassifiedIn).toBe(250_000);
  });

  it('reads a statement’s signs so the reader does not have to', () => {
    const r = reconcileCash({ committed: 0, transactions: [tx(-1_000), tx(-2_500)] });
    // money out is reported as a positive figure
    expect(r.paid).toBe(3_500);
  });

  it('handles an account with movement but nothing spent', () => {
    const r = reconcileCash({ committed: 0, transactions: [tx(50_000, 'drawdown')] });
    expect(r).toMatchObject({ paid: 0, drawn: 50_000, invoicedUnpaid: 0, paidUnbilled: 0, drawnSource: 'bank' });
  });
});
