/**
 * Working the queue: upload what is due, then forget what has been filed.
 *
 * Lifted out of the component because it is the part with consequences. Three
 * things it must get right, and each is a way to lose or duplicate a valuer's
 * evidence:
 *
 *   a record is removed only once BOTH steps are done — the server holds the
 *   photograph, and the inspection names it. Deleting on upload would lose the
 *   attribution; deleting on neither loses the photograph.
 *
 *   a failed attempt increments and REQUEUES rather than dropping. `attempts`
 *   and a fresh `queuedAt` are what the backoff reads, so a record that fails
 *   forever retries forever, more and more slowly.
 *
 *   an upload that succeeded is never repeated. The `photoId` is written before
 *   anything else can run, so a second drain overlapping the first finds the
 *   record filed and leaves it alone. That holds within a tab; `photo-store.ts`
 *   says what two tabs can still do and why it fails the right way round.
 */
import { backoffFor, dueForUpload, type QueuedPhoto } from './photo-queue';
import type { PhotoStore, StoredPhoto } from './photo-store';

export type UploadOutcome = { ok: true; photoId: string } | { ok: false; error: string };

export type DrainResult = {
  uploaded: string[];
  failed: Array<{ localId: string; error: string }>;
};

/**
 * Attempt every due record once.
 *
 * `upload` is injected rather than imported: the caller owns the token, the
 * route and the FormData, and this owns what to do with the answer. One pass
 * only — the caller decides when to come back, because "keep going until it
 * works" in a loop is how a phone with no signal spends its battery.
 */
export async function drainOnce(
  store: PhotoStore,
  upload: (record: QueuedPhoto, blob: Blob) => Promise<UploadOutcome>,
  now: () => number = Date.now,
): Promise<DrainResult> {
  const rows = await store.all();
  const byId = new Map(rows.map((r) => [r.record.localId, r]));
  const due = dueForUpload(rows.map((r) => r.record), now());
  const out: DrainResult = { uploaded: [], failed: [] };

  for (const record of due) {
    const row = byId.get(record.localId) as StoredPhoto | undefined;
    if (!row) continue;
    const res = await upload(record, row.blob);
    if (res.ok) {
      // written FIRST, so a later drain in this tab sees it filed and skips it
      await store.patch(record.localId, { photoId: res.photoId, lastError: undefined });
      out.uploaded.push(record.localId);
    } else {
      await store.patch(record.localId, {
        attempts: record.attempts + 1,
        queuedAt: now(),
        lastError: res.error,
      });
      out.failed.push({ localId: record.localId, error: res.error });
    }
  }
  return out;
}

/**
 * Forget the records an inspection has now named.
 *
 * Called with the ids the SERVER accepted on the save — never with what the
 * screen was holding, because `inspections.save` verifies every id and refuses
 * the whole save if one is unknown. A record removed on the strength of a save
 * that was refused would lose the photograph's attribution for good.
 */
export async function forgetAttributed(store: PhotoStore, namedPhotoIds: readonly string[]): Promise<number> {
  const named = new Set(namedPhotoIds);
  const rows = await store.all();
  let gone = 0;
  for (const { record } of rows) {
    if (record.photoId && named.has(record.photoId)) {
      await store.remove(record.localId);
      gone++;
    }
  }
  return gone;
}

/**
 * Bring every pending record forward, because what the backoff was waiting for
 * has happened.
 *
 * The backoff exists to stop a phone with no signal retrying every second until
 * the battery is flat — which loses the photographs by another route. The
 * browser's `online` event is positive evidence that the condition has changed,
 * and a backoff that outlives its reason is just a wait: a surveyor who walks
 * out of a basement should watch the queue flush, not wonder for fifteen minutes
 * whether it is working.
 *
 * The attempt COUNT is deliberately left alone. It is the record of how many
 * tries this photograph has taken, and clearing it would put a record back on a
 * one-second retry when the signal that just returned turns out not to reach
 * this server — the case the cap was written for.
 */
export async function bringForward(store: PhotoStore, now: () => number = Date.now): Promise<number> {
  const rows = await store.all();
  let moved = 0;
  for (const { record } of rows) {
    if (record.photoId) continue;
    // its wait is treated as served, rather than zeroed: `queuedAt: 0` is only
    // "due now" because a real clock is thirteen digits, which is a coincidence
    // and not a rule
    await store.patch(record.localId, { queuedAt: now() - backoffFor(record.attempts) });
    moved++;
  }
  return moved;
}
