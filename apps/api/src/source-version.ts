import { createHash } from 'node:crypto';
import type { Document } from '@prisma/client';

/** Optimistic review stamp, not a signed extraction receipt or a storage rehash. */
export function sourceVersion(doc: Pick<Document, 'id' | 'orgId' | 'dealId' | 'name' | 'url' | 'sha256' | 'ext' | 'sizeBytes' | 'addedAt' | 'supersededById'>): string {
  return createHash('sha256').update(JSON.stringify([
    doc.id, doc.orgId, doc.dealId, doc.name, doc.url, doc.sha256,
    doc.ext, doc.sizeBytes.toString(), doc.addedAt.toISOString(), doc.supersededById,
  ])).digest('hex');
}
