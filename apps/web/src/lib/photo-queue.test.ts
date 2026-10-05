import { describe, expect, it } from 'vitest';
import { awaitingAttribution, backoffFor, canSend, dueForUpload, isDue, queueSentence, roomIndexFor, type QueuedPhoto } from './photo-queue';

const p = (over: Partial<QueuedPhoto> = {}): QueuedPhoto => ({
  localId: 'l1',
  dealId: 'd1',
  roomName: 'Kitchen',
  roomIndex: 2,
  takenAt: '2026-10-05',
  queuedAt: 0,
  attempts: 0,
  ...over,
});

describe('backoffFor', () => {
  it('tries immediately the first time', () => {
    expect(backoffFor(0)).toBe(0);
  });

  it('climbs, because the commonest failure is seconds of no signal between rooms', () => {
    expect(backoffFor(1)).toBeLessThan(backoffFor(2));
    expect(backoffFor(2)).toBeLessThan(backoffFor(3));
  });

  /**
   * Capped, and the cap is the decision: the second commonest failure is a whole
   * site with no signal, and a phone retrying every second for an afternoon is a
   * flat battery — which loses the photographs by another route.
   */
  it('caps rather than growing for ever', () => {
    expect(backoffFor(50)).toBe(backoffFor(5));
    expect(backoffFor(5)).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  /** And it NEVER gives up: there is no attempt at which the answer is "stop". */
  it('answers a delay at every attempt count, however high', () => {
    for (const n of [0, 1, 9, 99, 9_999]) expect(Number.isFinite(backoffFor(n))).toBe(true);
  });
});

describe('isDue', () => {
  it('is due at once when it has never been tried', () => {
    expect(isDue(p({ queuedAt: 1_000 }), 1_000)).toBe(true);
  });

  it('waits out the backoff after a failure', () => {
    const rec = p({ queuedAt: 1_000, attempts: 1 });
    expect(isDue(rec, 1_000 + backoffFor(1) - 1)).toBe(false);
    expect(isDue(rec, 1_000 + backoffFor(1))).toBe(true);
  });

  /**
   * A record the server already has is never uploaded again. Without this the
   * drain would re-post a photograph it had already filed, and the deal's site
   * log would carry it twice.
   */
  it('is never due once the server has it', () => {
    expect(isDue(p({ photoId: 'ph1', attempts: 0 }), 9_999_999)).toBe(false);
  });
});

describe('dueForUpload', () => {
  /**
   * Oldest first: the photograph taken longest ago is the one closest to being
   * lost, and it is also the order a reader expects them in.
   */
  it('takes the oldest first', () => {
    const all = [p({ localId: 'c', queuedAt: 300 }), p({ localId: 'a', queuedAt: 100 }), p({ localId: 'b', queuedAt: 200 })];
    expect(dueForUpload(all, 10_000).map((x) => x.localId)).toEqual(['a', 'b', 'c']);
  });

  it('leaves out what is not due yet and what is already filed', () => {
    const all = [
      p({ localId: 'due', queuedAt: 0 }),
      p({ localId: 'waiting', queuedAt: 9_000, attempts: 3 }),
      p({ localId: 'filed', photoId: 'ph1' }),
    ];
    expect(dueForUpload(all, 10_000).map((x) => x.localId)).toEqual(['due']);
  });

  it('is empty on an empty queue', () => {
    expect(dueForUpload([], 1)).toEqual([]);
  });
});

describe('awaitingAttribution', () => {
  /**
   * Uploaded is not filed. The record stays until the inspection names it, and
   * the drain runs for every deal — so this is scoped to the deal in hand,
   * because a room can only be written while its inspection is open.
   */
  it('is the uploaded records for this deal only', () => {
    const all = [
      p({ localId: 'mine', dealId: 'd1', photoId: 'ph1' }),
      p({ localId: 'theirs', dealId: 'd2', photoId: 'ph2' }),
      p({ localId: 'not-yet', dealId: 'd1' }),
    ];
    expect(awaitingAttribution(all, 'd1').map((x) => x.localId)).toEqual(['mine']);
  });
});

describe('roomIndexFor', () => {
  const rooms = [{ name: 'Exterior' }, { name: 'Living areas' }, { name: 'Kitchen' }];

  it('finds the room by name', () => {
    expect(roomIndexFor(p({ roomName: 'Kitchen' }), rooms)).toBe(2);
  });

  /**
   * By NAME, not by the stored index. The room list is rebuilt from the
   * inspection on every open, so an index alone can attribute a photograph of a
   * kitchen to a basement — and the name is what the caption already carries, so
   * it is the key that agrees with the server's own record.
   */
  it('ignores a stale index when the list has moved', () => {
    const reordered = [{ name: 'Kitchen' }, { name: 'Exterior' }];
    expect(roomIndexFor(p({ roomName: 'Kitchen', roomIndex: 2 }), reordered)).toBe(0);
  });

  /**
   * Null for a room that no longer exists. The photograph still stands in the
   * deal's site log — it is a photograph of that property either way — but which
   * room it was of cannot be guessed, so it is not attached to whichever room
   * happens to sit at that index now.
   */
  it('answers nothing for a room that has gone', () => {
    expect(roomIndexFor(p({ roomName: 'Basement' }), rooms)).toBeNull();
  });
});

describe('queueSentence', () => {
  it('says nothing when the queue is empty', () => {
    expect(queueSentence([], true)).toBeNull();
    expect(queueSentence([p({ photoId: 'ph1' })], true)).toBeNull();
  });

  /** Offline, the thing a surveyor needs to know is that closing the page is safe. */
  it('offline, promises the photographs are not lost', () => {
    const s = queueSentence([p()], false)!;
    expect(s).toMatch(/waiting for a connection/);
    expect(s).toMatch(/will not lose it/);
  });

  it('online, says they are going on their own — no Retry to press', () => {
    expect(queueSentence([p()], true)).toMatch(/will go on their own/);
  });

  it('counts in words that agree', () => {
    expect(queueSentence([p()], false)).toContain('1 photograph ');
    expect(queueSentence([p({ localId: 'a' }), p({ localId: 'b' })], false)).toContain('2 photographs ');
    expect(queueSentence([p({ localId: 'a' }), p({ localId: 'b' })], false)).toMatch(/They are/);
  });
});

/**
 * The send rule. `inspection-photos.ts` held it before the queue was durable,
 * where it had to adjudicate between an in-memory blob and a lost day; with the
 * blob on the device that dilemma is gone, and what is left is this.
 */
describe('canSend', () => {
  it('allows the send when nothing is in the air', () => {
    expect(canSend(0)).toBe(true);
  });

  /**
   * The window is seconds, and it is the one case that matters: the server is
   * about to hold the photograph, so a save taken now names an inspection
   * short of it — and the attribution would wait for a next save the surveyor,
   * being finished, may never make.
   */
  it('holds the send while a photograph is uploading', () => {
    expect(canSend(1)).toBe(false);
    expect(canSend(4)).toBe(false);
  });
});

describe('queueSentence while an upload is in the air', () => {
  /**
   * Said first and on its own: this is the only sentence that has to answer
   * "why can I not press it", so reassurance about the queue would bury it.
   */
  it('says what is holding the send, ahead of anything merely queued', () => {
    const s = queueSentence([p({ localId: 'a' }), p({ localId: 'b' })], true, 1);
    expect(s).toMatch(/uploading/);
    expect(s, 'the reassurance buried the reason the button is disabled').not.toMatch(/saved on this device/);
  });

  it('agrees with itself about one photograph and several', () => {
    expect(queueSentence([p()], true, 1)).toMatch(/1 photograph is uploading/);
    expect(queueSentence([p()], true, 3)).toMatch(/3 photographs are uploading/);
    expect(queueSentence([p()], true, 1)).toMatch(/names it\./);
    expect(queueSentence([p()], true, 3)).toMatch(/names them\./);
  });

  /** Nothing in the air and nothing queued is nothing to say. */
  it('still says nothing when the queue is empty', () => {
    expect(queueSentence([], true, 0)).toBeNull();
    expect(queueSentence([p({ photoId: 'ph1' })], true, 0)).toBeNull();
  });
});
