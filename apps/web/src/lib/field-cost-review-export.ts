import type { FieldSnapshotExport } from './field-snapshot-export';
export interface FieldCostReviewExport {
  sourceVersionId: string; snapshotCapturedAt: string;
  task: FieldSnapshotExport['tasks'][number];
  cost: { label: string; amount: number }; reason: string;
  reviewerId: string; reviewerName: string; reviewedAt: string; costUnchanged: boolean;
}
export function fieldCostReviewLines(reviews?: FieldCostReviewExport[] | null, state?: string, unsaved?: boolean): string[] {
  if (state === 'unverified') return ['FIELD ALLOWANCE REVIEWS UNVERIFIED: the saved version could not be confirmed.'];
  if (state === 'unreadable') return ['FIELD ALLOWANCE REVIEWS UNREADABLE: review history cannot be confirmed.'];
  if (!reviews?.length) return [];
  return ['HISTORICAL FIELD ALLOWANCE REVIEWS — manually entered amounts, not professional approval or current inspection verification.',
    ...(unsaved ? ['UNSAVED INPUTS: these reviews describe saved costs; they do not verify editor changes.'] : []),
    ...reviews.flatMap(review => [
      `${review.cost.label}: £${review.cost.amount.toFixed(2)} | ${unsaved ? 'Editor cost match unverified' : review.costUnchanged ? 'Saved cost matches review' : 'Saved cost differs from review — reassessment required'}`,
      `Rationale: ${review.reason}`,
      `Reviewed by: ${review.reviewerName} | Member ID: ${review.reviewerId} | UTC: ${review.reviewedAt}`,
      `Source appraisal: ${review.sourceVersionId} | Snapshot UTC: ${review.snapshotCapturedAt}`,
      `Captured task: ${review.task.title} | Task ID: ${review.task.id}`,
      `Captured observation: ${review.task.inspectionEvidence?.room.notes || '(No inspection note captured)'}`,
    ])];
}
