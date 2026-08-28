import { describe, expect, it } from 'vitest';
import { addDays, toISODate } from '../src/lib/dates';
import { money } from '../src/lib/money';
import { parseReceiptText, UNKNOWN_STORE_WINDOW_DAYS } from '../src/lib/parse';

const TODAY = new Date(2026, 7, 28); // Friday 28 August 2026

function parse(text: string) {
  const out = parseReceiptText(text, TODAY);
  if (!out.ok) throw new Error(`expected a parse, got ${out.reason}`);
  return out.value;
}

describe('rejections', () => {
  it('rejects an empty paste', () => {
    expect(parseReceiptText('   ', TODAY)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a paste with neither a known shop nor a price', () => {
    expect(parseReceiptText('thanks for your order, see you soon', TODAY)).toEqual({ ok: false, reason: 'nothing-found' });
  });

  it('accepts a price with no recognised shop', () => {
    const p = parse('Your order from Some Corner Shop · Total £42.00');
    expect(p.store).toBeNull();
    expect(money(p.amount!)).toBe('£42.00');
    expect(p.windowDays).toBe(UNKNOWN_STORE_WINDOW_DAYS);
  });
});

describe('store matching', () => {
  it('finds the retailer and its verified window', () => {
    const p = parse('Your IKEA order is on its way. Total £199.00');
    expect(p.store).toBe('IKEA');
    expect(p.windowDays).toBe(365);
  });

  it('is case-insensitive', () => {
    expect(parse('currys order total £89').store).toBe('Currys');
  });

  it('prefers the longer alias when two could match', () => {
    // "next" appears inside the sentence too; "john lewis" is the real shop.
    const p = parse('Your John Lewis order — next delivery slot confirmed. Total £120.00');
    expect(p.store).toBe('John Lewis');
  });

  it('carries the retailer gotcha through', () => {
    expect(parse('Zara order dispatched · £34.99').policy?.gotcha).toMatch(/dispatch/i);
  });
});

describe('amount', () => {
  it('takes the labelled total over the line items', () => {
    const p = parse(`ASOS order
      Ribbed vest £12.00
      Cargo trousers £38.00
      Delivery £3.95
      Order total £53.95`);
    expect(money(p.amount!)).toBe('£53.95');
  });

  it('falls back to the largest figure when nothing is labelled', () => {
    const p = parse('Currys · £12.00 · £89.00 · £4.99');
    expect(money(p.amount!)).toBe('£89.00');
  });

  it('reads thousands separators', () => {
    expect(money(parse('Apple order total £1,299.00').amount!)).toBe('£1,299.00');
  });

  it('reads a whole-pound amount with no decimals', () => {
    expect(money(parse('Argos total £64').amount!)).toBe('£64.00');
  });
});

describe('purchase date', () => {
  it('reads "25 Aug" as this year when that is in the past', () => {
    expect(parse('Apple order · Total £129.00 · 25 Aug').purchasedOn).toBe('2026-08-25');
  });

  it('reads a bare month-day still ahead of us as last year', () => {
    // An order confirmation describes a purchase that already happened;
    // reading "5 Dec" as this coming December would invent a future receipt.
    expect(parse('Boots order · £24.98 · 5 Dec').purchasedOn).toBe('2025-12-05');
  });

  it('reads day-first slashes, as the UK writes them', () => {
    expect(parse('Argos · £64.99 · 05/08/2026').purchasedOn).toBe('2026-08-05');
  });

  it('reads an explicit year', () => {
    expect(parse('IKEA · £199.00 · 14 February 2026').purchasedOn).toBe('2026-02-14');
  });

  it('reads an ISO date', () => {
    expect(parse('Uniqlo · £39.90 · 2026-07-02').purchasedOn).toBe('2026-07-02');
  });

  it('ignores a delivery date in the future and keeps the order date', () => {
    const p = parse('Currys order placed 20 Aug · £89.00 · arriving 2 Sep');
    expect(p.purchasedOn).toBe('2026-08-20');
  });

  it('falls back to today and says so when no date is readable', () => {
    const p = parse('Boots order confirmation. Total £24.98');
    expect(p.purchasedOn).toBe(toISODate(TODAY));
    expect(p.dateFound).toBe(false);
  });

  it('takes the most recent past date when several appear', () => {
    const p = parse('Apple · £129.00 · ordered 10 Aug, dispatched 12 Aug');
    expect(p.purchasedOn).toBe('2026-08-12');
  });
});

describe('a whole realistic email', () => {
  it('lands the store, total, date and window together', () => {
    const p = parse(`From: Zara <no-reply@zara.com>
      Subject: Your order has been dispatched

      Hi — your order placed on 15 Aug 2026 is on its way.

      Wool-blend overcoat   £34.99
      Delivery              £0.00
      Total                 £34.99`);
    expect(p.store).toBe('Zara');
    expect(money(p.amount!)).toBe('£34.99');
    expect(p.purchasedOn).toBe('2026-08-15');
    expect(p.windowDays).toBe(30);
    expect(toISODate(addDays(new Date(2026, 7, 15), p.windowDays))).toBe('2026-09-14');
  });
});
