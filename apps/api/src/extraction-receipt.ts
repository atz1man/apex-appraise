import { createHash, createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ASSUMPTION_FIELDS, ORIGIN_LABELS, type AssumptionField } from '@apex/types/assumption-origins';
import { zExtraction, zAssumptionOrigins, type AppraisalInputDto } from '@apex/types';
import { JWT_SECRET } from './context.js';

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const zExtractionReceipt = z.object({
  version: z.literal(1), id: z.string().uuid(), orgId: z.string(), userId: z.string(),
  createdAt: z.string().datetime(), mode: z.enum(['worked-example', 'model']),
  outputHash: fingerprint, notesHash: fingerprint,
  extraction: zExtraction, assumptionOrigins: zAssumptionOrigins,
  buildPerSqft: z.number().positive(),
  sourceDocuments: z.array(z.object({ id: z.string(), name: z.string(), version: fingerprint })).max(12),
  omissions: z.array(z.object({ name: z.string(), reason: z.string() })).max(36),
});
export type ExtractionReceipt = z.infer<typeof zExtractionReceipt>;
// Separate signing domain: a receipt must never authenticate as a session token.
const key = createHmac('sha256', JWT_SECRET).update('plotmerit-extraction-receipt-v1').digest();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function issueExtractionReceipt(input: Omit<ExtractionReceipt, 'version' | 'id' | 'createdAt' | 'outputHash' | 'notesHash' | 'mode'> & { notes: string }) {
  const { notes, ...rest } = input;
  const receipt = zExtractionReceipt.parse({ ...rest, version: 1, id: randomUUID(), createdAt: new Date().toISOString(),
    mode: input.extraction.sample ? 'worked-example' : 'model', notesHash: hash(notes),
    outputHash: hash(JSON.stringify({ extraction: input.extraction, assumptionOrigins: input.assumptionOrigins, buildPerSqft: input.buildPerSqft })),
  });
  return jwt.sign(receipt, key, { algorithm: 'HS256', audience: 'plotmerit-extraction-review', expiresIn: '7d' });
}
export function verifyExtractionReceipt(token: string, orgId: string): ExtractionReceipt {
  try {
    const receipt = zExtractionReceipt.parse(jwt.verify(token, key, { algorithms: ['HS256'], audience: 'plotmerit-extraction-review' }));
    if (receipt.orgId !== orgId) throw new Error('Wrong workspace');
    return receipt;
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The extraction receipt is invalid or expired. Run extraction again before saving its review.' });
  }
}
export function receiptSummary(receipt: ExtractionReceipt) {
  return { id: receipt.id, createdAt: receipt.createdAt, mode: receipt.mode, outputHash: receipt.outputHash };
}

/** Compare only directly mapped scalar inputs. Never reverse-engineer cost lines or unit identities. */
export function receiptComparison(receipt: ExtractionReceipt, saved: AppraisalInputDto) {
  const original = receipt.extraction;
  const pairs: Array<[AssumptionField, number, number]> = [
    ['efficiency', original.efficiency, saved.efficiency],
    ['asking', original.asking, saved.site.landFixed],
    ['profFee', original.profFee, saved.profFeePct],
    ['contingency', original.contingency, saved.contingencyPct],
    ['targetProfit', original.targetProfit, saved.targetProfitOnGdvPct],
    ['acq', original.acq, saved.site.acqPct],
    ['agent', original.agent, saved.disposal.agentPct],
    ['legal', original.legal, saved.disposal.legalPct],
    ['finance.ltc', original.finance.ltc, saved.finance.ltcPct],
    ['finance.rate', original.finance.rate, saved.finance.ratePct],
    ['finance.period', original.finance.period, saved.finance.periodMonths],
    ['finance.sales', original.finance.sales, saved.finance.salesMonths],
    ['finance.arrFee', original.finance.arrFee, saved.finance.arrangementFeePct],
  ];
  return pairs.map(([field, originalValue, savedValue]) => ({
    field, label: ASSUMPTION_FIELDS[field], originalValue, savedValue,
    changed: originalValue !== savedValue,
    originalOrigin: ORIGIN_LABELS[receipt.assumptionOrigins[field] ?? 'unknown'],
  }));
}
