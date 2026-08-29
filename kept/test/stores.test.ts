import { describe, expect, it } from 'vitest';
import { STORE_POLICIES, findStore, type StorePolicy } from '../src/lib/stores';
import { parseReceiptText } from '../src/lib/parse';

/**
 * A sweep over the REAL policy table rather than a hand-kept list of examples,
 * so a twenty-first retailer is covered the day someone adds it.
 *
 * The table is the product — "kept knows each shop's real window and the trap
 * inside it" — and it is prose and data side by side, which is the shape that
 * drifts. The number in the sentence someone reads at the counter has to be
 * the number the app counted with, and a sentence that quotes a clock the app
 * does not keep has to say so.
 */
const TODAY = new Date(2026, 7, 28);

describe('the policy table agrees with itself', () => {
  it.each(STORE_POLICIES.map((s) => [s.name, s] as const))(
    '%s: the days in its sentence are the days it counts',
    (_name, store) => {
      const quoted = [...store.policy.matchAll(/\b(\d+)[- ]days?\b/gi)].map((m) => Number(m[1]));
      // A sentence may name more than one window — IKEA's 365 days with 14 for
      // cut fabric — so the requirement is that the one being counted appears,
      // not that it is alone.
      expect(quoted).toContain(store.windowDays);
    },
  );

  it.each(STORE_POLICIES.map((s) => [s.name, s] as const))(
    '%s: a clock this app does not keep is not left unsaid',
    (_name, store) => {
      /*
       * Three retailers quoted "28 days from delivery" while the app clocked
       * them from the order date and said nothing about the difference. The
       * direction is the safe one — an earlier deadline than the real one —
       * but silence about it is how a receipt comes to look expired on a day
       * it is not, and this app knows the arrival date of nothing.
       *
       * `clockStart: 'dispatch'` IS kept, through `Receipt.windowStartsOn`, so
       * it needs no note beyond its own gotcha. Everything else that names a
       * start other than the purchase has to explain itself.
       */
      const named = /\bfrom (delivery|dispatch|the day it)/i.exec(store.policy);
      if (!named) return;
      if (store.clockStart === 'dispatch') {
        expect(store.gotcha, `${store.name} counts from dispatch and should say so`).toBeTruthy();
        return;
      }
      expect(store.gotcha ?? '', `${store.name} quotes "${named[0]}" but is clocked from purchase`)
        .toMatch(/earliest|arrives/i);
    },
  );

  it('no alias resolves to a shop other than its own', () => {
    /*
     * This guards the INDEX, not the aliases: two shops claiming overlapping
     * names, or a longer alias swallowing a shorter one, resolves silently to
     * the wrong retailer and quotes the wrong window at a counter.
     *
     * Being straight about its limit, because the first version of it read as
     * more than this: it builds each probe out of the alias it is checking, so
     * it can never fail for an alias that has stopped appearing in real order
     * emails. Nothing offline can check that.
     */
    for (const store of STORE_POLICIES) {
      for (const alias of store.aliases) {
        const out = parseReceiptText(`Your ${alias} order · Total £20.00 · 20 Aug 2026`, TODAY);
        expect(out.ok, `${alias} parsed nothing`).toBe(true);
        if (out.ok) expect(out.value.store, `"${alias}" resolved to the wrong shop`).toBe(store.name);
      }
    }
  });

  it('finds a store by its display name, whatever the case', () => {
    for (const store of STORE_POLICIES) {
      expect(findStore(store.name)?.name, store.name).toBe(store.name);
      expect(findStore(store.name.toUpperCase())?.name, store.name).toBe(store.name);
    }
  });
});

describe('naming a shop that is not there', () => {
  /*
   * `pickStore` matched a bare substring, so an order from a shop Kept has
   * never heard of was reported as one it has. Four of these were live at
   * once, and the first is on a large fraction of order emails ever sent.
   *
   * The cost is not cosmetic. A named shop brings its window, so a Vinted
   * order became a 35-day Boots one, and its policy sentence, which is the
   * wording someone repeats at a counter. Naming nothing is visibly an
   * assumption — "Not recognised", against a 28-day window the add screen says
   * is assumed — and an assumption someone can correct beats a confident lie.
   */
  const store = (text: string) => {
    const out = parseReceiptText(text, TODAY);
    return out.ok ? out.value.store : null;
  };

  it.each([
    ['a shipping phrase', 'Your Vinted order · next day delivery · Total £20.00 · 20 Aug 2026'],
    ['an item that is also a shop', 'Your Vinted order · walking boots · Total £40.00 · 20 Aug 2026'],
    ['a shop’s name inside a longer word', 'Your Etsy order · pineapple print tea towel · Total £12.00 · 20 Aug 2026'],
    ['an ordinary use of the word', 'Your Depop order · Nike Air Max, next size up · Total £55.00 · 20 Aug 2026'],
  ])('does not invent a retailer from %s', (_label, text) => {
    expect(store(text)).toBeNull();
  });

  it.each([
    ['Boots', 'Boots order · No7 set · £24.98 · 20 Aug 2026'],
    ['Next', 'Your Next order · £30.00 · 20 Aug 2026'],
    ['Apple', 'Your Apple order · AirPods · £129.00 · 20 Aug 2026'],
    ['Boots', 'Thanks for shopping at boots.com · £24.98 · 20 Aug 2026'],
    ['Next', 'Order confirmation from next.co.uk · £30.00 · 20 Aug 2026'],
  ])('still recognises a real %s email', (name, text) => {
    expect(store(text)).toBe(name);
  });

  it('lets an unambiguous shop win over an ordinary word in the same email', () => {
    expect(store('Amazon order · next day delivery · Total £20.00 · 20 Aug 2026')).toBe('Amazon');
  });
});

describe('where each entry says its clock starts', () => {
  /**
   * The field and the prose beside it have to agree.
   *
   * Apple, Amazon and ASOS each carried a gotcha explaining that they count
   * from the day the parcel arrives, and a `clockStart` of 'purchase' two
   * lines above it. Nothing held the two together, so the table stated a rule
   * in a field the app reads and contradicted it in a sentence the app shows.
   */
  const saysDelivery = (p: StorePolicy) =>
    /from delivery|from the day it arrives/i.test(`${p.policy} ${p.gotcha ?? ''}`);
  const saysDispatch = (p: StorePolicy) => /from dispatch/i.test(`${p.policy} ${p.gotcha ?? ''}`);

  it('finds entries of each kind to check', () => {
    // A sweep over an empty set passes silently.
    expect(STORE_POLICIES.filter((p) => p.clockStart === 'delivery').length).toBeGreaterThan(0);
    expect(STORE_POLICIES.filter((p) => p.clockStart === 'dispatch').length).toBeGreaterThan(0);
    expect(STORE_POLICIES.filter((p) => p.clockStart === 'purchase').length).toBeGreaterThan(0);
  });

  it('never says "from delivery" while counting from the till', () => {
    const wrong = STORE_POLICIES.filter((p) => saysDelivery(p) && p.clockStart !== 'delivery').map((p) => p.name);
    expect(wrong).toEqual([]);
  });

  it('never says "from dispatch" while counting from anywhere else', () => {
    const wrong = STORE_POLICIES.filter((p) => saysDispatch(p) && p.clockStart !== 'dispatch').map((p) => p.name);
    expect(wrong).toEqual([]);
  });

  it('never counts from delivery or dispatch without saying so', () => {
    // The other direction: a clock the app runs and the wording never
    // mentions is a deadline nobody can check at a counter.
    const silent = STORE_POLICIES.filter(
      (p) => (p.clockStart === 'delivery' && !saysDelivery(p)) || (p.clockStart === 'dispatch' && !saysDispatch(p)),
    ).map((p) => p.name);
    expect(silent).toEqual([]);
  });
});
