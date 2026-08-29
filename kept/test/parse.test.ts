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

  it('takes the most recent past date when several appear and none is announced', () => {
    const p = parse('Apple · £129.00 · 10 Aug, then 12 Aug');
    expect(p.purchasedOn).toBe('2026-08-12');
  });
});

describe('which of an order email’s several dates is the purchase', () => {
  /*
   * An order confirmation carries the order date, an estimated delivery, a
   * dispatch note and a return-by, and only one of them starts the clock this
   * app exists to count. "The most recent past date" read the WRONG one on a
   * perfectly ordinary Currys email — six days late, so the app promised days
   * the shop would not honour, on the single number it has to get right.
   */
  it('prefers a labelled order date over a later estimated delivery', () => {
    const p = parse(`Order date: 18 Aug 2026
      Currys · JBL headphones £89.00
      Order total £92.99
      Estimated delivery: 24 Aug 2026`);
    expect(p.purchasedOn).toBe('2026-08-18');
  });

  it('prefers a labelled order date over a later date with no cue at all', () => {
    /*
     * This is the case the LABEL rule exists for, and the only kind that
     * proves it: deprioritising delivery and dispatch wording is a blocklist,
     * so it can only ever catch phrasings someone thought of. A promotional
     * footer is not one of them, and it is on half the order emails ever sent.
     * Without the label this reads 26 Aug and starts the clock eight days late.
     */
    const p = parse(`Order date: 18 Aug 2026
      Currys · JBL headphones £89.00
      Order total £92.99
      20% off your next one — offer ends 26 Aug 2026`);
    expect(p.purchasedOn).toBe('2026-08-18');
  });

  it.each([
    ['Order date: 18 Aug 2026'],
    ['Ordered on 18 Aug 2026'],
    ['Order placed on 18 Aug 2026'],
    ['Date of order — 18 Aug 2026'],
    ['Purchase date 18 Aug 2026'],
    ['Purchased on 18 Aug 2026'],
  ])('reads the order date from "%s"', (line) => {
    expect(parse(`Currys £89.00\n${line}\nDelivered 24 Aug 2026`).purchasedOn).toBe('2026-08-18');
  });

  it('is not fooled by a return-by date that sits beside the word "order"', () => {
    // The near-miss that rules out matching the bare word: a return deadline
    // read as the purchase date would move the real deadline weeks out.
    const p = parse('Currys £89.00 · bought 18 Aug 2026 · return your order by 26 Aug 2026');
    expect(p.purchasedOn).toBe('2026-08-18');
  });

  it('takes the order over a dispatch date, with neither labelled', () => {
    const p = parse('Apple · £129.00 · 10 Aug, dispatched 12 Aug');
    expect(p.purchasedOn).toBe('2026-08-10');
  });

  it('still uses a delivery date rather than assuming today, when it is all there is', () => {
    // Preference, not a filter. Assuming today would be further from the truth
    // and in the same direction — later than the purchase.
    const p = parse('Currys £89.00 · delivered 24 Aug 2026');
    expect(p.purchasedOn).toBe('2026-08-24');
    expect(p.dateFound).toBe(true);
  });

  it('ignores a labelled order date that is in the future', () => {
    // A purchase that has already happened cannot be dated next month; the
    // label does not make a future date credible.
    const p = parse('Currys £89.00 · 20 Aug 2026 · Order date: 20 Sep 2026');
    expect(p.purchasedOn).toBe('2026-08-20');
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

describe('the day it arrived — read, never guessed', () => {
  it('reads a labelled delivery date', () => {
    const p = parse('John Lewis · Order placed 24 August 2026 · Total £329.00 · Delivered 27 August 2026');
    expect(p.purchasedOn).toBe('2026-08-24');
    expect(p.arrivedOn).toBe('2026-08-27');
  });

  it.each([
    ['delivered on', 'Currys order 10 Aug 2026 · £89.00 · Delivered on 13 Aug 2026'],
    ['arrived', 'Currys order 10 Aug 2026 · £89.00 · Arrived 13 Aug 2026'],
    ['delivery date', 'Currys order 10 Aug 2026 · £89.00 · Delivery date: 13 Aug 2026'],
  ])('recognises "%s"', (_label, text) => {
    expect(parse(text).arrivedOn).toBe('2026-08-13');
  });

  it('says nothing when the paste says nothing', () => {
    expect(parse('Argos · Total £64.99 · 12 Aug 2026').arrivedOn).toBeNull();
  });

  it('never takes an unlabelled date for a delivery', () => {
    // Two dates, neither introduced as an arrival. Guessing here would put a
    // fact in a field the app then treats as one.
    expect(parse('Boots · 5 Aug 2026 · Total £24.98 · see 20 Aug 2026').arrivedOn).toBeNull();
  });

  it('refuses an estimate that has since become the past', () => {
    // "Estimated delivery" is not a day anything landed. Most are in the
    // future and excluded anyway; this is the email read a fortnight late.
    expect(parse('Currys order 5 Aug 2026 · £89.00 · Estimated delivery 12 Aug 2026').arrivedOn).toBeNull();
    expect(parse('Currys order 5 Aug 2026 · £89.00 · Expected delivery 12 Aug 2026').arrivedOn).toBeNull();
  });

  it('refuses a delivery date that has not happened yet', () => {
    expect(parse('Currys order 20 Aug 2026 · £89.00 · Delivered 20 Sept 2026').arrivedOn).toBeNull();
  });

  it('refuses a delivery before the purchase it is attached to', () => {
    // The app rejects that pair when it is typed by hand; it must not put it
    // there itself.
    expect(parse('Currys order placed 20 Aug 2026 · £89.00 · Delivered 12 Aug 2026').arrivedOn).toBeNull();
  });

  it('takes the later of two deliveries, which is the clock that counts', () => {
    const p = parse('ASOS order placed 1 Aug 2026 · £40.00 · Delivered 5 Aug 2026 · redelivered 9 Aug 2026');
    expect(p.arrivedOn).toBe('2026-08-09');
  });

  it('leaves the purchase date alone', () => {
    // The delivery label demotes a date for pickDate and promotes it here:
    // the two must not fight over the same one.
    const p = parse('Zara · order placed 15 Aug 2026 · £34.99 · Delivered 18 Aug 2026');
    expect(p.purchasedOn).toBe('2026-08-15');
    expect(p.arrivedOn).toBe('2026-08-18');
  });
});

describe('the day it was dispatched — a third clock, kept apart', () => {
  it('reads a labelled dispatch date', () => {
    const p = parse('Zara · Order placed 13 Aug 2026 · £34.99 · Dispatched 15 Aug 2026');
    expect(p.purchasedOn).toBe('2026-08-13');
    expect(p.dispatchedOn).toBe('2026-08-15');
  });

  it.each([
    ['dispatched on', 'Zara order 13 Aug 2026 · £34.99 · Dispatched on 15 Aug 2026'],
    ['despatched', 'Zara order 13 Aug 2026 · £34.99 · Despatched 15 Aug 2026'],
    ['shipped', 'Zara order 13 Aug 2026 · £34.99 · Shipped 15 Aug 2026'],
    ['left our warehouse', 'Zara order 13 Aug 2026 · £34.99 · Left our warehouse 15 Aug 2026'],
  ])('recognises "%s"', (_label, text) => {
    expect(parse(text).dispatchedOn).toBe('2026-08-15');
  });

  it('says nothing when the paste says nothing', () => {
    expect(parse('Zara · Total £34.99 · 13 Aug 2026').dispatchedOn).toBeNull();
  });

  it('refuses a promise of dispatch rather than a dispatch', () => {
    expect(parse('Zara order 5 Aug 2026 · £34.99 · Estimated dispatch 12 Aug 2026').dispatchedOn).toBeNull();
  });

  it('refuses one that has not happened yet', () => {
    expect(parse('Zara order 20 Aug 2026 · £34.99 · Dispatched 20 Sept 2026').dispatchedOn).toBeNull();
  });

  it('refuses one before the order it belongs to', () => {
    expect(parse('Zara order placed 20 Aug 2026 · £34.99 · Dispatched 12 Aug 2026').dispatchedOn).toBeNull();
  });

  it('takes the EARLIEST of two, where an arrival takes the latest', () => {
    // A second dispatch is a second parcel or a replacement; the clock the
    // shop is running started when the first one left.
    const p = parse('Zara order 1 Aug 2026 · £34.99 · Dispatched 5 Aug 2026 · dispatched again 9 Aug 2026');
    expect(p.dispatchedOn).toBe('2026-08-05');
  });

  it('keeps the three dates apart', () => {
    // Order, dispatch, delivery: three clocks, three sources, and conflating
    // any two of them is how the app came to state one when it meant another.
    const p = parse('Zara · Order placed 13 Aug 2026 · £34.99 · Dispatched 15 Aug 2026 · Delivered 18 Aug 2026');
    expect(p.purchasedOn).toBe('2026-08-13');
    expect(p.dispatchedOn).toBe('2026-08-15');
    expect(p.arrivedOn).toBe('2026-08-18');
  });
});

describe('date boundaries nothing pinned', () => {
  /*
   * Both found by mutation, and both would have been silent.
   *
   * `d > 31` flipped to `d >= 31` rejects the thirty-first of any month — one
   * purchase date in thirty-one — and every test still passed, because none
   * used one. The real-date check below it (`dt.getDate() === d`) is what
   * catches a 31 April; the first gate is only meant to be cheap.
   *
   * `daysBetween(today, hit.date) <= 0` flipped to `< 0` drops a date equal to
   * today, which is the commonest purchase there is: something bought this
   * morning, added this afternoon.
   */
  it('reads a purchase made on the thirty-first', () => {
    const r = parse('Currys · Order placed 31 July 2026 · Kettle · Total £29.00');
    expect(r.purchasedOn).toBe('2026-07-31');
  });

  it('reads a purchase made on a thirty-first written in numbers', () => {
    const r = parse('Currys · Order placed 31/07/2026 · Kettle · Total £29.00');
    expect(r.purchasedOn).toBe('2026-07-31');
  });

  it('reads a purchase made today, rather than falling back to today', () => {
    // The assertion that discriminates is `dateFound`, not the date. When no
    // date is read the parser uses today anyway — so a receipt bought today
    // gets the right answer either way, and the difference is only whether the
    // app READ it or guessed it. The screen says which, so the flag is the
    // user-visible half and the one worth pinning.
    const r = parse(`Currys · Order placed ${toISODate(TODAY).split('-').reverse().join('/')} · Kettle · Total £29.00`);
    expect(r.purchasedOn).toBe(toISODate(TODAY));
    expect(r.dateFound).toBe(true);
  });
});
