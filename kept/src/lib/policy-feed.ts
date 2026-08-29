import { derive } from './receipts';
import type { PolicyUpdate, Receipt } from './types';

/**
 * Policy updates, and what they actually mean for receipts already held.
 *
 * Two claims were being made that needed separating. "Kept ships verified
 * policy updates the day they change" is a delivery problem, solved below by
 * fetching a feed instead of freezing one into the bundle. "Every deadline on
 * your receipts re-calculates itself" is a different claim, and a wrong one:
 * the terms a purchase was made under are the terms that govern it, so
 * silently rewriting an existing receipt's window because a shop changed its
 * page would tell someone they have less time than they actually do.
 *
 * What the app can honestly do — and what the design's own Zara card already
 * said, "your deadlines: unchanged, already checked" — is CHECK. A receipt
 * keeps the window it was bought under; the change is surfaced, with what it
 * would have meant, and the person decides.
 */

export type ImpactKind = 'unchanged' | 'shorter' | 'longer' | 'informational';

export interface ReceiptImpact {
  receipt: Receipt;
  kind: ImpactKind;
  /** One line, in the second person, about this receipt specifically. */
  note: string;
}

export interface AssessedUpdate {
  update: PolicyUpdate;
  /** Only receipts the person actually holds. Empty means this is just news. */
  impacts: ReceiptImpact[];
  affectsYou: boolean;
}

function impactFor(update: PolicyUpdate, receipt: Receipt, today: Date): ReceiptImpact {
  const next = update.newWindowDays;
  const note = update.affectNote.trim();
  if (next === undefined) {
    // A note is not guaranteed: `mergeFeed` defaults a missing one to ''. The
    // renderer writes "{item} — {note}", so an empty one printed a dangling
    // dash after the receipt's name.
    return { receipt, kind: 'informational', note: note || 'worth a read — your deadline is unaffected' };
  }
  if (next === receipt.windowDays) {
    /*
     * Unchanged is the common case, and it was the one that threw the
     * feed's own advice away.
     *
     * Zara's change was the postal-returns fee: the window stayed 30 days,
     * so this branch fired and told the holder of a Zara coat "deadline
     * unchanged, already checked" — true, and useless, while the sentence
     * that would have saved them £1.95, "drop off in store to keep it
     * free", sat in the same update unread. Currys the same: the price-match
     * note is the whole point of that entry and its window did not move.
     *
     * The reassurance still leads, because "has my deadline moved" is the
     * question the tab exists to answer. The advice follows it, after a "·"
     * rather than a dash: the card already writes "{item} — {note}", and two
     * em-dashes in one line read as one sentence interrupted twice.
     */
    return { receipt, kind: 'unchanged', note: note ? `deadline unchanged · ${note}` : 'deadline unchanged, already checked' };
  }
  // Below, `affectNote` is deliberately NOT used. It is written for someone
  // reading the news — ASOS's "your window is the shorter one" — and for a
  // receipt already held it is false: that receipt keeps the window it was
  // bought under. The derived sentence is both more specific and true.
  const days = Math.abs(next - receipt.windowDays);
  const unit = days === 1 ? 'day' : 'days';
  if (next < receipt.windowDays) {
    // The frightening case, and the one the app exists for. Deliberately
    // reassuring about what does NOT change: the receipt keeps its own terms.
    const d = derive(receipt, today);
    return {
      receipt,
      kind: 'shorter',
      note:
        `new purchases get ${days} ${unit} less; yours keeps the ${receipt.windowDays} days it was bought under ` +
        `(${d.daysLeft < 0 ? 'window closed' : `${d.daysLeft} days left`})`,
    };
  }
  return {
    receipt,
    kind: 'longer',
    note: `new purchases get ${days} ${unit} more; yours keeps the ${receipt.windowDays} days it was bought under`,
  };
}

export function assess(updates: readonly PolicyUpdate[], receipts: readonly Receipt[], today: Date): AssessedUpdate[] {
  const active = receipts.filter((r) => r.status === 'active');
  return updates.map((update) => {
    const impacts = active
      .filter((r) => update.affectsStores.includes(r.store))
      .map((r) => impactFor(update, r, today));
    return { update, impacts, affectsYou: impacts.length > 0 };
  });
}

/**
 * How much news this app is willing to carry.
 *
 * The updates live in the same localStorage bucket as the receipts, and until
 * this cap existed nothing ever removed one: `mergeFeed` was union-only by
 * design, so the list could only grow. That is fine while the feed behaves and
 * indefensible when it does not — one oversized or misgenerated response is
 * persisted permanently, and no later, correct feed shrinks it again. What
 * fails then is not the Watch tab being long: it is `save` refusing the whole
 * state, so the receipts stop persisting, and the only way out is Erase
 * everything, which takes the receipts too.
 *
 * A count is the right bound rather than an age, because an age limit still
 * admits ten thousand changes all dated today. Two hundred is far more news
 * than anyone reads — about 60KB — and is deliberately applied by date, so
 * what gets forgotten is the oldest, which is also the least likely to be
 * about a receipt still inside its window.
 */
export const MAX_UPDATES = 200;

/** Newest first, and no more of them than we are willing to keep. */
function newestFirst(updates: PolicyUpdate[]): PolicyUpdate[] {
  return updates.sort((a, b) => b.changedOn.localeCompare(a.changedOn)).slice(0, MAX_UPDATES);
}

/**
 * Merge a downloaded feed over what is already held.
 *
 * By id, newest wins, and anything only present locally survives — the same
 * discipline as a backup restore, for the same reason: a feed that failed to
 * mention an update must not delete it. Bounded, though: see MAX_UPDATES for
 * why "never delete" could not stay unqualified.
 */
export function mergeFeed(current: readonly PolicyUpdate[], incoming: readonly PolicyUpdate[]): PolicyUpdate[] {
  const byId = new Map(current.map((u) => [u.id, u]));
  for (const u of incoming) byId.set(u.id, u);
  return newestFirst([...byId.values()]);
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Validate a downloaded feed. It arrives over the network, so nothing in it is
 * trusted: a malformed entry is dropped rather than allowed to reach a screen,
 * and an oversized document is cut down to the newest MAX_UPDATES rather than
 * refused outright — a feed that grew past the cap should still deliver
 * today's change, not go quiet.
 */
export function readFeed(doc: unknown): PolicyUpdate[] | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const d = doc as Record<string, unknown>;
  if (d.feed !== 'kept-policy' || !Array.isArray(d.updates)) return null;

  const out: PolicyUpdate[] = [];
  for (const raw of d.updates) {
    if (typeof raw !== 'object' || raw === null) continue;
    const u = raw as Record<string, unknown>;
    if (!isStr(u.id) || !isStr(u.store) || !isStr(u.text)) continue;
    if (!isStr(u.changedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(u.changedOn)) continue;
    if (!Array.isArray(u.affectsStores) || !u.affectsStores.every(isStr)) continue;
    if (u.newWindowDays !== undefined && (!Number.isInteger(u.newWindowDays) || (u.newWindowDays as number) < 1)) continue;
    out.push({
      id: u.id,
      store: u.store,
      changedOn: u.changedOn,
      text: u.text,
      affectsStores: u.affectsStores as string[],
      affectNote: isStr(u.affectNote) ? u.affectNote : '',
      ...(u.newWindowDays !== undefined ? { newWindowDays: u.newWindowDays as number } : {}),
    });
  }
  return newestFirst(out);
}

/** Where the feed lives — this app's own origin, never anyone else's. */
export const FEED_URL = '/policy-feed.json';
