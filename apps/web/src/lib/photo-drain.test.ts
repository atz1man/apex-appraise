import { describe, expect, it, vi } from 'vitest';
import { bringForward, drainOnce, forgetAttributed, type UploadOutcome } from './photo-drain';
import { memoryPhotoStore } from './photo-store';
import { backoffFor, type QueuedPhoto } from './photo-queue';

const rec = (over: Partial<QueuedPhoto> = {}): QueuedPhoto => ({
  localId: 'l1',
  dealId: 'd1',
  roomName: 'Kitchen',
  roomIndex: 2,
  takenAt: '2026-10-05',
  queuedAt: 0,
  attempts: 0,
  ...over,
});

const blob = () => new Blob(['jpeg'], { type: 'image/jpeg' });
const ok = (photoId: string): UploadOutcome => ({ ok: true, photoId });
const bad = (error = 'offline'): UploadOutcome => ({ ok: false, error });

describe('drainOnce', () => {
  it('uploads a due record and remembers the id the server gave', async () => {
    const store = memoryPhotoStore();
    await store.put(rec(), blob());
    const res = await drainOnce(store, async () => ok('ph1'), () => 1_000);
    expect(res.uploaded).toEqual(['l1']);
    const [row] = await store.all();
    expect(row!.record.photoId, 'the id was not written back').toBe('ph1');
  });

  /**
   * The record stays. Both steps have to be done before it is forgotten — the
   * server holding the photograph, and the inspection naming it — and deleting
   * here would lose the attribution for a photograph that is safely uploaded.
   */
  it('keeps the record after a successful upload, because uploaded is not filed', async () => {
    const store = memoryPhotoStore();
    await store.put(rec(), blob());
    await drainOnce(store, async () => ok('ph1'), () => 1_000);
    expect(await store.all()).toHaveLength(1);
  });

  it('requeues a failure with a higher attempt count, and keeps the blob', async () => {
    const store = memoryPhotoStore();
    await store.put(rec(), blob());
    const res = await drainOnce(store, async () => bad('ECONNREFUSED'), () => 5_000);
    expect(res.failed).toEqual([{ localId: 'l1', error: 'ECONNREFUSED' }]);
    const [row] = await store.all();
    expect(row!.record.attempts).toBe(1);
    expect(row!.record.queuedAt, 'the backoff clock did not restart').toBe(5_000);
    expect(row!.record.lastError).toBe('ECONNREFUSED');
    expect(await row!.blob.text(), 'the photograph itself was lost on a failed attempt').toBe('jpeg');
  });

  /** A failure forever retries forever. There is no attempt at which it is dropped. */
  it('never drops a record, however many times it has failed', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ attempts: 99 }), blob());
    let clock = 10_000_000;
    await drainOnce(store, async () => bad(), () => clock);
    const [row] = await store.all();
    expect(row, 'a record was dropped after repeated failures').toBeTruthy();
    expect(row!.record.attempts).toBe(100);
  });

  it('leaves alone what is not due yet', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ attempts: 2, queuedAt: 1_000 }), blob());
    const upload = vi.fn(async () => ok('ph1'));
    const res = await drainOnce(store, upload, () => 1_000 + backoffFor(2) - 1);
    expect(upload).not.toHaveBeenCalled();
    expect(res.uploaded).toEqual([]);
  });

  /**
   * An overlapping drain — a timer firing while an `online` event is already
   * working the queue — must not post the same photograph twice, which would
   * put it in the deal's site log two times over.
   */
  it('does not upload a record the server already has', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ photoId: 'ph1' }), blob());
    const upload = vi.fn(async () => ok('ph2'));
    await drainOnce(store, upload, () => 9_999_999);
    expect(upload).not.toHaveBeenCalled();
  });

  it('works the oldest first, so the one closest to being lost goes first', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ localId: 'late', queuedAt: 300 }), blob());
    await store.put(rec({ localId: 'early', queuedAt: 100 }), blob());
    const order: string[] = [];
    await drainOnce(
      store,
      async (r) => {
        order.push(r.localId);
        return ok(`ph-${r.localId}`);
      },
      () => 10_000,
    );
    expect(order).toEqual(['early', 'late']);
  });

  it('carries on past one failure to the next record', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ localId: 'a', queuedAt: 1 }), blob());
    await store.put(rec({ localId: 'b', queuedAt: 2 }), blob());
    const res = await drainOnce(store, async (r) => (r.localId === 'a' ? bad() : ok('ph-b')), () => 10_000);
    expect(res.failed.map((f) => f.localId)).toEqual(['a']);
    expect(res.uploaded).toEqual(['b']);
  });

  it('does nothing, quietly, on an empty queue', async () => {
    expect(await drainOnce(memoryPhotoStore(), async () => ok('x'))).toEqual({ uploaded: [], failed: [] });
  });
});

describe('forgetAttributed', () => {
  it('removes only the records the inspection named', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ localId: 'named', photoId: 'ph1' }), blob());
    await store.put(rec({ localId: 'other', photoId: 'ph2' }), blob());
    await store.put(rec({ localId: 'not-yet-uploaded' }), blob());
    expect(await forgetAttributed(store, ['ph1'])).toBe(1);
    expect((await store.all()).map((r) => r.record.localId).sort()).toEqual(['not-yet-uploaded', 'other']);
  });

  /**
   * Called with what the SERVER accepted, never with what the screen held —
   * `inspections.save` verifies every id and refuses the whole save if one is
   * unknown, so a record forgotten on the strength of a refused save would lose
   * the attribution of a photograph that is safely uploaded.
   */
  it('keeps a record whose id the save did not come back with', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ localId: 'hopeful', photoId: 'ph1' }), blob());
    expect(await forgetAttributed(store, [])).toBe(0);
    expect(await store.all()).toHaveLength(1);
  });

  it('never removes a record that has not been uploaded, whatever ids are named', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ localId: 'pending' }), blob());
    await forgetAttributed(store, ['ph1', 'ph2', 'ph3']);
    expect(await store.all()).toHaveLength(1);
  });
});

/**
 * The backoff is a wait for a connection, so the connection returning ends it.
 */
describe('bringForward', () => {
  it('makes a record waiting out its backoff due at once', async () => {
    const store = memoryPhotoStore();
    // three failures deep: a quarter of an hour before it would try again
    await store.put(rec({ attempts: 3, queuedAt: 10_000 }), blob());
    const now = () => 11_000;

    const skipped = await drainOnce(store, async () => ok('ph1'), now);
    expect(skipped.uploaded, 'it was due before the connection returned').toEqual([]);

    expect(await bringForward(store, now)).toBe(1);
    const sent = await drainOnce(store, async () => ok('ph1'), now);
    expect(sent.uploaded, 'the returning connection did not bring it forward').toEqual(['l1']);
  });

  /**
   * The count is the record of how many tries it has taken. Clearing it would
   * put the record back on an immediate retry when the signal that just
   * returned turns out not to reach this server — the case the cap exists for.
   */
  it('leaves the attempt count alone', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ attempts: 4, queuedAt: 500 }), blob());
    await bringForward(store, () => 2_000);
    const [row] = await store.all();
    expect(row!.record.attempts).toBe(4);
    expect(backoffFor(row!.record.attempts), 'the next wait was reset too').toBeGreaterThan(0);
  });

  /** An uploaded record is not waiting for anything; it is waiting to be named. */
  it('does not touch a record the server already holds', async () => {
    const store = memoryPhotoStore();
    await store.put(rec({ localId: 'filed', photoId: 'ph1', queuedAt: 999 }), blob());
    expect(await bringForward(store, () => 2_000)).toBe(0);
    const [row] = await store.all();
    expect(row!.record.queuedAt).toBe(999);
  });
});
