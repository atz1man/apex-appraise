import type { Prisma } from '@prisma/client';

/** Serialise upload metadata commits with the workspace erasure snapshot.
 * A stream may have started before deletion: it must not commit afterwards.
 * Its route's finally block removes the just-written bytes on rejection. */
export async function lockUploadOwner(tx: Prisma.TransactionClient, orgId: string) {
  const found = await tx.$executeRaw`UPDATE "Organisation" SET "id" = "id" WHERE "id" = ${orgId}`;
  if (!found) throw Object.assign(new Error('Workspace no longer exists'), { statusCode: 404 });
}
