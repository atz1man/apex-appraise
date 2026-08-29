import { daysBetween, fromISODate, toISODate } from './dates';
import { toPence, type Pence } from './money';
import { canonicalStoreName, findStore, policyFor } from './stores';
import type { Category, Receipt } from './types';

/**
 * The editable shape of a receipt, and the rules for turning it back into one.
 *
 * A receipt saved from a pasted email arrives half-known — the parser can read
 * a shop and a total but not what the thing actually was — so "From pasted
 * email" sat in the list forever with no way to correct it. Everything a
 * person might need to fix is editable here, and validated in one place so
 * the add flow and the edit screen cannot disagree about what a valid receipt
 * is.
 */
export interface ReceiptDraft {
  store: string;
  item: string;
  cat: Category;
  /** Free text as typed: "89", "89.00", "£89". */
  amountText: string;
  purchasedOn: string;
  windowDaysText: string;
  /** Blank means no warranty at all — not a warranty of zero months. */
  warrantyMonthsText: string;
  /**
   * Ordered online, by phone, or away from the shop. Editable because it
   * decides whether the app states a 14-day right to cancel for any reason,
   * and that right does not exist for something bought over a counter — see
   * legal.ts. It is not a free-text field and cannot fail validation, but it
   * belongs in the draft so the edit screen can change it.
   */
  distance: boolean;
  /**
   * The day it arrived, blank when unknown or when it has not. Only asked for
   * on a distance purchase — a counter purchase arrives when it is bought.
   */
  arrivedOnText: string;
}

export type DraftField = keyof ReceiptDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

/** Ten years. Longer than any real return window, including IKEA's 365 days. */
const MAX_WINDOW_DAYS = 3650;
/** £1,000,000. Above this a typo is far likelier than a purchase. */
const MAX_AMOUNT_PENCE = 100_000_000;
/** A hundred years. Longer than any guarantee anyone will honour. */
const MAX_WARRANTY_MONTHS = 1200;

export interface ValidDraft {
  store: string;
  item: string;
  cat: Category;
  amount: Pence;
  purchasedOn: string;
  windowDays: number;
  /** Absent when the receipt should carry no warranty clock. */
  warrantyMonths?: number;
  distance: boolean;
  /** Absent when unknown; both statutory clocks then fall back to the order. */
  arrivedOn?: string;
}

export type DraftOutcome = { ok: true; value: ValidDraft } | { ok: false; errors: DraftErrors };

/**
 * What is wrong with a stated arrival date, or nothing.
 *
 * Exported because the ADD screen asks for the same date and had no rule at
 * all: the browser marked its field invalid for a date before the order and
 * the app saved it regardless, 19 days early in the case that found this. Both
 * statutory clocks start there, so an arrival before the purchase reports a
 * live right as expired — the direction this app exists not to get wrong.
 *
 * One function so the two screens cannot disagree, which is the failure this
 * codebase keeps having: `effectiveWindowStart` and `canonicalStoreName` are
 * here for the same reason.
 */
export function arrivalProblem(arrivedOn: string, purchasedOn: string, today: Date): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrivedOn) || toISODate(fromISODate(arrivedOn)) !== arrivedOn) {
    return 'Pick the day it arrived, or leave it blank';
  }
  if (daysBetween(today, fromISODate(arrivedOn)) > 0) return 'That date is in the future';
  if (daysBetween(fromISODate(purchasedOn), fromISODate(arrivedOn)) < 0) {
    return 'It cannot have arrived before you ordered it';
  }
  return undefined;
}

export function validateDraft(draft: ReceiptDraft, today: Date): DraftOutcome {
  const errors: DraftErrors = {};

  const store = draft.store.trim();
  if (!store) errors.store = 'Which shop was it?';

  const item = draft.item.trim();
  if (!item) errors.item = 'What was it?';

  // Accept what people actually type — a leading £, spaces, thousands commas.
  const cleaned = draft.amountText.replace(/[£\s,]/g, '');
  const amountNum = Number(cleaned);
  let amount = 0;
  if (!cleaned || !Number.isFinite(amountNum)) {
    errors.amountText = 'Enter the amount, like 24.99';
  } else if (amountNum < 0) {
    errors.amountText = 'An amount cannot be negative';
  } else if (!/^\d*\.?\d{0,2}$/.test(cleaned)) {
    errors.amountText = 'Amounts go to the penny, like 24.99';
  } else {
    amount = toPence(amountNum);
    if (amount > MAX_AMOUNT_PENCE) errors.amountText = 'That looks like a typo — check the amount';
  }

  const purchasedOn = draft.purchasedOn;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn) || toISODate(fromISODate(purchasedOn)) !== purchasedOn) {
    errors.purchasedOn = 'Pick the date you bought it';
  } else if (daysBetween(today, fromISODate(purchasedOn)) > 0) {
    // A return clock cannot start in the future, and letting it would report a
    // window far longer than the shop will honour.
    errors.purchasedOn = 'That date is in the future';
  }

  const windowDays = Number(draft.windowDaysText.trim());
  if (!draft.windowDaysText.trim() || !Number.isInteger(windowDays) || windowDays < 1) {
    errors.windowDaysText = 'How many days does the shop give you?';
  } else if (windowDays > MAX_WINDOW_DAYS) {
    errors.windowDaysText = 'That is longer than any real return window';
  }

  const arrivedRaw = draft.arrivedOnText.trim();
  let arrivedOn: string | undefined;
  if (arrivedRaw && draft.distance) {
    const problem = errors.purchasedOn ? undefined : arrivalProblem(arrivedRaw, purchasedOn, today);
    if (problem) errors.arrivedOnText = problem;
    else arrivedOn = arrivedRaw;
  }

  const warrantyRaw = draft.warrantyMonthsText.trim();
  let warrantyMonths: number | undefined;
  if (warrantyRaw) {
    const months = Number(warrantyRaw);
    if (!Number.isInteger(months) || months < 1) errors.warrantyMonthsText = 'Whole months, or leave it blank';
    else if (months > MAX_WARRANTY_MONTHS) errors.warrantyMonthsText = 'Longer than any guarantee anyone honours';
    else warrantyMonths = months;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      store, item, cat: draft.cat, amount, purchasedOn, windowDays, distance: draft.distance,
      ...(arrivedOn ? { arrivedOn } : {}),
      ...(warrantyMonths ? { warrantyMonths } : {}),
    },
  };
}

export function draftFrom(r: Receipt): ReceiptDraft {
  return {
    store: r.store,
    item: r.item,
    cat: r.cat,
    // Pence back to a plain editable string — never "£89.00", so the field
    // round-trips through validateDraft without the user deleting anything.
    amountText: (r.amount / 100).toFixed(2),
    purchasedOn: r.purchasedOn,
    windowDaysText: String(r.windowDays),
    warrantyMonthsText: r.warranty && r.warranty.months > 0 ? String(r.warranty.months) : '',
    distance: r.distance,
    arrivedOnText: r.arrivedOn ?? '',
  };
}

/**
 * The date the return window will actually count from once this draft is
 * saved.
 *
 * Exported because the edit screen has to preview the deadline, and computing
 * that separately is how the preview came to disagree with the receipt by two
 * days: it counted from the purchase date while the receipt counted from
 * dispatch. One rule, used by both.
 *
 * A dispatch date belongs to the shop that dispatched it, so changing the shop
 * discards it — the same condition applyDraft uses.
 */
export function effectiveWindowStart(original: Receipt, draft: ReceiptDraft): string {
  // Compared on the canonical name, like applyDraft below. Retyping "Boots" as
  // "boots" is not a change of shop, and if these two disagreed about that the
  // preview would drop a dispatch clock the save keeps — which is the exact
  // disagreement this function exists to prevent.
  const storeChanged = original.store !== canonicalStoreName(draft.store);
  return !storeChanged && original.windowStartsOn ? original.windowStartsOn : draft.purchasedOn;
}

/**
 * Apply an edit. The policy text follows the shop when the shop changes —
 * otherwise correcting "Currys" to "Argos" would leave Currys' 14-day wording
 * sitting under an Argos receipt, which is exactly the kind of quietly wrong
 * this app exists to prevent.
 */
export function applyDraft(original: Receipt, valid: ValidDraft): Receipt {
  // The shop's own name, not the casing someone happened to type. A receipt
  // saved as "boots" carries Boots' verified policy and is missed by every
  // change Boots publishes, because `assess` matches the name exactly — the
  // add screen already resolved this and the edit screen did not, so the two
  // ways into the same field disagreed.
  const store = canonicalStoreName(valid.store);
  const storeChanged = original.store !== store;
  const policy = storeChanged ? findStore(store) : undefined;

  return {
    ...original,
    store,
    item: valid.item,
    cat: valid.cat,
    amount: valid.amount,
    purchasedOn: valid.purchasedOn,
    windowDays: valid.windowDays,
    distance: valid.distance,
    // Clearing the field clears the date, and so does saying it was bought in
    // a shop — a counter purchase has no separate arrival.
    arrivedOn: valid.distance ? valid.arrivedOn : undefined,
    // Clearing the field clears the clock. The note, if any, came from the
    // manufacturer's own wording and is kept only while a clock is there to
    // caption.
    warranty: valid.warrantyMonths
      ? { months: valid.warrantyMonths, ...(original.warranty?.note ? { note: original.warranty.note } : {}) }
      : undefined,
    // Re-derived when the SHOP or the WINDOW changes, and only then.
    //
    // Editing the window alone used to leave the policy card quoting the
    // shop's number while the deadline counted the edited one — fifteen days
    // apart on one screen, with the card being the wording someone repeats at
    // a counter.
    //
    // Not on every save, though. A receipt's policy sentence is the terms it
    // was bought under, and rewriting it to the table's CURRENT wording just
    // because someone opened the edit screen and pressed save is the same
    // silent rewriting that policy-feed.ts refuses to do to a deadline.
    ...(storeChanged || valid.windowDays !== original.windowDays
      ? { policy: policyFor(store, valid.windowDays) }
      : {}),
    ...(storeChanged
      ? {
          gotcha: policy?.gotcha,
          // The old shop's dispatch clock does not follow the receipt to a new
          // shop; without this, a Zara window start would keep governing an
          // Argos purchase. effectiveWindowStart encodes the same condition,
          // so the edit screen's deadline preview agrees with what lands here.
          windowStartsOn: undefined,
        }
      : {}),
  };
}
