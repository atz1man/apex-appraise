import { describe, expect, it } from 'vitest';
import { MAX_UPDATES, assess, mergeFeed, readFeed, windowInForceFor } from '../src/lib/policy-feed';
import { MAX_WINDOW_DAYS } from '../src/lib/draft';
import { toPence } from '../src/lib/money';
import { addDays, toISODate } from '../src/lib/dates';
import type { PolicyUpdate, Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);
const ago = (n: number) => toISODate(addDays(TODAY, -n));

const zaraReceipt: Receipt = {
  id: 'r1', store: 'Zara', item: 'Wool coat', cat: 'clothing', amount: toPence(34.99),
  purchasedOn: ago(13), windowDays: 30, policy: 'p', distance: true, status: 'active',
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
  it('reassures about the deadline AND passes on the advice, when nothing moved', () => {
    // Zara's postal-returns fee left the window at 30 days, so this branch
    // fired and said only "deadline unchanged, already checked" — discarding
    // the one sentence in the update worth acting on.
    const [a] = assess([update({ newWindowDays: 30 })], [zaraReceipt], TODAY);
    expect(a.impacts[0].kind).toBe('unchanged');
    expect(a.impacts[0].note).toBe('deadline unchanged · drop off in store to keep it free');
  });

  it('still says something when an unchanged update carries no advice', () => {
    const [a] = assess([update({ newWindowDays: 30, affectNote: '' })], [zaraReceipt], TODAY);
    expect(a.impacts[0].note).toBe('deadline unchanged, already checked');
  });

  it('leaves the advice out where it would be false', () => {
    // "your window is the shorter one" is written for a reader of the news.
    // For a receipt already held it is wrong — that receipt keeps the window
    // it was bought under, which is exactly what the derived note says.
    const [a] = assess([update({ newWindowDays: 14, affectNote: 'your window is the shorter one' })], [zaraReceipt], TODAY);
    expect(a.impacts[0].note).not.toContain('your window is the shorter one');
    expect(a.impacts[0].note).toContain('yours keeps the 30 days it was bought under');
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

  it('never leaves the note empty, because the screen writes a dash before it', () => {
    // The Watch card renders "{item} — {note}", and mergeFeed defaults a
    // missing affectNote to ''. An entry with neither a new window nor a note
    // printed the receipt's name followed by a dangling dash.
    const [a] = assess([update({ affectNote: '   ' })], [zaraReceipt], TODAY);
    expect(a.impacts[0].note.trim().length).toBeGreaterThan(0);
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

describe('the news cannot crowd out the receipts', () => {
  // The feed shares one localStorage bucket with the library the app exists
  // for, and until this cap `mergeFeed` only ever grew: a single oversized or
  // misgenerated response was persisted permanently, and no later good feed
  // shrank it. The only way back was Erase everything, which takes the
  // receipts with it.
  const many = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => update({ id: `u${from + i}`, changedOn: ago(from + i + 1) }));

  it('bounds one oversized response at the door', () => {
    expect(readFeed({ feed: 'kept-policy', updates: many(MAX_UPDATES * 5) })).toHaveLength(MAX_UPDATES);
  });

  it('keeps the newest of an oversized response, not the first it happened to read', () => {
    const oldestFirst = [...many(MAX_UPDATES * 2)].reverse();
    const kept = readFeed({ feed: 'kept-policy', updates: oldestFirst })!;
    expect(kept[0].id).toBe('u0');
    expect(kept.every((u) => Number(u.id.slice(1)) < MAX_UPDATES)).toBe(true);
  });

  it('bounds the merge, however many launches it takes', () => {
    let held = mergeFeed([], many(MAX_UPDATES));
    for (let launch = 0; launch < 5; launch += 1) {
      held = mergeFeed(held, many(MAX_UPDATES, MAX_UPDATES * (launch + 1)));
      expect(held.length).toBeLessThanOrEqual(MAX_UPDATES);
    }
  });

  it('forgets the oldest news to make room for the newest', () => {
    const held = many(MAX_UPDATES, 1);
    const merged = mergeFeed(held, [update({ id: 'today', changedOn: ago(0) })]);
    expect(merged).toHaveLength(MAX_UPDATES);
    expect(merged[0].id).toBe('today');
    expect(merged.some((u) => u.id === `u${MAX_UPDATES}`)).toBe(false);
  });
});

describe('the window in force when it was bought', () => {
  /*
   * `newWindowDays` was read for exactly one thing: telling the holder of an
   * existing receipt how their deadline compares. So the Watch tab would say
   * "new purchases get 16 days less; yours keeps the 30 days it was bought
   * under" while the Add screen handed a new purchase the table's 30.
   */
  const upd = (id: string, store: string, changedOn: string, newWindowDays?: number): PolicyUpdate => ({
    id,
    store,
    changedOn,
    text: `${store} changed something`,
    affectsStores: [store],
    affectNote: '',
    ...(newWindowDays === undefined ? {} : { newWindowDays }),
  });

  it('has nothing to say when the feed never mentioned that shop', () => {
    expect(windowInForceFor('Currys', '2026-08-20', [upd('a', 'Boots', '2026-01-01', 14)])).toBeUndefined();
  });

  it('has nothing to say when the update carries no window', () => {
    expect(windowInForceFor('Currys', '2026-08-20', [upd('a', 'Currys', '2026-01-01')])).toBeUndefined();
  });

  it('takes the change that had already happened', () => {
    expect(windowInForceFor('Currys', '2026-08-20', [upd('a', 'Currys', '2026-08-01', 14)])).toEqual({ days: 14, changedOn: '2026-08-01' });
  });

  it('ignores a change made after the purchase — that receipt keeps its terms', () => {
    expect(windowInForceFor('Currys', '2026-08-20', [upd('a', 'Currys', '2026-08-21', 14)])).toBeUndefined();
  });

  it('counts a change made on the day itself as in force', () => {
    expect(windowInForceFor('Currys', '2026-08-20', [upd('a', 'Currys', '2026-08-20', 14)])).toEqual({ days: 14, changedOn: '2026-08-20' });
  });

  it('takes the most recent of several, not the last in the list', () => {
    const feed = [upd('a', 'Currys', '2026-08-01', 14), upd('b', 'Currys', '2026-03-01', 45)];
    expect(windowInForceFor('Currys', '2026-08-20', feed)?.days).toBe(14);
  });

  it('takes the shorter when two changes share a date', () => {
    // Arbitrary as arithmetic, not as judgement: the tie goes to the answer
    // that cannot tell someone they have longer than they do.
    const feed = [upd('a', 'Currys', '2026-08-01', 30), upd('b', 'Currys', '2026-08-01', 14)];
    expect(windowInForceFor('Currys', '2026-08-20', feed)?.days).toBe(14);
    expect(windowInForceFor('Currys', '2026-08-20', [...feed].reverse())?.days).toBe(14);
  });

  it('matches the shop however it is cased', () => {
    // `assess` once matched exactly while `findStore` did not, and a receipt
    // edited to "boots" carried Boots' policy with every Boots change
    // invisible to it.
    expect(windowInForceFor('currys', '2026-08-20', [upd('a', 'Currys', '2026-08-01', 14)])?.days).toBe(14);
  });

  it('says nothing for a shop with no name', () => {
    expect(windowInForceFor('  ', '2026-08-20', [upd('a', 'Currys', '2026-08-01', 14)])).toBeUndefined();
  });
});

describe('two boundaries in the feed that nothing pinned', () => {
  /*
   * Found by mutation. `d.daysLeft < 0` flipped to `<= 0` makes the impact
   * line say "window closed" on the LAST DAY of a window — the one day the
   * sentence most needs to be right, and the same last-day fault this codebase
   * has already fixed on the countdown ring and in the hero.
   */
  it('does not call the last day of a window a closed one', () => {
    const bought = toISODate(addDays(TODAY, -30));
    const r: Receipt = {
      id: 'last', store: 'Currys', item: 'Kettle', cat: 'other', amount: toPence(29),
      purchasedOn: bought, windowDays: 30, policy: 'Currys · 30 days', distance: false, status: 'active',
    };
    const update: PolicyUpdate = {
      id: 'u', store: 'Currys', changedOn: ago(1), text: 'Currys shortened its window.',
      affectsStores: ['Currys'], affectNote: '', newWindowDays: 14,
    };
    const [assessed] = assess([update], [r], TODAY);
    expect(assessed.impacts[0].note).toContain('0 days left');
    expect(assessed.impacts[0].note).not.toContain('window closed');
  });

  /*
   * And `.some` flipped to `.every` in windowInForceFor, which the tests
   * written with it could not catch: every one used an update naming a single
   * shop, where "some match" and "all match" are the same sentence. A real
   * change naming two shops at once — a group announcing one policy across its
   * brands — would then have applied to neither.
   */
  it('matches an update that names more than one shop', () => {
    const both: PolicyUpdate = {
      id: 'group', store: 'Currys', changedOn: '2026-08-01', text: 'The group shortened both windows.',
      affectsStores: ['Currys', 'Argos'], affectNote: '', newWindowDays: 14,
    };
    expect(windowInForceFor('Currys', '2026-08-20', [both])?.days).toBe(14);
    expect(windowInForceFor('Argos', '2026-08-20', [both])?.days).toBe(14);
    expect(windowInForceFor('Boots', '2026-08-20', [both])).toBeUndefined();
  });
});

describe('how much of anything one downloaded entry may be', () => {
  /*
   * `readFeed` checked what each field WAS and never how much of it there was.
   * Survivable while the feed could only put words on a screen; not now that
   * `newWindowDays` sets a real receipt's window — the edit form refuses
   * anything past ten years from a person, and the same number arrived from
   * the network unexamined.
   */
  const doc = (over: Record<string, unknown>) => ({
    feed: 'kept-policy',
    updates: [{
      id: 'u1', store: 'Currys', changedOn: '2026-08-01',
      text: 'Currys changed something.', affectsStores: ['Currys'], affectNote: '', ...over,
    }],
  });

  it('takes a window the edit form would also take', () => {
    expect(readFeed(doc({ newWindowDays: 365 }))).toHaveLength(1);
  });

  it('refuses one the edit form would refuse', () => {
    expect(readFeed(doc({ newWindowDays: 999999 }))).toEqual([]);
    expect(readFeed(doc({ newWindowDays: MAX_WINDOW_DAYS + 1 }))).toEqual([]);
    expect(readFeed(doc({ newWindowDays: MAX_WINDOW_DAYS }))).toHaveLength(1);
  });

  it('refuses a policy note longer than any policy note', () => {
    expect(readFeed(doc({ text: 'x'.repeat(2001) }))).toEqual([]);
    expect(readFeed(doc({ text: 'x'.repeat(2000) }))).toHaveLength(1);
  });

  it('drops the entry rather than trimming it', () => {
    // Half a sentence somebody repeats at a counter is worse than none of it.
    const kept = readFeed(doc({ text: 'x'.repeat(2000) }));
    expect(kept?.[0].text).toHaveLength(2000);
  });

  it('refuses a shop name that is not a name', () => {
    expect(readFeed(doc({ store: 'x'.repeat(121) }))).toEqual([]);
    expect(readFeed(doc({ affectsStores: ['x'.repeat(121)] }))).toEqual([]);
    expect(readFeed(doc({ id: 'x'.repeat(121) }))).toEqual([]);
  });

  it('refuses an update that claims to affect forty-one shops', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `Shop ${i}`);
    expect(readFeed(doc({ affectsStores: many(41) }))).toEqual([]);
    expect(readFeed(doc({ affectsStores: many(40) }))).toHaveLength(1);
  });

  it('keeps an oversized note out of the record without losing the update', () => {
    // affectNote already falls back to '' when it is not a usable string; too
    // long is one more way of not being usable, and the update itself is still
    // news worth carrying.
    const kept = readFeed(doc({ affectNote: 'x'.repeat(2001) }));
    expect(kept).toHaveLength(1);
    expect(kept?.[0].affectNote).toBe('');
  });
});
