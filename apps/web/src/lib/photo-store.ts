/**
 * Where a photograph waits for a connection.
 *
 * IndexedDB, because it is the only browser store that holds a BLOB. `localStorage`
 * takes strings, so a JPEG would have to be base64'd — a third larger, in a store
 * with a 5 MB budget shared with everything else, which a handful of site
 * photographs would fill. The decision is not a preference: a camera photograph
 * is two to four megabytes.
 *
 * Behind an interface with an in-memory implementation beside it, so the queue's
 * own decisions are tested without a database — `photo-queue.test.ts` is where
 * the judgement is proven, and this file is the thin part that cannot be unit
 * tested in a Node environment with no `indexedDB`. `e2e/field-offline.spec.ts`
 * is what exercises the real one, in a real browser, across a real reload.
 *
 * Every method answers rather than throwing. A surveyor whose browser refuses
 * IndexedDB — a private window, a locked-down device, a quota that is full —
 * must still be able to take photographs and upload them; they lose durability,
 * not the camera. The caller treats an empty store as an empty queue, which is
 * what it is.
 *
 * NOT closed, and said rather than implied: two TABS of the field app share this
 * store and could both find the same record unsent and upload it, which would
 * file the photograph twice. `drainOnce`'s guard is per-tab (one drain at a time)
 * and `patch` is atomic, so nothing is LOST that way — but nothing claims a
 * record either, and a claim needs a lease with an expiry, since a tab that dies
 * holding one must not park the photograph for ever. One tab is the ordinary
 * case on a phone; the duplicate is a visible extra row in the site log rather
 * than a lost one, which is the right way round for it to fail.
 */
import type { QueuedPhoto } from './photo-queue';

export type StoredPhoto = { record: QueuedPhoto; blob: Blob };

export interface PhotoStore {
  put(record: QueuedPhoto, blob: Blob): Promise<void>;
  /** Update the record in place, keeping its blob. No-op if it has gone. */
  patch(localId: string, patch: Partial<QueuedPhoto>): Promise<void>;
  all(): Promise<StoredPhoto[]>;
  remove(localId: string): Promise<void>;
}

const DB_NAME = 'apex-field';
const STORE = 'photo-queue';

const open = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'localId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });

const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    let req: IDBRequest<T>;
    try {
      req = run(db.transaction(STORE, mode).objectStore(STORE));
    } catch {
      db.close();
      return resolve(null);
    }
    req.onsuccess = () => {
      resolve(req.result);
      db.close();
    };
    req.onerror = () => {
      resolve(null);
      db.close();
    };
  });
};

/** The real store. A failure of any kind reads as "nothing queued". */
export const indexedDbPhotoStore: PhotoStore = {
  async put(record, blob) {
    await tx('readwrite', (s) => s.put({ localId: record.localId, record, blob }));
  },
  /**
   * Read and write in ONE transaction, not two.
   *
   * A get in its own transaction followed by a put in another is a
   * read-modify-write with a gap, and the two writes that matter here land in
   * that gap: `photoId` from a successful upload and `attempts` from a failed
   * one. Losing either costs a photograph its attribution or its place in the
   * queue, so the gap is closed rather than argued about.
   */
  async patch(localId, patch) {
    const db = await open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      let t: IDBTransaction;
      try {
        t = db.transaction(STORE, 'readwrite');
      } catch {
        db.close();
        return resolve();
      }
      const store = t.objectStore(STORE);
      const get = store.get(localId);
      get.onsuccess = () => {
        const row = get.result as StoredPhoto | undefined;
        if (row?.record) store.put({ localId, record: { ...row.record, ...patch }, blob: row.blob });
      };
      const done = () => {
        resolve();
        db.close();
      };
      t.oncomplete = done;
      t.onerror = done;
      t.onabort = done;
    });
  },
  async all() {
    const rows = await tx<Array<{ record: QueuedPhoto; blob: Blob }>>('readonly', (s) => s.getAll());
    return (rows ?? []).filter((r) => !!r?.record && !!r?.blob);
  },
  async remove(localId) {
    await tx('readwrite', (s) => s.delete(localId));
  },
};

/**
 * The same contract, in memory.
 *
 * Not a test double for its own sake: it is what the field app falls back to when
 * `indexedDB` is absent, so the camera keeps working where durability cannot. It
 * is also what makes the queue's behaviour drivable in a unit test.
 */
export function memoryPhotoStore(): PhotoStore {
  const rows = new Map<string, StoredPhoto>();
  return {
    async put(record, blob) {
      rows.set(record.localId, { record, blob });
    },
    async patch(localId, patch) {
      const row = rows.get(localId);
      if (row) rows.set(localId, { ...row, record: { ...row.record, ...patch } });
    },
    async all() {
      return [...rows.values()];
    },
    async remove(localId) {
      rows.delete(localId);
    },
  };
}
