/**
 * A photograph taken on site survives the tab closing.
 *
 * An inspection names only what the SERVER holds (`inspections.save` verifies
 * every id against `SitePhoto` and refuses the whole save if one is unknown).
 * This file holds the half before that: what happens to a photograph between the
 * shutter and the server when there is no signal.
 *
 * Until now, nothing. The blob lived in an object URL in React state, so a
 * surveyor who lost signal in a basement, finished the inspection and closed the
 * tab lost every photograph they had taken — and the commit that built the camera
 * said so rather than papering over it. A valuer's inspection record is the
 * evidence `audit.ts` names a lender's credit committee and an RICS review as
 * the readers of; losing it to a refreshed tab is not a tolerable failure.
 *
 * Two things make the queue honest rather than merely present:
 *
 *   IT NEVER GIVES UP. There is no attempt limit and no expiry. A photograph is
 *   evidence, and a queue that drops one after five tries recreates the defect it
 *   was built to end — quietly, and at the moment the surveyor has stopped
 *   watching. It backs off, and it keeps the record until the server has it.
 *
 *   UPLOADED IS NOT FILED. A record stays in the store after the upload succeeds,
 *   carrying its `photoId`, until the inspection it belongs to has named it. The
 *   drain runs for every deal — a surveyor who regains signal in the car must not
 *   have to open three deals to flush them — but a room can only be written while
 *   that deal's inspection is in hand, so the two steps are separate and each is
 *   remembered.
 */

export type QueuedPhoto = {
  /** Stable for the life of the record; the key in the store and the file name. */
  localId: string;
  dealId: string;
  /**
   * The room by NAME as well as index.
   *
   * The index is positional and the room list is rebuilt from the inspection on
   * every open, so an index alone can attribute a photograph of a kitchen to a
   * basement if the list ever changes. The name is what the caption already
   * carries, so it is the key that agrees with the server's own record.
   */
  roomName: string;
  roomIndex: number;
  /** The day it was taken, as the upload route wants it (YYYY-MM-DD). */
  takenAt: string;
  queuedAt: number;
  attempts: number;
  /** Set once the server has it; the record waits here to be attributed. */
  photoId?: string;
  lastError?: string;
};

/**
 * How long to wait before attempt n+1, in milliseconds.
 *
 * Short at first, because the commonest failure is a few seconds of no signal
 * walking between rooms. Capped at fifteen minutes, because the second commonest
 * is a whole site with none, and a phone retrying every second for an afternoon
 * is a flat battery — which loses the photographs by another route.
 */
const BACKOFF_MS = [0, 5_000, 15_000, 60_000, 300_000, 900_000];

export const backoffFor = (attempts: number): number =>
  BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;

/** Whether this record's next attempt is due. */
export const isDue = (p: QueuedPhoto, now: number): boolean =>
  !p.photoId && now - p.queuedAt >= backoffFor(p.attempts);

/**
 * The records to attempt now, oldest first.
 *
 * Oldest first on purpose: the photograph taken longest ago is the one closest to
 * being lost to a closed tab, and uploading in the order they were taken is also
 * the order a reader expects them in.
 */
export const dueForUpload = (all: readonly QueuedPhoto[], now: number): QueuedPhoto[] =>
  all.filter((p) => isDue(p, now)).sort((a, b) => a.queuedAt - b.queuedAt);

/** Uploaded, and waiting for its inspection to name it. */
export const awaitingAttribution = (all: readonly QueuedPhoto[], dealId: string): QueuedPhoto[] =>
  all.filter((p) => p.dealId === dealId && !!p.photoId);

/**
 * Which room a restored record belongs to, by NAME.
 *
 * Null when no room of that name exists any more — a renamed or removed area. The
 * photograph still uploads and still stands in the deal's site log, because it is
 * a photograph of that property either way; what cannot be done is guessing which
 * room it was of. The caller reports it rather than attaching it to whichever
 * room happens to sit at that index now.
 */
export const roomIndexFor = (p: QueuedPhoto, rooms: ReadonlyArray<{ name: string }>): number | null => {
  const byName = rooms.findIndex((r) => r.name === p.roomName);
  return byName >= 0 ? byName : null;
};

/**
 * Whether the inspection can be sent.
 *
 * Only an upload IN FLIGHT holds it, and the window is seconds: the photograph
 * is already on the device, but its id is not back yet, so a save taken now
 * files an inspection that does not name a photograph the server is about to
 * hold — and that attribution would then wait for a NEXT save which may never
 * come, because the surveyor has finished.
 *
 * A photograph merely QUEUED does NOT hold it, and that reasoning changed when
 * the queue became durable. It used to be that a phone with no signal must not
 * be able to trap a day's work on the device — true, but it was a choice between
 * two losses, because the blob was in memory. Now it is saved and will go on its
 * own, so sending is simply safe. `queueSentence` is what says so, and it is why
 * there is no Retry to press.
 */
export const canSend = (inFlight: number): boolean => inFlight === 0;

/**
 * What the screen says about work not yet filed. Null when there is none,
 * because a bar that always says something is a bar nobody reads.
 *
 * An upload in flight is said FIRST and on its own: it is the one case where the
 * send is held, so the sentence has to answer "why can I not press it" rather
 * than reassure about a queue. The two queue sentences differ on the thing the
 * surveyor actually wants to know — whether the page can be closed.
 */
export function queueSentence(all: readonly QueuedPhoto[], online: boolean, inFlight = 0): string | null {
  if (inFlight > 0) {
    return inFlight === 1
      ? '1 photograph is uploading — a moment before sending, so the inspection names it.'
      : `${inFlight} photographs are uploading — a moment before sending, so the inspection names them.`;
  }
  const waiting = all.filter((p) => !p.photoId).length;
  if (waiting === 0) return null;
  const n = `${waiting} photograph${waiting === 1 ? '' : 's'}`;
  return online
    ? `${n} still to upload. ${waiting === 1 ? 'It is' : 'They are'} saved on this device and will go on their own.`
    : `${n} waiting for a connection. ${waiting === 1 ? 'It is' : 'They are'} saved on this device — closing this page will not lose ${waiting === 1 ? 'it' : 'them'}.`;
}
