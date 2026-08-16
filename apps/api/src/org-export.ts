import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Everything a workspace holds, in one file it can take away.
 *
 * There was an export before this, and it named its twenty-two tables by hand
 * under the heading "everything the workspace owns". It had drifted: no
 * EngagementTerms — the signed instruction a valuation stands on — no OrgPolicy,
 * no report shares, no accounting links. A firm exercising data portability got a
 * confident-looking file with its terms of engagement missing.
 *
 * So the model list is DERIVED FROM THE SCHEMA at runtime instead. A hand-kept
 * list drifts the moment somebody adds a model, and an export quietly missing a
 * table is worse than no export, because it looks complete. The cascade list next
 * door needs the same property and gets it from a test that reads the schema;
 * this gets it on every run.
 */

/**
 * Fields never exported, matched on NAME.
 *
 * An export is a file that leaves the building — emailed, dropped in a shared
 * drive, handed to a client's solicitor. Password hashes, API key hashes, SSO
 * client secrets, Xero refresh tokens and signing tokens are credentials whether
 * or not the person exporting is entitled to the data around them. The rule is on
 * the name rather than a per-model list for the same reason as above: a new
 * `somethingSecret` column must be excluded on the day it is added, not on the
 * day somebody remembers this file exists.
 */
const CREDENTIAL_FIELD = /(password|secret|token|hash|signature)/i;

/** Values that are credentials by shape rather than by name. */
const redactValue = (key: string, value: unknown) => (CREDENTIAL_FIELD.test(key) ? '[redacted]' : value);

export const isCredentialField = (key: string) => CREDENTIAL_FIELD.test(key);

/**
 * Models carrying an orgId, straight from the generated datamodel — the same
 * source Prisma itself uses, so it cannot disagree with the schema.
 */
export function orgScopedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'orgId'))
    .map((m) => m.name);
}

/**
 * Rows that belong to a workspace through a parent rather than directly. They
 * have no orgId of their own, so the derivation above cannot see them, and
 * leaving them out would silently drop a firm's sales milestones and every
 * investor cashflow. Mirrors the parent relations in `org-delete.ts`.
 */
const VIA_PARENT: Record<string, (orgId: string) => object> = {
  SalesMilestone: (orgId) => ({ unit: { orgId } }),
  Holding: (orgId) => ({ investor: { orgId } }),
  Cashflow: (orgId) => ({ investor: { orgId } }),
};

const lowerFirst = (s: string) => s[0]!.toLowerCase() + s.slice(1);

export interface WorkspaceExport {
  exportedAt: string;
  workspace: string;
  /** table name → rows, credentials removed */
  data: Record<string, unknown[]>;
  /** stated plainly in the file itself, so nobody has to guess what is missing */
  notes: string[];
}

export async function exportWorkspace(prisma: PrismaClient, orgId: string): Promise<WorkspaceExport> {
  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  const data: Record<string, unknown[]> = {};

  for (const model of orgScopedModels()) {
    const client = (prisma as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>)[lowerFirst(model)];
    if (!client) continue;
    data[model] = redactRows(await client.findMany({ where: { orgId } }));
  }
  for (const [model, where] of Object.entries(VIA_PARENT)) {
    const client = (prisma as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>)[lowerFirst(model)];
    if (!client) continue;
    data[model] = redactRows(await client.findMany({ where: where(orgId) }));
  }
  data.Organisation = redactRows(org ? [org] : []);

  return {
    exportedAt: new Date().toISOString(),
    workspace: org?.name ?? 'Unknown workspace',
    data,
    notes: [
      'Credentials are excluded: password hashes, API key hashes, SSO client secrets, integration refresh tokens and document signatures are shown as [redacted].',
      'Uploaded files are not embedded in this file. Download them from the deal data rooms; this export lists their names, sizes and where they were attached.',
      'Money is in pence, as it is stored, so nothing is lost to rounding on the way out.',
    ],
  };
}

function redactRows(rows: unknown[]): unknown[] {
  return rows.map((row) =>
    jsonSafe(
      Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, redactValue(k, v)])),
    ),
  );
}

/**
 * Pence are stored as BigInt, which JSON.stringify refuses outright — so without
 * this the whole export throws rather than losing a figure quietly. Numbers, not
 * strings, so the file opens in a spreadsheet without a conversion step.
 */
export function jsonSafe(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, jsonSafe(x)]));
  }
  return v;
}
