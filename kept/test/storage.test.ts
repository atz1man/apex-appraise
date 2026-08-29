import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import { hydrate, rescueBackup, DEFAULT_SETTINGS } from '../src/lib/storage';
import { MAX_UPDATES } from '../src/lib/policy-feed';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const TODAY = new Date(2026, 7, 28);

const good: Receipt = {
  id: 'r1', store: 'Currys', item: 'Headphones', cat: 'audio', amount: toPence(89),
  purchasedOn: '2026-08-16', windowDays: 14, policy: 'p', distance: false, status: 'active',
};

const stored = (over: Record<string, unknown> = {}) => ({
  version: 1, receipts: [good], updates: [], onboardingSeen: true,
  settings: DEFAULT_SETTINGS, alertsSent: [], ...over,
});

describe('surviving whatever is on disk', () => {
  it('reads a well-formed store', () => {
    const s = hydrate(stored(), TODAY);
    expect(s.receipts).toEqual([good]);
    expect(s.onboardingSeen).toBe(true);
  });

  it('drops an unreadable receipt instead of taking the app down', () => {
    // This is the case that produced a blank screen on every launch, with no
    // way out but clearing site data by hand: one row missing its date.
    const s = hydrate(stored({ receipts: [{ ...good, purchasedOn: undefined }, { ...good, id: 'r2' }] }), TODAY);
    expect(s.receipts.map((r) => r.id)).toEqual(['r2']);
  });

  it.each([
    ['a missing date', { purchasedOn: undefined }],
    ['a malformed date', { purchasedOn: 'yesterday' }],
    ['a date that only looks real', { purchasedOn: '2026-02-31' }],
    ['a float amount', { amount: 12.5 }],
    ['a missing store', { store: undefined }],
    ['a zero window', { windowDays: 0 }],
    ['an unknown status', { status: 'maybe' }],
  ])('drops a receipt with %s', (_label, patch) => {
    expect(hydrate(stored({ receipts: [{ ...good, ...patch }] }), TODAY).receipts).toEqual([]);
  });

  it('keeps an empty library empty rather than reseeding the demo', () => {
    // Someone who erased everything must not find the demo receipts back.
    expect(hydrate(stored({ receipts: [] }), TODAY).receipts).toEqual([]);
  });

  it('starts fresh when the shape is not a store at all', () => {
    expect(hydrate(null, TODAY).receipts.length).toBeGreaterThan(0);
    expect(hydrate('nonsense', TODAY).receipts.length).toBeGreaterThan(0);
    expect(hydrate({ receipts: 'not an array' }, TODAY).receipts.length).toBeGreaterThan(0);
  });

  it('drops an unreadable policy update and keeps the rest', () => {
    const update = { id: 'u1', store: 'Zara', changedOn: '2026-08-26', text: 'x', affectsStores: ['Zara'] };
    const s = hydrate(stored({ updates: [update, { broken: true }] }), TODAY);
    expect(s.updates.map((u) => u.id)).toEqual(['u1']);
  });

  it('reseeds the feed when nothing readable survived', () => {
    // The feed is downloadable content, so falling back is always safe.
    expect(hydrate(stored({ updates: [{ broken: true }] }), TODAY).updates.length).toBeGreaterThan(0);
  });

  it('recovers a store an oversized feed already filled', () => {
    // The cap is not only a guard on the next download. A device that took one
    // bad feed before the cap existed has it on disk, and every launch writes
    // it back; the next launch has to be able to shed it.
    const updates = Array.from({ length: MAX_UPDATES * 4 }, (_, i) => ({
      id: `u${i}`, store: 'Zara', changedOn: `2026-0${(i % 9) + 1}-01`.slice(0, 10),
      text: 'x', affectsStores: ['Zara'],
    }));
    expect(hydrate(stored({ updates }), TODAY).updates).toHaveLength(MAX_UPDATES);
  });

  it('fills in settings a older version never wrote', () => {
    const s = hydrate(stored({ settings: { urgentDays: 14 } }), TODAY);
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, urgentDays: 14 });
  });

  describe('a preference it cannot read does not switch the app off', () => {
    /*
     * Receipts and policy updates have been validated on the way in since a
     * single bad row blanked the app. Settings were spread straight over the
     * defaults — and `urgentDays: "soon"`, or a negative, makes every
     * comparison against it false: a receipt five days from its deadline
     * renders relaxed, and the week-ahead alert never fires for anything.
     */
    const urgentOf = (settings: unknown) => hydrate(stored({ settings }), TODAY).settings.urgentDays;

    it.each([
      ['a word', 'soon'],
      ['a negative', -5],
      ['zero', 0],
      ['null', null],
      ['a fraction', 7.5],
      ['longer than the slider offers', 400],
    ])('falls back when the urgent window is %s', (_label, value) => {
      expect(urgentOf({ urgentDays: value })).toBe(DEFAULT_SETTINGS.urgentDays);
    });

    it('keeps a real one', () => {
      expect(urgentOf({ urgentDays: 14 })).toBe(14);
    });

    it('keeps the good fields beside an unreadable one', () => {
      // Per field, not all-or-nothing: one bad preference should not discard
      // the three beside it that were fine.
      const s = hydrate(stored({ settings: { urgentDays: 'soon', plan: 'pro', policyWatch: false } }), TODAY);
      expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, plan: 'pro', policyWatch: false });
    });

    it.each([
      ['a string', 'yes'],
      ['a number', 1],
      ['null', null],
    ])('will not take %s for a switch', (_label, value) => {
      expect(hydrate(stored({ settings: { deadlineAlerts: value } }), TODAY).settings.deadlineAlerts)
        .toBe(DEFAULT_SETTINGS.deadlineAlerts);
    });

    it('refuses a plan it does not sell', () => {
      expect(hydrate(stored({ settings: { plan: 'enterprise' } }), TODAY).settings.plan).toBe('free');
    });

    it('survives settings that are not an object at all', () => {
      expect(hydrate(stored({ settings: 'not an object' }), TODAY).settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  it('ignores junk in the alert list rather than choking on it', () => {
    expect(hydrate(stored({ alertsSent: ['r1:soon', 42, null] }), TODAY).alertsSent).toEqual(['r1:soon']);
  });
});

describe('the rescue, for when the app cannot render', () => {
  /*
   * The one moment where getting the receipts OFF the device is the only thing
   * that matters. It must not run through `load`, `hydrate` or the receipt
   * reader, because any of those may be exactly what threw — so it validates
   * nothing, and these tests are mostly about what it declines to do.
   */
  const withStore = (impl: Partial<Storage>) => {
    (globalThis as { window?: unknown }).window = { localStorage: impl };
  };
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('has nothing to offer when nothing is stored', () => {
    withStore({ getItem: () => null });
    expect(rescueBackup()).toBeNull();
  });

  it('gives back a file the importer accepts', () => {
    withStore({ getItem: () => JSON.stringify({ version: 1, receipts: [good], settings: DEFAULT_SETTINGS }) });
    const out = rescueBackup()!;
    expect(out.readable).toBe(true);
    const doc = JSON.parse(out.text);
    expect(doc.app).toBe('kept');
    expect(doc.receipts).toEqual([good]);
    expect(typeof doc.exportedAt).toBe('string');
  });

  it('keeps a row the reader would have thrown away', () => {
    // The row that broke the app is the row most worth rescuing: it is the
    // person's receipt, and a human can repair it in a text editor.
    withStore({ getItem: () => JSON.stringify({ receipts: [{ id: 'r9', store: 'Boots' }] }) });
    expect(JSON.parse(rescueBackup()!.text).receipts).toEqual([{ id: 'r9', store: 'Boots' }]);
  });

  it('hands back unparseable storage verbatim rather than nothing', () => {
    withStore({ getItem: () => '{"receipts": [tru' });
    const out = rescueBackup()!;
    expect(out.readable).toBe(false);
    expect(out.text).toBe('{"receipts": [tru');
  });

  it('survives a storage that refuses to be read at all', () => {
    withStore({ getItem: () => { throw new Error('blocked'); } });
    expect(rescueBackup()).toBeNull();
  });
});
