import { describe, expect, it } from 'vitest';
import { addDays, toISODate } from '../src/lib/dates';
import { legalRights, type LegalRight } from '../src/lib/legal';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);
const ago = (n: number) => toISODate(addDays(TODAY, -n));

/** Ordered online, so it carries both rights. */
const online: Receipt = {
  id: 'r', store: 'Zara', item: 'Coat', cat: 'clothing', amount: toPence(34.99),
  purchasedOn: ago(5), windowDays: 30, policy: 'p', distance: true, status: 'active',
};
/** The same purchase made over a counter, which carries only one. */
const inStore: Receipt = { ...online, store: 'Boots', distance: false };

const chips = (rs: LegalRight[]) => rs.map((r) => r.chip);
const find = (rs: LegalRight[], chip: string) => rs.find((r) => r.chip === chip)!;

describe('which rights a purchase carries', () => {
  it('gives a distance purchase both, not a choice between them', () => {
    // The bug this replaced: `legalDays: 14 | 30` made them exclusive, so a
    // receipt showing the cooling-off period never mentioned the 30-day right
    // to reject faulty goods that it also had.
    expect(chips(legalRights(online, TODAY, true))).toEqual(['Consumer Contracts Regs', 'Consumer Rights Act']);
  });

  it('never claims a cooling-off period for something bought in a shop', () => {
    // The Consumer Contracts Regulations cover distance and off-premises
    // contracts only. Stating it over a counter sends someone to be refused.
    const rights = legalRights(inStore, TODAY, true);
    expect(chips(rights)).toEqual(['Consumer Rights Act']);
    expect(rights.map((r) => r.body).join(' ')).not.toMatch(/cooling-off/i);
  });

  it('states the 30-day right for a shop purchase, which does carry it', () => {
    const r = legalRights(inStore, TODAY, true)[0];
    expect(r.live).toBe(true);
    expect(r.body).toContain('25 days left');
    expect(r.body).toContain('wherever you bought it');
  });

  it('leads with the stronger right while it is live, and steps back once it is not', () => {
    expect(chips(legalRights({ ...online, purchasedOn: ago(20) }, TODAY, true)))
      .toEqual(['Consumer Rights Act', 'Consumer Contracts Regs']);
  });
});

describe('the cooling-off clock', () => {
  const coolingOff = (r: Receipt, storeOpen = true) => find(legalRights(r, TODAY, storeOpen), 'Consumer Contracts Regs');

  it('does not tell you a right you still hold has ended', () => {
    // The prototype's wording was inverted here: a live 14-day cooling-off
    // period rendered as "ended". That is the one thing this screen must
    // never say, so it gets its own test.
    const r = coolingOff(online);
    expect(r.live).toBe(true);
    expect(r.body).not.toMatch(/passed|ended/i);
    expect(r.body).toContain('9 days left');
  });

  it('uses the singular on the last day', () => {
    expect(coolingOff({ ...online, purchasedOn: ago(13) }).body).toContain('1 day left');
  });

  it('is still live on the final day, not the day before', () => {
    expect(coolingOff({ ...online, purchasedOn: ago(14) }).live).toBe(true);
    expect(coolingOff({ ...online, purchasedOn: ago(15) }).live).toBe(false);
  });

  it('points at the shop window when cooling-off has run out but the shop has not', () => {
    const r = coolingOff({ ...online, purchasedOn: ago(20) });
    expect(r.live).toBe(false);
    expect(r.body).toContain('shop’s own window above is still open');
  });

  it('does not claim an open shop window when there is none', () => {
    const r = coolingOff({ ...online, purchasedOn: ago(20) }, false);
    expect(r.body).not.toContain('still open');
    // It points at the rights above rather than repeating them, because the
    // 30-day one is on the same screen and may still be live.
    expect(r.body).toContain('rights above');
  });
});

describe('what the clocks are counted from', () => {
  // Both rights legally start the day the goods arrive, not the day they are
  // paid for. On a counter purchase that is the same day. On a delivered one
  // the app does not know it, so what it computes is the EARLIEST the right
  // could end — and it has to say so rather than assert a date it cannot know.
  const bodies = (r: Receipt, storeOpen = true) => legalRights(r, TODAY, storeOpen).map((x) => x.body).join(' ');

  it('is exact for a counter purchase, and does not hedge about a parcel', () => {
    const text = bodies(inStore);
    expect(text).toContain('ends ');
    expect(text).not.toMatch(/arrived|at least/);
  });

  it('gives a delivered purchase the earliest date, not a definite one', () => {
    const text = bodies(online);
    expect(text).toContain('at least until');
    expect(text).toContain('starts the day it arrived');
  });

  it.each(['Consumer Rights Act', 'Consumer Contracts Regs'])(
    'never flatly says a lapsed %s right has expired on a date it cannot know',
    (chip) => {
      // The same failure as the inverted cooling-off wording, one step along:
      // counted from the order, both clocks read as run out on a day the
      // parcel may not even have arrived. Asserted per right, because the two
      // strings are built separately and one satisfying it says nothing about
      // the other.
      const body = find(legalRights({ ...online, purchasedOn: ago(40) }, TODAY, true), chip).body;
      expect(body).toContain('Counting from your order');
      expect(body).toContain('check that date');
    },
  );

  it('still says so plainly for a counter purchase, where the date is known', () => {
    const lapsed = bodies({ ...inStore, purchasedOn: ago(40) });
    expect(lapsed).toContain('has passed');
    expect(lapsed).not.toContain('Counting from your order');
  });
});

describe('once the day it arrived is known', () => {
  /*
   * Both clocks legally start when the goods reach you. Without that date the
   * app computes from the order and says so — "at least until", and a lapsed
   * right points at the arrival date rather than declaring itself gone.
   * Given it, the dates are simply right, and the hedging goes away.
   */
  const arrived = (n: number) => ({ ...online, arrivedOn: ago(n) });

  it('states the dates plainly instead of as a floor', () => {
    const text = legalRights(arrived(3), TODAY, true).map((r) => r.body).join(' ');
    expect(text).not.toContain('at least until');
    expect(text).not.toContain('Counting from your order');
    expect(text).toContain('the day it arrived');
  });

  it('counts the cooling-off from arrival, not from the order', () => {
    // Ordered 5 days ago, landed 3 days ago: 11 days of cooling-off left, not 9.
    const r = find(legalRights(arrived(3), TODAY, true), 'Consumer Contracts Regs');
    expect(r.body).toContain('11 days left');
    expect(r.live).toBe(true);
  });

  it('counts the 30-day right from arrival too', () => {
    expect(find(legalRights(arrived(3), TODAY, true), 'Consumer Rights Act').body).toContain('27 days left');
  });

  it('can keep a right alive that the order date said had gone', () => {
    // Ordered 20 days ago — the cooling-off reads as run out. It arrived 8
    // days ago, so there are 6 days of it left, and the app was telling this
    // person to stop trying.
    const late = { ...online, purchasedOn: ago(20), arrivedOn: ago(8) };
    const r = find(legalRights(late, TODAY, true), 'Consumer Contracts Regs');
    expect(r.live).toBe(true);
    expect(r.body).toContain('6 days left');
  });

  it('says a lapsed right has lapsed, once it can be sure', () => {
    const r = find(legalRights({ ...online, purchasedOn: ago(30), arrivedOn: ago(20) }, TODAY, false), 'Consumer Contracts Regs');
    expect(r.live).toBe(false);
    expect(r.body).toContain('counting from the day it arrived');
    expect(r.body).not.toContain('check that date');
  });

  it('is not asked of a counter purchase, which arrives when it is bought', () => {
    const text = legalRights(inStore, TODAY, true).map((r) => r.body).join(' ');
    expect(text).not.toMatch(/arrived|at least/);
  });
});

describe('the 30-day right to reject faulty goods', () => {
  const reject = (r: Receipt) => find(legalRights(r, TODAY, true), 'Consumer Rights Act');

  it('counts from purchase', () => {
    expect(reject({ ...online, purchasedOn: ago(10) }).body).toContain('20 days left');
  });

  it('runs its own 30 days on a distance purchase, outliving the cooling-off', () => {
    // Day 20: cancelling for any reason has gone, rejecting a faulty one has
    // not. Telling this person they only have a repair coming would cost them
    // a refund they are still entitled to.
    const rights = legalRights({ ...online, purchasedOn: ago(20) }, TODAY, true);
    expect(find(rights, 'Consumer Rights Act').live).toBe(true);
    expect(find(rights, 'Consumer Contracts Regs').live).toBe(false);
  });

  it('keeps the repair right alive after the 30 days lapse', () => {
    const r = reject({ ...online, purchasedOn: ago(60) });
    expect(r.live).toBe(false);
    expect(r.body).toContain('repair or replacement');
  });
});

describe('the parts a person only finds out by asking', () => {
  const TODAY = new Date(2026, 7, 28);
  const bought = (daysAgo: number, distance: boolean): Receipt => ({
    id: 'x', store: 'ASOS', item: 'Coat', cat: 'clothing', amount: 4000,
    purchasedOn: toISODate(addDays(TODAY, -daysAgo)), windowDays: 28, policy: 'p',
    distance, status: 'active',
  });

  it('names the Scottish period as well as the English one', () => {
    // "up to six years in England and Wales" gives a Scottish reader no
    // number at all, on an app sold UK-wide.
    const [reject] = legalRights(bought(60, false), TODAY, true);
    expect(reject.live).toBe(false);
    expect(reject.body).toContain('six years in England and Wales');
    expect(reject.body).toContain('five in Scotland');
  });

  it('says an expired cooling-off may not be expired', () => {
    // Regulation 31: if the trader never gave the cancellation information,
    // the period ends twelve months after it otherwise would have. Closing
    // the door on that is closing it on a refund the person may still be owed.
    const rights = legalRights(bought(40, true), TODAY, true);
    const coolingOff = rights.find((r) => r.chip === 'Consumer Contracts Regs')!;
    expect(coolingOff.live).toBe(false);
    expect(coolingOff.body).toMatch(/never told you about this right/);
    expect(coolingOff.body).toMatch(/up to a year/);
  });

  it('says it whether or not the arrival date is known', () => {
    const withArrival = { ...bought(40, true), arrivedOn: toISODate(addDays(TODAY, -38)) };
    const known = legalRights(withArrival, TODAY, true).find((r) => r.chip === 'Consumer Contracts Regs')!;
    expect(known.live).toBe(false);
    expect(known.body).toMatch(/never told you about this right/);
  });

  it('does not clutter a live right with it', () => {
    // While the right is plainly running there is nothing here worth the
    // words, and the sentence would read as a warning about the wrong thing.
    const rights = legalRights(bought(3, true), TODAY, true);
    const coolingOff = rights.find((r) => r.chip === 'Consumer Contracts Regs')!;
    expect(coolingOff.live).toBe(true);
    expect(coolingOff.body).not.toMatch(/never told you about this right/);
  });
});

describe('when both clocks have run out, it still says what is left', () => {
  /*
   * Found by mutation: `shopStillOpen || 'You keep the rights above…'` flipped
   * to `&&` and nothing failed. `shopStillOpen` is a STRING, so the `||` is
   * choosing between two sentences — the shop's window is still open, OR the
   * only thing left is the faulty-goods route. The flip swaps them, which
   * drops the reassurance in exactly the case that needs it: the cooling-off
   * has run out AND the shop's window has shut.
   *
   * That is the moment this app exists for. A person who has just been told
   * two clocks have run out is one sentence away from believing there is
   * nothing left to do.
   */
  const expired = { ...online, purchasedOn: ago(20), arrivedOn: ago(20) };

  it('names the faulty-goods route once the shop is shut too', () => {
    const [, ...rest] = legalRights(expired, TODAY, false);
    const cooling = [...rest, ...legalRights(expired, TODAY, false)].find((r) => r.chip === 'Consumer Contracts Regs');
    expect(cooling?.live).toBe(false);
    expect(cooling?.body).toContain('You keep the rights above for anything that turns out to be faulty');
  });

  it('points at the shop instead while the shop is still open', () => {
    const cooling = legalRights(expired, TODAY, true).find((r) => r.chip === 'Consumer Contracts Regs');
    expect(cooling?.body).toContain('The shop’s own window above is still open either way');
    // And not both, which would be two answers to one question.
    expect(cooling?.body).not.toContain('You keep the rights above for anything');
  });
});
