import { fromISODate, toISODate } from './dates';
import { canonicalStoreName } from './stores';
import type { Category, Receipt, ReceiptStatus, Warranty } from './types';

/**
 * Reading a backup file back in.
 *
 * Export without import is a dead end, and on a product with no account it is
 * the ONLY way a person moves to a new phone or recovers from a wiped browser
 * — so this is the restore path for everything the app holds, not a
 * convenience.
 *
 * It is also the one place untrusted text becomes app state. The file came off
 * a disk, possibly hand-edited, possibly from a much older version, so every
 * field is checked rather than trusted: a row that cannot be understood is
 * dropped and counted rather than allowed to land half-formed and crash a
 * screen three taps later.
 */

const CATEGORIES: readonly Category[] = ['audio', 'kitchen', 'clothing', 'beauty', 'furniture', 'other'];
const STATUSES: readonly ReceiptStatus[] = ['active', 'returned'];

export interface ImportSummary {
  /** Rows that validated. */
  receipts: Receipt[];
  /** Rows that did not, and were dropped. */
  skipped: number;
}

export type ImportOutcome =
  | { ok: true; summary: ImportSummary }
  | { ok: false; reason: 'not-json' | 'not-a-kept-backup' | 'nothing-usable' };

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function isISODate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  // A well-formed string is not a real date: 2026-02-31 matches the shape and
  // rolls over to 3 March when parsed, silently moving a deadline.
  return toISODate(fromISODate(v)) === v;
}

/**
 * Warranties were free text before they were a clock. A backup written by that
 * version is still a real backup, so its string is kept as the note and the
 * receipt simply carries no clock — dropping the row, or inventing a length
 * from prose, would both be worse than saying less.
 */
function readWarranty(raw: unknown): Warranty | undefined {
  if (isStr(raw)) return { months: 0, note: raw };
  if (typeof raw !== 'object' || raw === null) return undefined;
  const w = raw as Record<string, unknown>;
  if (typeof w.months !== 'number' || !Number.isInteger(w.months) || w.months < 0 || w.months > 1200) return undefined;
  return { months: w.months, ...(isStr(w.note) ? { note: w.note } : {}) };
}

/**
 * One row, validated field by field. Returns null when it cannot be trusted.
 *
 * Exported because the app's OWN storage needs exactly this: localStorage is
 * no more trustworthy than a file off a disk — a truncated write, an
 * interrupted save, a future migration, a hand-edit — and a single unreadable
 * row used to take the whole app down with it.
 */
/**
 * Was this bought at a distance?
 *
 * Rows written before the rights were separated carry `legalDays: 14 | 30`
 * instead, which conflated "which single right to show" with "how it was
 * bought". 14 was only ever set on a purchase the app treated as distance, so
 * that is the honest reading of it — and this has to keep working, because a
 * backup someone exported last week is a file they can still import today.
 */
function readDistance(r: Record<string, unknown>): boolean | null {
  if (typeof r.distance === 'boolean') return r.distance;
  if (r.legalDays === 14) return true;
  if (r.legalDays === 30) return false;
  return null;
}

export function readReceipt(raw: unknown): Receipt | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isStr(r.id) || !isStr(r.store) || !isStr(r.item) || !isStr(r.policy)) return null;
  if (!isISODate(r.purchasedOn)) return null;
  if (r.windowStartsOn !== undefined && !isISODate(r.windowStartsOn)) return null;
  if (r.arrivedOn !== undefined && !isISODate(r.arrivedOn)) return null;
  if (typeof r.windowDays !== 'number' || !Number.isInteger(r.windowDays) || r.windowDays < 1) return null;
  // Amounts are integer pence everywhere; a float here means a file written by
  // something that did not understand that, and rounding it silently would
  // change what the app tells someone they are owed.
  if (typeof r.amount !== 'number' || !Number.isInteger(r.amount) || r.amount < 0) return null;
  const distance = readDistance(r);
  if (distance === null) return null;
  if (!STATUSES.includes(r.status as ReceiptStatus)) return null;
  if (r.returnedOn !== undefined && !isISODate(r.returnedOn)) return null;

  return {
    id: r.id,
    // Resolved to the shop's own name, here rather than at either call site,
    // because this is the one door both the app's own store and an imported
    // backup come through. `assess` matches a policy update's affectsStores
    // exactly, so a receipt reading "boots" is one every Boots change misses —
    // and rows saved before the add and edit screens agreed about this are
    // already sitting on people's devices. It only ever changes case and
    // spacing: a shop the table does not know is kept exactly as written.
    store: canonicalStoreName(r.store),
    item: r.item,
    // An unknown category is cosmetic — it picks a row icon — so it falls back
    // rather than costing the user a receipt.
    cat: CATEGORIES.includes(r.cat as Category) ? (r.cat as Category) : 'other',
    amount: r.amount,
    purchasedOn: r.purchasedOn,
    ...(r.windowStartsOn !== undefined ? { windowStartsOn: r.windowStartsOn as string } : {}),
    ...(r.arrivedOn !== undefined ? { arrivedOn: r.arrivedOn as string } : {}),
    windowDays: r.windowDays,
    policy: r.policy,
    distance,
    ...(() => {
      const warranty = readWarranty(r.warranty);
      return warranty ? { warranty } : {};
    })(),
    ...(isStr(r.gotcha) ? { gotcha: r.gotcha } : {}),
    status: r.status as ReceiptStatus,
    ...(r.returnedOn !== undefined ? { returnedOn: r.returnedOn as string } : {}),
  };
}

export function parseBackup(text: string): ImportOutcome {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (typeof doc !== 'object' || doc === null) return { ok: false, reason: 'not-a-kept-backup' };

  const d = doc as Record<string, unknown>;
  if (d.app !== 'kept' || !Array.isArray(d.receipts)) return { ok: false, reason: 'not-a-kept-backup' };

  const receipts: Receipt[] = [];
  let skipped = 0;
  for (const raw of d.receipts) {
    const r = readReceipt(raw);
    if (r) receipts.push(r);
    else skipped += 1;
  }

  // An empty backup is a legitimate file (someone with no receipts exported
  // one); a file whose every row was rejected is not, and saying so beats
  // reporting a successful restore of nothing.
  if (receipts.length === 0 && skipped > 0) return { ok: false, reason: 'nothing-usable' };

  return { ok: true, summary: { receipts, skipped } };
}

export interface MergeResult {
  receipts: Receipt[];
  added: number;
  replaced: number;
}

/**
 * Merge, never replace. A restore onto a phone that already has receipts must
 * not silently discard the ones added since the backup was taken — so rows are
 * matched by id, and everything local survives.
 *
 * For a row on both sides the backup supplies the DETAILS and the device keeps
 * the STATE. That asymmetry is the whole of this function's judgement, and it
 * is there because the obvious rule — the incoming copy wins outright — loses
 * money in the ordinary case:
 *
 *   Monday, export a backup. Tuesday, take the headphones back; £89 recovered,
 *   the receipt marked returned. Wednesday, restore Monday's file to recover a
 *   receipt deleted by mistake — and the headphones silently revert to active,
 *   `returnedOn` disappears, £89 vanishes from the money-back total, and the
 *   app starts telling you to return something you already returned.
 *
 * `returned` records something that happened in the world. `active` records
 * only that it has not happened yet, so a file written before it happened
 * cannot be evidence against it. The same asymmetry protects the other
 * direction: someone who marked a receipt returned by a stray swipe and used
 * "Not actually returned" does not have that undone by a restore either.
 *
 * A row absent locally comes in whole, state included — that is the case a
 * restore exists for, and there is nothing on the device to contradict it.
 */
export function mergeBackup(current: readonly Receipt[], incoming: readonly Receipt[]): MergeResult {
  const byId = new Map(current.map((r) => [r.id, r]));
  let added = 0;
  let replaced = 0;
  for (const r of incoming) {
    const here = byId.get(r.id);
    if (!here) {
      added += 1;
      byId.set(r.id, r);
      continue;
    }
    replaced += 1;
    byId.set(r.id, {
      ...r,
      status: here.status,
      // Deleted rather than carried over when the device says active, so an
      // active receipt never keeps a refund date from the file.
      ...(here.returnedOn !== undefined ? { returnedOn: here.returnedOn } : { returnedOn: undefined }),
    });
  }
  return { receipts: [...byId.values()], added, replaced };
}
