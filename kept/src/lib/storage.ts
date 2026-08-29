import { readReceipt } from './backup';
import { readFeed } from './policy-feed';
import { seedReceipts, seedUpdates } from './seed';
import type { PolicyUpdate, Receipt } from './types';
import { DEFAULT_URGENT_DAYS } from './urgency';

/**
 * Local-first persistence.
 *
 * There is no sync layer to add later and no account to attach one to: the
 * privacy notice says receipts never leave the device, so localStorage IS the
 * database. Everything below is written on that assumption — the schema is
 * versioned because the only migration path runs on the user's own phone,
 * and every read is defensive because the store can be cleared, quota-capped
 * or hand-edited between two launches and the app still has to open.
 */

const KEY = 'kept.v1';
const SCHEMA_VERSION = 1;

export interface Settings {
  urgentDays: number;
  /** The free tier caps the library; the paid tiers do not. */
  plan: 'free' | 'pro';
  deadlineAlerts: boolean;
  policyWatch: boolean;
}

export interface KeptState {
  version: number;
  receipts: Receipt[];
  updates: PolicyUpdate[];
  onboardingSeen: boolean;
  settings: Settings;
  /**
   * Dedup keys for deadline alerts already delivered. Persisted, because the
   * whole value of an alert is that it arrives once — a list that reset on
   * reload would re-announce the same coat every launch.
   */
  alertsSent: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  urgentDays: DEFAULT_URGENT_DAYS,
  plan: 'free',
  deadlineAlerts: true,
  policyWatch: true,
};

export function freshState(today: Date): KeptState {
  return {
    version: SCHEMA_VERSION,
    receipts: seedReceipts(today),
    updates: seedUpdates(today),
    onboardingSeen: false,
    settings: { ...DEFAULT_SETTINGS },
    alertsSent: [],
  };
}

function storage(): Storage | null {
  // Safari in private mode throws on access, not on write. A thrown getter
  // must degrade to an in-memory session, never to a blank screen.
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Turn whatever was on disk into state the app can survive.
 *
 * Every row is validated with the same reader the backup importer uses, and an
 * unreadable one is dropped rather than trusted. This is not paranoia about a
 * file someone chose to import — it is about the app's own store, which held a
 * receipt with no purchase date and produced a completely blank screen on
 * every launch thereafter, with no way out but clearing site data by hand.
 *
 * Dropping a row loses something. It loses one receipt instead of all of them
 * plus the app, and the row was already unreadable.
 *
 * Separated from `load` so it can be tested without a browser.
 */
export function hydrate(raw: unknown, today: Date): KeptState {
  if (typeof raw !== 'object' || raw === null) return freshState(today);
  const parsed = raw as Partial<KeptState>;
  if (!Array.isArray(parsed.receipts)) return freshState(today);

  const receipts: Receipt[] = [];
  for (const row of parsed.receipts) {
    const r = readReceipt(row);
    if (r) receipts.push(r);
  }

  // Policy updates are downloadable content, not user data — reseeding is
  // always safe and keeps the feed current on an old install. Validated the
  // same way, through the reader the network path already uses.
  const storedUpdates = Array.isArray(parsed.updates)
    ? readFeed({ feed: 'kept-policy', updates: parsed.updates }) ?? []
    : [];

  return {
    version: SCHEMA_VERSION,
    receipts,
    updates: storedUpdates.length ? storedUpdates : seedUpdates(today),
    onboardingSeen: parsed.onboardingSeen === true,
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    alertsSent: Array.isArray(parsed.alertsSent) ? parsed.alertsSent.filter((k) => typeof k === 'string') : [],
  };
}

export function load(today: Date): KeptState {
  const store = storage();
  const raw = store?.getItem(KEY);
  if (!raw) return freshState(today);
  try {
    return hydrate(JSON.parse(raw), today);
  } catch {
    // Corrupt JSON: start clean rather than trap the user on a broken launch.
    return freshState(today);
  }
}

export function save(state: KeptState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded. The in-memory state is still correct for this session;
    // failing the write silently beats throwing inside a render.
  }
}

/**
 * Erase everything this app has stored.
 *
 * On a product whose entire promise is that the data is yours and lives here,
 * being able to take it all back is not a nice-to-have. Uninstalling clears a
 * native app; a web app's storage outlives a closed tab and clearing it by
 * hand means digging through browser settings.
 */
export function wipe(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // Nothing more to do — the in-memory state is reset by the caller either
    // way, and a storage that refuses writes has nothing persisted to remove.
  }
}

/** The Settings screen's "Export a backup" — the user's data, in their hands. */
export function exportBackup(state: KeptState): string {
  return JSON.stringify(
    { app: 'kept', exportedAt: new Date().toISOString(), version: state.version, receipts: state.receipts, settings: state.settings },
    null,
    2,
  );
}
