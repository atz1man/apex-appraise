import { describe, expect, it } from 'vitest';
import { matches, search, shouldOfferSearch, SEARCH_APPEARS_ABOVE } from '../src/lib/search';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const make = (store: string, item: string, id = store + item): Receipt => ({
  id, store, item, cat: 'other', amount: toPence(10),
  purchasedOn: '2026-08-16', windowDays: 14, policy: 'p', distance: false, status: 'active',
});

const set = [
  make('Currys', 'JBL Tune 770NC headphones'),
  make('Argos', 'Kenwood kMix stand mixer'),
  make('Zara', 'Wool-blend overcoat'),
  make('John Lewis', 'Wool throw'),
];

describe('matching', () => {
  it('matches nothing typed as everything', () => {
    expect(search(set, '').map((r) => r.store)).toHaveLength(4);
    expect(search(set, '   ')).toHaveLength(4);
  });

  it('finds by shop', () => {
    expect(search(set, 'argos').map((r) => r.item)).toEqual(['Kenwood kMix stand mixer']);
  });

  it('finds by item', () => {
    expect(search(set, 'headphones').map((r) => r.store)).toEqual(['Currys']);
  });

  it('ignores case', () => {
    expect(search(set, 'ZARA')).toHaveLength(1);
    expect(search(set, 'jbl')).toHaveLength(1);
  });

  it('matches partway through a word', () => {
    expect(search(set, 'phone')).toHaveLength(1);
  });

  it('requires every term, so a second word narrows rather than widens', () => {
    expect(search(set, 'wool')).toHaveLength(2);
    expect(search(set, 'wool zara')).toHaveLength(1);
  });

  it('matches terms across both fields', () => {
    expect(search(set, 'lewis throw').map((r) => r.store)).toEqual(['John Lewis']);
  });

  it('tolerates messy spacing', () => {
    expect(search(set, '  wool   zara  ')).toHaveLength(1);
  });

  it('returns nothing rather than near-misses', () => {
    // No fuzzy matching on purpose: a near-miss in a list about money and
    // deadlines invites acting on the wrong row.
    expect(search(set, 'headphnoes')).toEqual([]);
    expect(matches(make('Currys', 'Headphones'), 'curry')).toBe(true);
    expect(matches(make('Currys', 'Headphones'), 'currie')).toBe(false);
  });

  it('does not mutate or alias the input', () => {
    const out = search(set, '');
    out.pop();
    expect(set).toHaveLength(4);
  });
});

describe('when the box is worth showing', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => make('Shop', 'Item ' + i, 'r' + i));

  it('stays out of the way for a short list', () => {
    expect(shouldOfferSearch(many(SEARCH_APPEARS_ABOVE))).toBe(false);
  });

  it('appears once the list outgrows a screen', () => {
    expect(shouldOfferSearch(many(SEARCH_APPEARS_ABOVE + 1))).toBe(true);
  });

  it('counts returned receipts too — they are searchable as well', () => {
    const mixed = many(4).concat(many(4).map((r) => ({ ...r, id: r.id + 'x', status: 'returned' as const })));
    expect(shouldOfferSearch(mixed)).toBe(true);
  });
});
