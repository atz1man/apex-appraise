import { addDays, fmtDateLong, toISODate } from './dates';
import { toPence } from './money';
import type { PolicyUpdate, Receipt } from './types';

/**
 * The first-run demo set, anchored to the day the app is opened rather than
 * to fixed calendar dates: a screenshot taken in six months has to show the
 * same "2 days left" urgency the design does, not five receipts long expired.
 */
export function seedReceipts(today: Date): Receipt[] {
  const ago = (n: number) => toISODate(addDays(today, -n));
  return [
    {
      id: 'seed_currys', store: 'Currys', item: 'JBL Tune 770NC headphones', cat: 'audio',
      amount: toPence(89.0), purchasedOn: ago(12), windowDays: 14,
      policy: 'Currys · 14 days change of mind, unopened or unwanted. Refund to original payment method.',
      legalDays: 30, warranty: `2-year manufacturer warranty · repairs free until ${fmtDateLong(addDays(today, 730 - 12))}`,
      status: 'active',
    },
    {
      id: 'seed_argos', store: 'Argos', item: 'Kenwood kMix stand mixer', cat: 'kitchen',
      amount: toPence(64.99), purchasedOn: ago(21), windowDays: 30,
      policy: 'Argos · 30 days with proof of purchase. Return to any store or arrange collection.',
      legalDays: 30, warranty: `1-year guarantee · until ${fmtDateLong(addDays(today, 365 - 21))}`, status: 'active',
    },
    {
      // The dispatch gotcha as data, not prose: the order was placed two days
      // before the parcel left the warehouse, and Zara counts from the later
      // of those — which is what makes the detail screen's warning true.
      id: 'seed_zara', store: 'Zara', item: 'Wool-blend overcoat', cat: 'clothing',
      amount: toPence(34.99), purchasedOn: ago(15), windowStartsOn: ago(13), windowDays: 30,
      policy: 'Zara · 30 days from dispatch, not delivery. Postal returns now £1.95 — in-store drop-off still free.',
      legalDays: 14,
      gotcha: 'Zara counts the 30 days from dispatch, not from the day the parcel landed on your mat — the clock had already been running when it arrived.',
      status: 'active',
    },
    {
      id: 'seed_boots', store: 'Boots', item: 'No7 skincare set', cat: 'beauty',
      amount: toPence(24.98), purchasedOn: ago(14), windowDays: 35,
      policy: 'Boots · 35 days, unopened, with receipt. Advantage Card refunds go back as points.',
      legalDays: 14, status: 'active',
    },
    {
      id: 'seed_ikea', store: 'IKEA', item: 'MALM chest of 6 drawers', cat: 'furniture',
      amount: toPence(199.0), purchasedOn: ago(195), windowDays: 365,
      policy: 'IKEA · 365 days, even assembled, with proof of purchase. 14 days for cut fabric.',
      legalDays: 30, warranty: '10-year guarantee on MALM frames', status: 'active',
    },
  ];
}

export function seedUpdates(today: Date): PolicyUpdate[] {
  const ago = (n: number) => toISODate(addDays(today, -n));
  return [
    {
      id: 'u_zara', store: 'Zara', changedOn: ago(2),
      text: 'Free postal returns ended — £1.95 unless you drop off in store. Window still 30 days from dispatch.',
      affectsStores: ['Zara'], affectNote: 'drop off in store to keep it free',
    },
    {
      id: 'u_asos', store: 'ASOS', changedOn: ago(7),
      text: 'New 28-day window for “frequent returners” (was 45). Kept flags if that’s you before you buy.',
      affectsStores: ['ASOS'], affectNote: 'your window is the shorter one',
    },
    {
      id: 'u_apple', store: 'Apple', changedOn: ago(21),
      text: '14-day window confirmed for the iPhone 18 line. Warranty clocks added automatically.',
      affectsStores: ['Apple'], affectNote: 'warranty clock added',
    },
    {
      id: 'u_currys', store: 'Currys', changedOn: ago(30),
      text: 'Price-match refund window extended to 14 days — if it drops in price after you buy, claim the difference.',
      affectsStores: ['Currys'], affectNote: 'you can claim the difference if the price drops',
    },
  ];
}
