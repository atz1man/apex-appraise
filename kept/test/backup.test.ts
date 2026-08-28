import { describe, expect, it } from 'vitest';
import { mergeBackup, parseBackup } from '../src/lib/backup';
import { toPence } from '../src/lib/money';
import type { Receipt } from '../src/lib/types';

const good: Receipt = {
  id: 'r1', store: 'Currys', item: 'Headphones', cat: 'audio', amount: toPence(89),
  purchasedOn: '2026-08-16', windowDays: 14, policy: 'p', legalDays: 30, status: 'active',
};

const file = (receipts: unknown[]) => JSON.stringify({ app: 'kept', version: 1, receipts });

function ok(text: string) {
  const out = parseBackup(text);
  if (!out.ok) throw new Error(`expected a parse, got ${out.reason}`);
  return out.summary;
}

describe('rejecting files that are not backups', () => {
  it('rejects text that is not JSON', () => {
    expect(parseBackup('not json at all')).toEqual({ ok: false, reason: 'not-json' });
  });

  it('rejects JSON that is not a kept backup', () => {
    expect(parseBackup('{"app":"something-else","receipts":[]}')).toEqual({ ok: false, reason: 'not-a-kept-backup' });
    expect(parseBackup('[1,2,3]')).toEqual({ ok: false, reason: 'not-a-kept-backup' });
    expect(parseBackup('null')).toEqual({ ok: false, reason: 'not-a-kept-backup' });
  });

  it('accepts a genuinely empty backup', () => {
    // Someone with no receipts exported one. That is a real file, not an error.
    expect(ok(file([]))).toEqual({ receipts: [], skipped: 0 });
  });

  it('rejects a file whose every row was unreadable', () => {
    expect(parseBackup(file([{ nonsense: true }, 42]))).toEqual({ ok: false, reason: 'nothing-usable' });
  });
});

describe('validating rows', () => {
  it('accepts a well-formed receipt', () => {
    expect(ok(file([good])).receipts[0]).toEqual(good);
  });

  it('keeps the good rows and counts the bad', () => {
    const s = ok(file([good, { ...good, id: 'r2', amount: 'ninety' }, { ...good, id: 'r3' }]));
    expect(s.receipts.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(s.skipped).toBe(1);
  });

  it.each([
    ['a missing store', { store: '' }],
    ['a float amount, which means pence were not understood', { amount: 89.5 }],
    ['a negative amount', { amount: -100 }],
    ['a malformed date', { purchasedOn: '16/08/2026' }],
    ['a date that only looks real', { purchasedOn: '2026-02-31' }],
    ['a zero-day window', { windowDays: 0 }],
    ['a fractional window', { windowDays: 14.5 }],
    ['an unknown legal clock', { legalDays: 21 }],
    ['an unknown status', { status: 'pending' }],
    ['a malformed dispatch date', { windowStartsOn: 'yesterday' }],
  ])('drops a row with %s', (_label, patch) => {
    expect(parseBackup(file([{ ...good, ...patch }]))).toEqual({ ok: false, reason: 'nothing-usable' });
  });

  it('falls back rather than dropping a row over a cosmetic category', () => {
    // The category only picks a row icon; losing a receipt over it would cost
    // the user real money to save a glyph.
    expect(ok(file([{ ...good, cat: 'sorcery' }])).receipts[0].cat).toBe('other');
  });

  it('carries the optional fields through when present', () => {
    const rich = { ...good, windowStartsOn: '2026-08-18', warranty: { months: 24, note: 'Manufacturer cover' }, gotcha: 'watch out', returnedOn: '2026-08-20', status: 'returned' };
    expect(ok(file([rich])).receipts[0]).toMatchObject({
      windowStartsOn: '2026-08-18',
      warranty: { months: 24, note: 'Manufacturer cover' },
      gotcha: 'watch out',
      returnedOn: '2026-08-20',
    });
  });

  it('keeps a free-text warranty from an older backup as a note, with no clock', () => {
    // Warranties were prose before they were a clock. Inventing a length from
    // "2 years or so" would be worse than carrying the words and saying less.
    expect(ok(file([{ ...good, warranty: '2-year manufacturer warranty' }])).receipts[0].warranty)
      .toEqual({ months: 0, note: '2-year manufacturer warranty' });
  });

  it('drops a warranty it cannot make sense of, rather than the receipt', () => {
    const r = ok(file([{ ...good, warranty: { months: -5 } }])).receipts[0];
    expect(r.warranty).toBeUndefined();
    expect(r.id).toBe('r1');
  });

  it('refuses an implausible warranty length', () => {
    expect(ok(file([{ ...good, warranty: { months: 5000 } }])).receipts[0].warranty).toBeUndefined();
  });

  it('does not invent optional fields that were absent', () => {
    const r = ok(file([good])).receipts[0];
    expect('windowStartsOn' in r).toBe(false);
    expect('warranty' in r).toBe(false);
  });
});

describe('merging a restore into what is already here', () => {
  const local: Receipt[] = [good, { ...good, id: 'local-only', item: 'Added since the backup' }];

  it('never discards a receipt added since the backup was taken', () => {
    const m = mergeBackup(local, [{ ...good, id: 'from-backup' }]);
    expect(m.receipts.map((r) => r.id).sort()).toEqual(['from-backup', 'local-only', 'r1']);
    expect(m).toMatchObject({ added: 1, replaced: 0 });
  });

  it('lets the backup win for a row that exists on both sides', () => {
    const m = mergeBackup(local, [{ ...good, item: 'Corrected name' }]);
    expect(m.receipts.find((r) => r.id === 'r1')!.item).toBe('Corrected name');
    expect(m).toMatchObject({ added: 0, replaced: 1 });
  });

  it('restores cleanly onto an empty device', () => {
    expect(mergeBackup([], [good])).toMatchObject({ added: 1, replaced: 0 });
  });
});
