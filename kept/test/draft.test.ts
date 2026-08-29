import { describe, expect, it } from 'vitest';
import { applyDraft, draftFrom, effectiveWindowStart, validateDraft, type ReceiptDraft } from '../src/lib/draft';
import { money, toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);

const base: ReceiptDraft = {
  store: 'Currys', item: 'Headphones', cat: 'audio',
  amountText: '89.00', purchasedOn: '2026-08-16', windowDaysText: '14', warrantyMonthsText: '',
  distance: false,
};

function valid(patch: Partial<ReceiptDraft> = {}) {
  const out = validateDraft({ ...base, ...patch }, TODAY);
  if (!out.ok) throw new Error(`expected valid, got ${JSON.stringify(out.errors)}`);
  return out.value;
}

function errors(patch: Partial<ReceiptDraft>) {
  const out = validateDraft({ ...base, ...patch }, TODAY);
  if (out.ok) throw new Error('expected errors');
  return out.errors;
}

describe('amounts, as people actually type them', () => {
  it.each([
    ['89.00', '£89.00'],
    ['89', '£89.00'],
    ['£89', '£89.00'],
    [' 1,299.99 ', '£1,299.99'],
    ['0', '£0.00'],
    ['0.05', '£0.05'],
  ])('reads %s as %s', (typed, expected) => {
    expect(money(valid({ amountText: typed }).amount)).toBe(expected);
  });

  it('rejects an empty amount', () => {
    expect(errors({ amountText: '   ' }).amountText).toBeTruthy();
  });

  it('rejects text', () => {
    expect(errors({ amountText: 'eighty nine' }).amountText).toBeTruthy();
  });

  it('rejects a negative amount', () => {
    expect(errors({ amountText: '-10' }).amountText).toContain('negative');
  });

  it('rejects sub-penny precision rather than rounding it away', () => {
    expect(errors({ amountText: '10.005' }).amountText).toContain('penny');
  });

  it('catches an amount that is almost certainly a typo', () => {
    expect(errors({ amountText: '99999999' }).amountText).toContain('typo');
  });
});

describe('dates', () => {
  it('rejects a purchase date in the future', () => {
    expect(errors({ purchasedOn: '2026-09-01' }).purchasedOn).toContain('future');
  });

  it('accepts today', () => {
    expect(valid({ purchasedOn: '2026-08-28' }).purchasedOn).toBe('2026-08-28');
  });

  it('rejects a date that only looks real', () => {
    expect(errors({ purchasedOn: '2026-02-31' }).purchasedOn).toBeTruthy();
  });

  it('rejects a malformed date', () => {
    expect(errors({ purchasedOn: '28/08/2026' }).purchasedOn).toBeTruthy();
  });
});

describe('required text and window', () => {
  it('requires a shop', () => {
    expect(errors({ store: '  ' }).store).toBeTruthy();
  });

  it('requires an item name — the hole this screen exists to fill', () => {
    expect(errors({ item: '' }).item).toBeTruthy();
  });

  it('trims what it keeps', () => {
    expect(valid({ store: '  Argos  ', item: '  Mixer  ' })).toMatchObject({ store: 'Argos', item: 'Mixer' });
  });

  it.each([['0'], ['-5'], ['14.5'], [''], ['soon']])('rejects a window of "%s"', (w) => {
    expect(errors({ windowDaysText: w }).windowDaysText).toBeTruthy();
  });

  it('accepts IKEA’s 365 days', () => {
    expect(valid({ windowDaysText: '365' }).windowDays).toBe(365);
  });

  it('reports every problem at once, not one at a time', () => {
    const e = errors({ store: '', item: '', amountText: 'x', windowDaysText: '' });
    expect(Object.keys(e).sort()).toEqual(['amountText', 'item', 'store', 'windowDaysText']);
  });
});

describe('the warranty field', () => {
  it('means no warranty when left blank', () => {
    expect(valid({ warrantyMonthsText: '   ' }).warrantyMonths).toBeUndefined();
  });

  it('reads whole months', () => {
    expect(valid({ warrantyMonthsText: '24' }).warrantyMonths).toBe(24);
  });

  it.each([['0'], ['-3'], ['18.5'], ['two years']])('rejects "%s"', (v) => {
    expect(errors({ warrantyMonthsText: v }).warrantyMonthsText).toBeTruthy();
  });

  it('rejects a length nobody would honour', () => {
    expect(errors({ warrantyMonthsText: '2000' }).warrantyMonthsText).toBeTruthy();
  });

  it('clearing the field clears the clock', () => {
    const receipt: Receipt = {
      id: 'r1', store: 'Currys', item: 'Headphones', cat: 'audio', amount: toPence(89),
      purchasedOn: '2026-08-16', windowDays: 14, policy: 'p', distance: false, status: 'active',
      warranty: { months: 24, note: 'Manufacturer cover' },
    };
    const out = validateDraft({ ...draftFrom(receipt), warrantyMonthsText: '' }, TODAY);
    if (!out.ok) throw new Error('expected valid');
    expect(applyDraft(receipt, out.value).warranty).toBeUndefined();
  });

  it('keeps the manufacturer’s own wording when the length changes', () => {
    const receipt: Receipt = {
      id: 'r1', store: 'IKEA', item: 'MALM', cat: 'furniture', amount: toPence(199),
      purchasedOn: '2026-08-16', windowDays: 365, policy: 'p', distance: false, status: 'active',
      warranty: { months: 120, note: '10-year guarantee on MALM frames' },
    };
    const out = validateDraft({ ...draftFrom(receipt), warrantyMonthsText: '60' }, TODAY);
    if (!out.ok) throw new Error('expected valid');
    expect(applyDraft(receipt, out.value).warranty).toEqual({ months: 60, note: '10-year guarantee on MALM frames' });
  });
});

describe('round-tripping an existing receipt', () => {
  const receipt: Receipt = {
    id: 'r1', store: 'Currys', item: 'Headphones', cat: 'audio', amount: toPence(89),
    purchasedOn: '2026-08-16', windowDays: 14, policy: 'Currys · 14 days', distance: false, status: 'active',
  };

  it('loads into the form and back out unchanged', () => {
    const out = validateDraft(draftFrom(receipt), TODAY);
    expect(out.ok).toBe(true);
    if (out.ok) expect(applyDraft(receipt, out.value)).toEqual(receipt);
  });

  it('presents the amount as a plain editable number, not formatted money', () => {
    expect(draftFrom(receipt).amountText).toBe('89.00');
  });

  it('keeps fields the form does not touch', () => {
    // Warranty is NOT in this list — the form owns it, so a draft built from a
    // receipt without one clears it deliberately (see "clearing the field").
    const withHistory: Receipt = { ...receipt, status: 'returned', returnedOn: '2026-08-20', gotcha: 'dispatch, not delivery' };
    const out = validateDraft({ ...draftFrom(withHistory), item: 'Renamed' }, TODAY);
    if (!out.ok) throw new Error('expected valid');
    expect(applyDraft(withHistory, out.value)).toMatchObject({
      item: 'Renamed', id: 'r1', status: 'returned', returnedOn: '2026-08-20', gotcha: 'dispatch, not delivery',
      policy: 'Currys · 14 days',
    });
  });
});

describe('how it was bought', () => {
  // It decides whether the app states a 14-day right to cancel for any
  // reason, and that right does not exist over a counter — so it has to be
  // correctable on a receipt, not fixed at the moment one is created.
  const online: Receipt = {
    id: 'r', store: 'Zara', item: 'Coat', cat: 'clothing', amount: toPence(34.99),
    purchasedOn: '2026-08-16', windowDays: 30, policy: 'p', distance: true, status: 'active',
  };

  it('round-trips out of a receipt and back into one', () => {
    expect(draftFrom(online).distance).toBe(true);
    expect(applyDraft(online, valid({ distance: false })).distance).toBe(false);
  });
});

describe('where the window will actually start', () => {
  const zara: Receipt = {
    id: 'r1', store: 'Zara', item: 'Coat', cat: 'clothing', amount: toPence(34.99),
    purchasedOn: '2026-08-13', windowStartsOn: '2026-08-15', windowDays: 30,
    policy: 'p', distance: true, status: 'active',
  };

  it('is the dispatch date when the shop uses one', () => {
    // The edit screen previews the deadline from this. Computing it from the
    // purchase date instead put the preview two days adrift from the receipt.
    expect(effectiveWindowStart(zara, draftFrom(zara))).toBe('2026-08-15');
  });

  it('follows an edited purchase date when there is no dispatch clock', () => {
    const plain = { ...zara, windowStartsOn: undefined };
    expect(effectiveWindowStart(plain, { ...draftFrom(plain), purchasedOn: '2026-08-01' })).toBe('2026-08-01');
  });

  it('drops the dispatch clock when the shop changes', () => {
    expect(effectiveWindowStart(zara, { ...draftFrom(zara), store: 'Argos' })).toBe('2026-08-13');
  });

  it('ignores whitespace around the shop name, like applyDraft does', () => {
    expect(effectiveWindowStart(zara, { ...draftFrom(zara), store: '  Zara  ' })).toBe('2026-08-15');
  });

  it('agrees with what applyDraft actually saves', () => {
    // The two must not be able to drift: this is the pairing that broke.
    for (const store of ['Zara', 'Argos']) {
      const draft = { ...draftFrom(zara), store };
      const out = validateDraft(draft, TODAY);
      if (!out.ok) throw new Error('expected valid');
      const saved = applyDraft(zara, out.value);
      expect(saved.windowStartsOn ?? saved.purchasedOn).toBe(effectiveWindowStart(zara, draft));
    }
  });
});

describe('changing the shop', () => {
  const zara: Receipt = {
    id: 'r1', store: 'Zara', item: 'Coat', cat: 'clothing', amount: toPence(34.99),
    purchasedOn: '2026-08-13', windowStartsOn: '2026-08-15', windowDays: 30,
    policy: 'Zara · 30 days from dispatch', gotcha: 'dispatch, not delivery', distance: true, status: 'active',
  };

  it('brings the new shop’s policy with it', () => {
    const out = validateDraft({ ...draftFrom(zara), store: 'Argos', windowDaysText: '30' }, TODAY);
    if (!out.ok) throw new Error('expected valid');
    const edited = applyDraft(zara, out.value);
    expect(edited.policy).toContain('Argos');
    expect(edited.policy).not.toContain('Zara');
  });

  it('drops the old shop’s dispatch clock and its gotcha', () => {
    // Zara's window start must not keep governing an Argos purchase.
    const out = validateDraft({ ...draftFrom(zara), store: 'Argos' }, TODAY);
    if (!out.ok) throw new Error('expected valid');
    const edited = applyDraft(zara, out.value);
    expect(edited.windowStartsOn).toBeUndefined();
    expect(edited.gotcha).toBeUndefined();
  });

  it('says so plainly when the new shop is not one we have verified', () => {
    const out = validateDraft({ ...draftFrom(zara), store: 'Nigel’s Emporium' }, TODAY);
    if (!out.ok) throw new Error('expected valid');
    expect(applyDraft(zara, out.value).policy).toContain('as entered');
  });

  it('leaves the policy alone when the shop did not change', () => {
    const out = validateDraft({ ...draftFrom(zara), item: 'Wool coat' }, TODAY);
    if (!out.ok) throw new Error('expected valid');
    const edited = applyDraft(zara, out.value);
    expect(edited.policy).toBe(zara.policy);
    expect(edited.windowStartsOn).toBe('2026-08-15');
  });
});
