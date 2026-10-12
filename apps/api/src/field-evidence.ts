import { z } from 'zod';
import { createHash } from 'node:crypto';

export const zInspectionEvidence = z.object({
  version: z.literal(1), inspectionId: z.string(), sourceUpdatedAt: z.string().datetime(),
  capturedAt: z.string().datetime(), roomIndex: z.number().int().min(0),
  room: z.object({ name: z.string(), notes: z.string().default(''), condition: z.number().min(0).max(5) }),
});

/** A damaged historical snapshot must not hide otherwise usable project tasks. */
export function readInspectionEvidence(raw: string | null) {
  if (raw === null) return { inspectionEvidence: null, inspectionEvidenceState: 'absent' as const };
  try {
    const parsed = zInspectionEvidence.safeParse(JSON.parse(raw));
    if (parsed.success) return { inspectionEvidence: parsed.data, inspectionEvidenceState: 'recorded' as const };
  } catch { /* Retain stored bytes; report the unreadable snapshot separately. */ }
  return { inspectionEvidence: null, inspectionEvidenceState: 'unreadable' as const };
}

export function fieldTaskVersion(task: { id: string; title: string; done: boolean; inspectionEvidence: string | null }) {
  return createHash('sha256').update(JSON.stringify([task.id, task.title, task.done, task.inspectionEvidence])).digest('hex');
}
export const zFieldSnapshot = z.object({
  version: z.literal(1), capturedAt: z.string().datetime(), capturedBy: z.string(), capturedById: z.string(),
  tasks: z.array(z.object({ id: z.string(), title: z.string(), done: z.boolean(), inspectionEvidence: zInspectionEvidence.nullable() })).min(1).max(100),
});
export function readFieldSnapshot(raw: string | null) {
  if (raw === null) return null;
  try { const parsed = zFieldSnapshot.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
