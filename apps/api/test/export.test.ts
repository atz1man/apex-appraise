import { readFileSync } from 'node:fs';
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
    /**
     * One planted secret proves one column. These are the rest of them — the
     * credentials that reach OTHER systems, which is what makes them worse than
     * the data around them: a leaked export of deals exposes this workspace, a
     * leaked Xero refresh token exposes the firm's accounting ledger.
     */
    await prisma.xeroConnection.create({
      data: {
        orgId: T.orgId, tenantId: 'xero-tenant', tenantName: 'Exporter Ltd',
        accessToken: 'XERO-ACCESS-PLANTED', refreshToken: 'XERO-REFRESH-PLANTED',
        expiresAt: new Date(Date.now() + 3_600_000), scopes: 'accounting.transactions', connectedById: T.userId,
      },
    });
    await prisma.bankConnection.create({
      data: {
        orgId: T.orgId, institution: 'Test Bank',
        accessToken: 'BANK-ACCESS-PLANTED', refreshToken: 'BANK-REFRESH-PLANTED',
        expiresAt: new Date(Date.now() + 3_600_000), consentExpiresAt: new Date(Date.now() + 90 * 86_400_000),
        createdById: T.userId,
      },
    });
    await prisma.ssoConnection.create({
      data: {
        orgId: T.orgId, issuer: 'https://idp.test', clientId: 'public-client-id',
        clientSecret: 'SSO-SECRET-PLANTED', domains: 'exporter.test', createdById: T.userId,
      },
    });
    await prisma.webhookEndpoint.create({
      data: { orgId: T.orgId, url: 'https://a.example.com/h', secret: 'WHSEC-PLANTED', events: 'deal.created', createdById: T.userId },
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
    const serialised = JSON.stringify(file);
    for (const planted of [
      'THE-SECRET-HASH',
      'XERO-ACCESS-PLANTED', 'XERO-REFRESH-PLANTED',
      'BANK-ACCESS-PLANTED', 'BANK-REFRESH-PLANTED',
      'SSO-SECRET-PLANTED', 'WHSEC-PLANTED',
    ]) {
      expect(serialised, `${planted} was published in the export`).not.toContain(planted);
    }
    // the connections themselves are still there — redacting a token is not
    // dropping the fact that a firm had an accounting link
    expect((file.data.XeroConnection as unknown[]).length).toBe(1);
    expect(serialised, 'the public half of the SSO config went too').toContain('public-client-id');
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

/**
 * The redaction rule matches on NAME, and the test above checks that fields
 * matching the rule are redacted — using the rule. That is circular: a
 * credential column whose name the rule does not recognise passes both checks
 * in silence, and gets published.
 *
 * org-export.ts says why the rule is name-based: "a new `somethingSecret`
 * column must be excluded on the day it is added, not on the day somebody
 * remembers this file exists". This is what makes that true for names the rule
 * was not written with in mind. Reads the schema, the way cascade.test.ts does,
 * because a rule about a file and a schema agreeing cannot be enforced from
 * inside the file.
 */
describe('a credential the rule has not met yet', () => {
  /** Words that suggest a secret but are not in CREDENTIAL_FIELD. */
  const SMELLS_LIKE = /(key|cred|auth|bearer|salt|otp|pin|seed|private)/i;

  /**
   * Names that look like credentials and are not. Each needs a reason, because
   * an allow-list without one becomes a place to silence this test.
   */
  const KNOWN_BENIGN: Record<string, string> = {
    'SsoConnection.clientId': 'an OAuth client id is public by design — it travels in the authorize URL',
    'AuthThrottle.key': 'a lockout key, "login:<email>" — and AuthThrottle has no orgId, so it is not exported',
    'OpenDataCache.key': 'a postcode or coordinate pair, and likewise not org-scoped',
  };

  it('flags a new column that smells like one', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
    expect(models.length, 'read no models — this test is looking at the wrong file').toBeGreaterThan(20);

    const unhandled: string[] = [];
    for (const [, model, body] of models) {
      for (const line of body!.split('\n')) {
        const field = /^\s+(\w+)\s+\w+/.exec(line)?.[1];
        if (!field || isCredentialField(field) || !SMELLS_LIKE.test(field)) continue;
        const id = `${model}.${field}`;
        if (!(id in KNOWN_BENIGN)) unhandled.push(id);
      }
    }
    expect(
      unhandled,
      `these look like credentials but the export's rule would not redact them. ` +
        `Either rename so CREDENTIAL_FIELD catches it, or add it to KNOWN_BENIGN with a reason: ${unhandled.join(', ')}`,
    ).toEqual([]);
  });

  it('is checking names the rule really does miss', () => {
    // if CREDENTIAL_FIELD ever grew to cover these, the test above would be
    // asserting nothing and nobody would notice
    for (const id of Object.keys(KNOWN_BENIGN)) {
      expect(isCredentialField(id.split('.')[1]!), `${id} is now caught by the rule — drop it from KNOWN_BENIGN`).toBe(false);
    }
  });
});
