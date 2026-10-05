/**
 * Which photographs an inspection may claim.
 *
 * The field app's shutter used to increment a number. The viewfinder was a static
 * gradient labelled "CAPTURING · KITCHEN", the thumbnails were decorative
 * gradients out of the design tokens, and the inspection went to the workbench
 * reporting "12 photos" of a property nobody had photographed — on the record
 * `audit.ts` names a lender's credit committee and an RICS review as the readers
 * of.
 *
 * With a real camera the question becomes narrower and sharper, and it is the one
 * worth testing away from the component: a photograph exists for this inspection
 * only once the SERVER holds it. Between the shutter and that moment a shot is on
 * a phone, in a request that may be refused, offline, or about to fail — and in
 * every one of those states the inspection must not name it, because
 * `inspections.save` verifies each id against `SitePhoto` and would refuse the
 * whole save, losing the eleven that did upload along with the one that did not.
 */

export type ShotState = 'uploading' | 'saved' | 'failed';

export type Shot = {
  /** Stable for the life of the tab — the key a retry addresses. */
  localId: string;
  /** What to show: an object URL while local, the signed URL once saved. */
  url: string;
  state: ShotState;
  /** The `SitePhoto` id, only ever set once the server answered. */
  photoId?: string;
};

/**
 * The ids an inspection may name — saved shots only, in order, de-duplicated.
 *
 * A `photoId` on a shot that is not `saved` is not a thing this can happen upon
 * by accident, and the check is deliberate anyway: the one way a retry gets a
 * second id for the same photograph is by succeeding twice, and a list that
 * trusted `photoId` alone would file the first attempt's id after its row was
 * replaced.
 */
export const savedPhotoIds = (shots: readonly Shot[]): string[] => [
  ...new Set(shots.filter((s) => s.state === 'saved' && !!s.photoId).map((s) => s.photoId!)),
];

/** What the screen has to say out loud: how many are filed, how many are not. */
export const shotTally = (shots: readonly Shot[]): { saved: number; uploading: number; failed: number } => ({
  saved: savedPhotoIds(shots).length,
  uploading: shots.filter((s) => s.state === 'uploading').length,
  failed: shots.filter((s) => s.state === 'failed').length,
});

/**
 * Whether the inspection can be sent.
 *
 * A shot still uploading is a photograph the surveyor is about to have, and
 * sending now files an inspection that does not name it. A FAILED shot is the
 * sharper case: the surveyor has to decide, so the screen offers Retry and says
 * what will happen — the send is allowed, because a phone with no signal must
 * not be able to trap a day's work on the device, and the record then says how
 * many photographs it has rather than how many were taken.
 */
export const canSend = (shots: readonly Shot[]): boolean => shots.every((s) => s.state !== 'uploading');

/**
 * The sentence shown beside the send control. Null where there is nothing to say,
 * because a bar that always says something is a bar nobody reads.
 */
export function pendingWarning(shots: readonly Shot[]): string | null {
  const { uploading, failed } = shotTally(shots);
  if (uploading) return `${uploading} photograph${uploading === 1 ? '' : 's'} still uploading — wait before sending.`;
  if (failed) {
    return failed === 1
      ? '1 photograph has not uploaded. Retry it, or send without it — the inspection will not name it.'
      : `${failed} photographs have not uploaded. Retry them, or send without them — the inspection will not name them.`;
  }
  return null;
}
