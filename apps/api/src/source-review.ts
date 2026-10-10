import { z } from 'zod';
import type { Appraisal } from '@prisma/client';
import { inputHashOf } from './approval-pin.js';

export const zSourceFingerprint = z.string().regex(/^[a-f0-9]{64}$/);

export const zSourceReference = z.object({
  unitIndex: z.number().int().min(0), documentId: z.string(),
  page: z.number().int().min(1).max(10000).nullable(), locator: z.string().trim().max(120),
});

/** An acknowledgement of inputs, never professional approval or proof of model accuracy. */
export const zSourceReviewRequest = z.object({
  accepted: z.literal(true),
  references: z.array(zSourceReference).max(200).default([]),
  documentIds: z.array(z.string()).max(12),
  sample: z.boolean(),
  omissions: z.array(z.object({ name: z.string().max(500), reason: z.string().max(8000) })).max(36),
});
export const zStoredSourceReview = z.object({
  version: z.literal(1),
  references: z.array(zSourceReference.extend({ unitLabel: z.string() })).default([]),
  reviewerId: z.string(),
  reviewerName: z.string(),
  reviewedAt: z.string().datetime(),
  inputHash: z.string(),
  sample: z.boolean(),
  omissions: zSourceReviewRequest.shape.omissions,
  documents: z.array(z.object({ id: z.string(), name: z.string(), sizeBytes: z.string(), addedAt: z.string(), storagePath: z.string(), sha256: zSourceFingerprint.nullable().default(null) })),
});

export function readSourceReview(row: Appraisal) {
  if (!row.sourceReview) return null;
  try {
    const parsed = zStoredSourceReview.safeParse(JSON.parse(row.sourceReview));
    if (!parsed.success) return null;
    return { ...parsed.data, inputsUnchanged: parsed.data.inputHash === inputHashOf(row) };
  } catch { return null; }
}
