import { beforeAll, describe, expect, it } from 'vitest';
import { exportWorkspace, isCredentialField, orgScopedModels } from '../src/org-export.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Data portability, asserted on what comes OUT.
 *
 * The export this replaced named its tables by hand and called the result
 * "everything the workspace owns" while missing EngagementTerms — the signed
 * instruction a valuation stands on. A test that checked the procedure existed,
 * or that it returned something, would have passed on every day of that.
 */

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Exporter');
}, 120_000);

describe('what leaves the building', () => {
  it('covers every org-scoped table in the schema, not a list somebody maintains', async () => {
    const file = await exportWorkspace(prisma, T.orgId);
    const missing = orgScopedModels().filter((m) => !(m in file.data));
    expect(missing, `the export is missing: ${missing.join(', ')}`).toEqual([]);
    // the derivation must actually have found the datamodel
    expect(orgScopedModels().length).toBeGreaterThan(15);
    // and the tables the old hand-kept list had lost
    for (const model of ['EngagementTerms', 'OrgPolicy', 'ReportShare', 'ApiKey']) {
      expect(Object.keys(file.data)).toContain(model);
    }
  });

  it('carries the workspace’s actual rows', async () => {
    const file = await exportWorkspace(prisma, T.orgId);
    const deals = file.data.Deal as Array<{ id: string }>;
    expect(deals.map((d) => d.id)).toContain(T.dealId);
    expect(file.workspace).toContain('Exporter');
  });

  it('never carries a credential, whichever table it lives in', async () => {
    /**
     * Asserted over the whole file rather than the tables I happened to think
     * of: an export is emailed, dropped in shared drives and handed to
     * solicitors, so one password hash or refresh token in any corner of it has
     * effectively been published.
     */
    await prisma.apiKey.create({
      data: { orgId: T.orgId, name: 'Integration', prefix: 'apx_live_aaaa', keyHash: 'THE-SECRET-HASH', scopes: 'read', createdById: T.userId },
    });
    const file = await exportWorkspace(prisma, T.orgId);

    const offenders: string[] = [];
    for (const [model, rows] of Object.entries(file.data)) {
      for (const row of rows as Array<Record<string, unknown>>) {
        for (const [key, value] of Object.entries(row)) {
          if (isCredentialField(key) && value !== '[redacted]' && value !== null) offenders.push(`${model}.${key}`);
        }
      }
    }
    expect(offenders, `these left in the clear: ${offenders.join(', ')}`).toEqual([]);
    expect(JSON.stringify(file)).not.toContain('THE-SECRET-HASH');
    // the user rows are still there — a redacted password is not a missing person
    expect((file.data.User as unknown[]).length).toBeGreaterThan(0);
  });

  it('is JSON a customer can actually open', async () => {
    // pence are BigInt in the database, which JSON.stringify throws on outright
    const file = await exportWorkspace(prisma, T.orgId);
    expect(() => JSON.stringify(file)).not.toThrow();
  });

  it('is admin-only', async () => {
    await expect(
      callerFor({ ...T.principal, role: 'ANALYST' }).org.exportData(),
    ).rejects.toThrow(/Admin/i);
  });
});
