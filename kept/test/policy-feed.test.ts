import { describe, expect, it } from 'vitest';
import { assess, mergeFeed, readFeed } from '../src/lib/policy-feed';
import { toPence } from '../src/lib/money';
import { addDays, toISODate } from '../src/lib/dates';
import type { PolicyUpdate, Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);
const ago = (n: number) => toISODate(addDays(TODAY, -n));

const zaraReceipt: Receipt = {
  id: 'r1', store: 'Zara', item: 'Wool coat', cat: 'clothing', amount: toPence(34.99),
  purchasedOn: ago(13), windowDays: 30, policy: 'p', legalDays: 14, status: 'active',
};

const update = (over: Partial<PolicyUpdate> = {}): PolicyUpdate => ({
  id: 'u1', store: 'Zara', changedOn: ago(2), text: 'Something changed',
  affectsStores: ['Zara'], affectNote: 'drop off in store to keep it free',
  ...over,
});

describe('who an update actually affects', () => {
  it('is just news when the shop is not one you use', () => {
    const [a] = assess([update({ store: 'ASOS', affectsStores: ['ASOS'] })], [zaraReceipt], TODAY);
    expect(a.affectsYou).toBe(false);
    expect(a.impacts).toEqual([]);
  });

  it('is news, not an alarm, once the receipt is returned', () => {
    const [a] = assess([update()], [{ ...zaraReceipt, status: 'returned' }], TODAY);
    expect(a.affectsYou).toBe(false);
  });

  it('names every held receipt from that shop', () => {
    const second = { ...zaraReceipt, id: 'r2', item: 'Linen shirt' };
    const [a] = assess([update()], [zaraReceipt, second], TODAY);
    expect(a.impacts.map((i) => i.receipt.id)).toEqual(['r1', 'r2']);
  });
});

describe('what a change means for a receipt already held', () => {
  it('says so plainly when nothing moved', () => {
    const [a] = assess([update({ newWindowDays: 30 })], [zaraReceipt], TODAY);
    expect(a.impacts[0].kind).toBe('unchanged');
    expect(a.impacts[0].note).toBe('deadline unchanged, already checked');
  });

  it('never rewrites a deadline the purchase was made under', () => {
    // The terms a purchase was made under govern it. Silently re-calculating
    // would tell someone they have less time than they actually do.
    const [a] = assess([update({ newWindowDays: 14 })], [zaraReceipt], TODAY);
    expect(a.impacts[0].kind).toBe('shorter');
    expect(a.impacts[0].note).toContain('yours keeps the 30 days it was bought under');
    expect(a.impacts[0].note).toContain('17 days left');
  });

  it('says how much shorter, for the next purchase', () => {
    const [a] = assess([update({ newWindowDays: 29 })], [zaraReceipt], TODAY);
    expect(a.impacts[0].note).toContain('1 day less');
  });

  it('reports a lengthened window as such', () => {
    const [a] = assess([update({ newWindowDays: 45 })], [zaraReceipt], TODAY);
    expect(a.impacts[0].kind).toBe('longer');
    expect(a.impacts[0].note).toContain('15 days more');
  });

  it('says "closed" rather than negative days on an expired receipt', () => {
    const expired = { ...zaraReceipt, purchasedOn: ago(60) };
    const [a] = assess([update({ newWindowDays: 14 })], [expired], TODAY);
    expect(a.impacts[0].note).toContain('window closed');
    expect(a.impacts[0].note).not.toContain('-');
  });

  it('falls back to the update’s own note when it carries no new window', () => {
    const [a] = assess([update()], [zaraReceipt], TODAY);
    expect(a.impacts[0].kind).toBe('informational');
    expect(a.impacts[0].note).toBe('drop off in store to keep it free');
  });
});

describe('reading a downloaded feed', () => {
  const feed = (updates: unknown[]) => ({ feed: 'kept-policy', updates });

  it('refuses anything that is not a kept feed', () => {
    expect(readFeed(null)).toBeNull();
    expect(readFeed({ updates: [] })).toBeNull();
    expect(readFeed({ feed: 'something-else', updates: [] })).toBeNull();
  });

  it('accepts a well-formed entry', () => {
    const [u] = readFeed(feed([{ id: 'u1', store: 'Zara', changedOn: '2026-08-26', text: 'x', affectsStores: ['Zara'], newWindowDays: 14 }]))!;
    expect(u).toMatchObject({ id: 'u1', store: 'Zara', newWindowDays: 14, affectNote: '' });
  });

  it.each([
    ['no id', { store: 'Zara', changedOn: '2026-08-26', text: 'x', affectsStores: [] }],
    ['a malformed date', { id: 'u', store: 'Zara', changedOn: '26/08/2026', text: 'x', affectsStores: [] }],
    ['a non-array affectsStores', { id: 'u', store: 'Zara', changedOn: '2026-08-26', text: 'x', affectsStores: 'Zara' }],
    ['a fractional window', { id: 'u', store: 'Zara', changedOn: '2026-08-26', text: 'x', affectsStores: [], newWindowDays: 1.5 }],
  ])('drops an entry with %s', (_label, entry) => {
    expect(readFeed(feed([entry]))).toEqual([]);
  });

  it('keeps the good entries alongside the bad', () => {
    const good = { id: 'u1', store: 'Zara', changedOn: '2026-08-26', text: 'x', affectsStores: ['Zara'] };
    expect(readFeed(feed([good, { nonsense: true }]))!.map((u) => u.id)).toEqual(['u1']);
  });
});

describe('merging a feed over what is held', () => {
  const held = [update({ id: 'u1', changedOn: ago(10) }), update({ id: 'u2', changedOn: ago(5) })];

  it('adds what is new and keeps what is not mentioned', () => {
    const merged = mergeFeed(held, [update({ id: 'u3', changedOn: ago(1) })]);
    expect(merged.map((u) => u.id)).toEqual(['u3', 'u2', 'u1']);
  });

  it('lets the feed correct an entry it already sent', () => {
    const merged = mergeFeed(held, [update({ id: 'u1', changedOn: ago(10), text: 'Corrected wording' })]);
    expect(merged.find((u) => u.id === 'u1')!.text).toBe('Corrected wording');
    expect(merged).toHaveLength(2);
  });

  it('puts the newest first', () => {
    expect(mergeFeed([], [update({ id: 'old', changedOn: ago(30) }), update({ id: 'new', changedOn: ago(1) })]).map((u) => u.id))
      .toEqual(['new', 'old']);
  });
});
