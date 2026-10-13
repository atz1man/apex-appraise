import { z } from 'zod';
import { zFieldSnapshot } from './field-evidence.js';
export const zFieldCost = z.object({ label: z.string().trim().min(1).max(160), amount: z.number().finite().positive().max(1e10).multipleOf(0.01) });
export const zFieldCostRequest = z.object({ taskId: z.string(), cost: zFieldCost, reason: z.string().trim().min(10).max(2000), accepted: z.literal(true) });
const zReviews = z.array(z.object({
  version: z.literal(1), sourceVersionId: z.string(), snapshotCapturedAt: z.string().datetime(),
  task: zFieldSnapshot.shape.tasks.element, cost: zFieldCost, costIndex: z.number().int().min(0),
  reason: z.string(), reviewerId: z.string(), reviewerName: z.string(), reviewedAt: z.string().datetime(),
})).max(100);
export function readFieldCostReviews(raw: string | null) {
  if (raw === null) return null;
  try { const parsed = zReviews.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; } catch { return null; }
}
export function costMatches(actual: { label: string; amount: number; timing?: unknown } | undefined, cost: { label: string; amount: number }) {
  return !!actual && actual.label === cost.label && actual.amount === cost.amount && !actual.timing;
}
