import type { PrismaClient } from '@prisma/client';
import { fieldContext, isSealed, open, seal } from './secret-box.js';

/**
 * Every field in the database that holds somebody else's credential.
 *
 * ONE list, and it is the list the backfill walks and the list the test greps
 * the raw tables against. Adding a column here is what makes both cover it;
 * adding a credential column and NOT adding it here is what
 * test/secrets-at-rest.test.ts exists to fail on, because the failure mode is
 * silent — a new integration writes a plaintext token, everything works, and
 * nobody finds out until a database ends up somewhere it should not be.
 *
 * All five models are workspace-scoped, which is what lets the context bind to
 * orgId uniformly.
 */
export const SEALED_FIELDS = [
  { model: 'xeroConnection', fields: ['accessToken', 'refreshToken'] },
  { model: 'bankConnection', fields: ['accessToken', 'refreshToken'] },
  { model: 'integrationConnection', fields: ['config'] },
  { model: 'webhookEndpoint', fields: ['secret'] },
  { model: 'ssoConnection', fields: ['clientSecret'] },
] as const;

export type SealedModel = (typeof SEALED_FIELDS)[number]['model'];

/** Seal one field for a row that belongs to `orgId`. */
export const sealFor = (model: SealedModel, field: string, orgId: string, value: string) =>
  seal(value, fieldContext(model, field, orgId));

/** Open one field, or pass a legacy plaintext value through untouched. */
export const openFor = (model: SealedModel, field: string, orgId: string, value: string) =>
  open(value, fieldContext(model, field, orgId));

/**
 * Seal what is still in the clear.
 *
 * Read-through means a row written before this existed keeps working and gets
 * re-sealed the next time anything writes it. That is enough for OAuth tokens,
 * which rotate on use — but a webhook signing secret and a pasted API key are
 * written once and then read for years, so without this they would stay in
 * plain text for the life of the workspace.
 *
 * Idempotent: an already-sealed value is skipped, so this runs on every boot
 * and does nothing on all but the first.
 */
export async function backfillSealedFields(prisma: PrismaClient): Promise<{ rows: number; fields: number }> {
  let rows = 0;
  let fields = 0;
  for (const { model, fields: names } of SEALED_FIELDS) {
    const table = (prisma as unknown as Record<string, any>)[model];
    const all: Array<Record<string, unknown>> = await table.findMany();
    for (const row of all) {
      const patch: Record<string, string> = {};
      for (const field of names) {
        const value = row[field];
        if (typeof value !== 'string' || isSealed(value)) continue;
        patch[field] = sealFor(model, field, String(row.orgId), value);
      }
      if (!Object.keys(patch).length) continue;
      await table.update({ where: { id: row.id as string }, data: patch });
      rows += 1;
      fields += Object.keys(patch).length;
    }
  }
  return { rows, fields };
}
