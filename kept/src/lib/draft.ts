import { daysBetween, fromISODate, toISODate } from './dates';
import { toPence, type Pence } from './money';
import { findStore } from './stores';
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
}

export type DraftField = keyof ReceiptDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

/** Ten years. Longer than any real return window, including IKEA's 365 days. */
const MAX_WINDOW_DAYS = 3650;
/** £1,000,000. Above this a typo is far likelier than a purchase. */
const MAX_AMOUNT_PENCE = 100_000_000;

export interface ValidDraft {
  store: string;
  item: string;
  cat: Category;
  amount: Pence;
  purchasedOn: string;
  windowDays: number;
}

export type DraftOutcome = { ok: true; value: ValidDraft } | { ok: false; errors: DraftErrors };

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

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { store, item, cat: draft.cat, amount, purchasedOn, windowDays } };
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
  };
}

/**
 * Apply an edit. The policy text follows the shop when the shop changes —
 * otherwise correcting "Currys" to "Argos" would leave Currys' 14-day wording
 * sitting under an Argos receipt, which is exactly the kind of quietly wrong
 * this app exists to prevent.
 */
export function applyDraft(original: Receipt, valid: ValidDraft): Receipt {
  const storeChanged = original.store !== valid.store;
  const policy = storeChanged ? findStore(valid.store) : undefined;

  return {
    ...original,
    store: valid.store,
    item: valid.item,
    cat: valid.cat,
    amount: valid.amount,
    purchasedOn: valid.purchasedOn,
    windowDays: valid.windowDays,
    ...(storeChanged
      ? {
          policy: policy?.policy ?? `${valid.store} · ${valid.windowDays}-day return window as entered — check the receipt.`,
          gotcha: policy?.gotcha,
          // The old shop's dispatch clock does not follow the receipt to a new
          // shop; without this, a Zara window start would keep governing an
          // Argos purchase.
          windowStartsOn: undefined,
        }
      : {}),
  };
}
