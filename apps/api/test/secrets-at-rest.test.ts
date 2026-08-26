import { beforeAll, describe, expect, it } from 'vitest';
import { exportWorkspace } from '../src/org-export.js';
import { SEALED_FIELDS, backfillSealedFields, openFor, sealFor } from '../src/sealed-fields.js';
import { SealedFieldError, __resetKeyForTests, fieldContext, isSealed, open, seal } from '../src/secret-box.js';
import { drainWebhooks, emitWebhook, newWebhookSecret, verifySignature } from '../src/webhook-delivery.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Credentials in the database.
 *
 * Five columns held somebody else's key in plain text: Xero's access and
 * refresh tokens, TrueLayer's, the API keys a firm pastes in for the EPC
 * register and Companies House, each webhook endpoint's signing secret, and the
 * OIDC client secret for the firm's own identity provider.
 * A Xero refresh token is a standing key to the customer's whole ledger and a
 * TrueLayer one reads their bank feed, so anyone holding a copy of the database
 * held both — and infra/backup.sh exists to make copies of the database and put
 * them somewhere else.
 *
 * The test that matters most is the last one. Sealing four columns is easy; the
 * failure mode is the FIFTH — a new integration lands, writes a token to a new
 * column, everything works, and nobody finds out until a dump ends up somewhere
 * it should not be. So the raw tables are searched for the plaintext after the
 * real procedures have run.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Vault');
  B = await makeTenant('Rival');
}, 120_000);

const admin = (t: Tenant) => callerFor({ ...t.principal, role: 'ADMIN' });

describe('the seal itself', () => {
  const ctx = fieldContext('xeroConnection', 'refreshToken', 'org-1');

  it('does not carry the plaintext anywhere in it', () => {
    const sealed = seal('refresh-token-abc123', ctx);
    expect(sealed).not.toContain('refresh-token-abc123');
    expect(Buffer.from(sealed).toString('base64')).not.toContain('refresh-token-abc123');
    expect(isSealed(sealed)).toBe(true);
    expect(open(sealed, ctx)).toBe('refresh-token-abc123');
  });

  it('seals the same value differently every time', () => {
    // a deterministic seal would let anyone with the table see which two
    // workspaces connected the same account
    expect(seal('same', ctx)).not.toBe(seal('same', ctx));
  });

  it('refuses a ciphertext lifted from another record', () => {
    const mine = seal('refresh-token-abc123', fieldContext('xeroConnection', 'refreshToken', 'org-1'));
    // the attack this exists for: someone who can WRITE the database pastes one
    // firm's sealed token into another firm's row and we read the wrong ledger
    expect(() => open(mine, fieldContext('xeroConnection', 'refreshToken', 'org-2'))).toThrow(SealedFieldError);
    // and the same value moved to a different column of the same row
    expect(() => open(mine, fieldContext('xeroConnection', 'accessToken', 'org-1'))).toThrow(SealedFieldError);
  });

  it('refuses a value somebody edited', () => {
    const sealed = seal('refresh-token-abc123', ctx);
    const parts = sealed.split('.');
    const ct = Buffer.from(parts[4]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64url');
    expect(() => open(parts.join('.'), ctx)).toThrow(SealedFieldError);
  });

  it('reads a legacy plaintext value straight through', () => {
    // what makes this deployable without a flag day: rows written before the
    // seal existed keep working, and are re-sealed on the next write
    expect(open('refresh-token-from-before', ctx)).toBe('refresh-token-from-before');
    expect(isSealed('refresh-token-from-before')).toBe(false);
  });

  it('says so when the key has changed, instead of returning rubbish', () => {
    const sealed = seal('refresh-token-abc123', ctx);
    const before = process.env.ENCRYPTION_KEY;
    try {
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      __resetKeyForTests();
      // "reconnect Xero" and "restore from backup" are different instructions,
      // and a caller cannot tell them apart from a decryption failure alone
      expect(() => open(sealed, ctx)).toThrow(/different key/);
    } finally {
      if (before === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = before;
      __resetKeyForTests();
    }
  });

  it('refuses a key that is not 32 bytes rather than padding one', () => {
    const before = process.env.ENCRYPTION_KEY;
    try {
      process.env.ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
      __resetKeyForTests();
      expect(() => seal('x', ctx)).toThrow(/32 bytes/);
    } finally {
      if (before === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = before;
      __resetKeyForTests();
    }
  });
});

describe('the backfill', () => {
  it('seals what was written before the seal existed, and leaves the value intact', async () => {
    // a signing secret and a pasted API key are written ONCE and read for
    // years, so read-through alone would leave them in the clear for ever
    const endpoint = await prisma.webhookEndpoint.create({
      data: { orgId: A.orgId, url: 'https://legacy.test/hook', secret: 'whsec_legacy', events: 'deal.created', createdById: A.userId },
    });
    const conn = await prisma.integrationConnection.create({
      data: { orgId: A.orgId, provider: 'EPC Register', status: 'CONNECTED', config: '{"key":"epc-legacy"}' },
    });

    const first = await backfillSealedFields(prisma);
    expect(first.fields).toBeGreaterThanOrEqual(2);

    const sealedEndpoint = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(sealedEndpoint.secret).not.toBe('whsec_legacy');
    expect(openFor('webhookEndpoint', 'secret', A.orgId, sealedEndpoint.secret)).toBe('whsec_legacy');

    const sealedConn = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(sealedConn.config).not.toContain('epc-legacy');
    expect(openFor('integrationConnection', 'config', A.orgId, sealedConn.config)).toBe('{"key":"epc-legacy"}');

    // idempotent: it runs on every boot and must do nothing on all but the first
    expect((await backfillSealedFields(prisma)).fields).toBe(0);
  });
});

describe('the procedures that hold credentials', () => {
  it('never writes a webhook signing secret to the table in the clear', async () => {
    await prisma.organisation.update({ where: { id: A.orgId }, data: { plan: 'ENTERPRISE' } });
    const made = (await admin(A).org.createWebhook({
      url: 'https://receiver.test/hook',
      events: ['deal.created'],
    } as never)) as { id: string; secret: string };

    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.secret).not.toBe(made.secret);
    expect(row.secret).not.toContain(made.secret);
    expect(isSealed(row.secret)).toBe(true);
  });

  it('still signs deliveries the receiver can verify', async () => {
    // the whole point of the secret: seal it wrongly and every integration in
    // production starts rejecting our signatures, silently, from the far side
    await prisma.organisation.update({ where: { id: B.orgId }, data: { plan: 'ENTERPRISE' } });
    const secret = newWebhookSecret();
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        orgId: B.orgId,
        url: 'https://receiver.test/verify',
        secret: sealFor('webhookEndpoint', 'secret', B.orgId, secret),
        events: 'deal.created',
        createdById: B.userId,
      },
    });
    await emitWebhook(prisma, B.orgId, 'deal.created', { id: 'deal-1' });

    let seen: { body: string; headers: Record<string, string> } | null = null;
    await drainWebhooks(prisma, {
      deliver: async (_url, body, headers) => {
        seen = { body, headers };
        return { status: 200 };
      },
    });

    expect(seen, 'nothing was delivered').not.toBeNull();
    const { body, headers } = seen!;
    expect(verifySignature(secret, headers['apex-signature']!, body)).toBe(true);
    expect(endpoint.id).toBeTruthy();
  });

  it("opens the API key a workspace pasted in, and no other workspace's", async () => {
    /**
     * Written the way integrations.saveCredentials writes it. That procedure
     * validates the key against the live provider before storing, so it cannot
     * be driven from a test without a transport seam it does not have — what is
     * proved here is the READ path and the tenancy binding, and the boot
     * backfill below is what covers a write site that forgets.
     */
    const sealed = sealFor('integrationConnection', 'config', A.orgId, JSON.stringify({ key: 'epc-live-key' }));
    await prisma.integrationConnection.create({
      data: { orgId: A.orgId, provider: 'Companies House', status: 'CONNECTED', config: sealed },
    });
    const { getIntegrationCreds } = await import('../src/integration-creds.js');
    expect((await getIntegrationCreds(prisma, A.orgId, 'Companies House'))?.key).toBe('epc-live-key');

    // the same ciphertext under another workspace's row does not open
    await prisma.integrationConnection.create({
      data: { orgId: B.orgId, provider: 'Companies House', status: 'CONNECTED', config: sealed },
    });
    await expect(getIntegrationCreds(prisma, B.orgId, 'Companies House')).resolves.toBeNull();
  });
});

describe('what leaves the building', () => {
  it('redacts every sealed column from a workspace export', async () => {
    const dump = JSON.stringify(await exportWorkspace(prisma, A.orgId));
    // the export's own notes promise credentials are excluded; its rule matched
    // on NAME, and `config` is not a name that rule catches, so every export
    // carried the firm's pasted API keys until this
    expect(dump).not.toContain('epc-live-key');

    const parsed = JSON.parse(dump) as { data: Record<string, Array<Record<string, unknown>>> };
    for (const { model, fields } of SEALED_FIELDS) {
      const table = model[0]!.toUpperCase() + model.slice(1);
      for (const row of parsed.data[table] ?? []) {
        for (const field of fields) {
          if (!(field in row)) continue;
          expect(row[field], `${table}.${field} left the building`).toBe('[redacted]');
        }
      }
    }
  });
});

describe('the fifth column', () => {
  it('finds no credential anywhere in the raw tables after the real procedures have run', async () => {
    /**
     * The one that catches what nobody thought of.
     *
     * Sealing four known columns is the easy half. The failure this guards is a
     * new integration landing, writing a token to a new column, working
     * perfectly, and nobody noticing — so this searches every row of every table
     * for the literal secrets the procedures above were handed, rather than
     * checking the columns we already remembered.
     */
    const secrets = ['epc-live-key', 'whsec_legacy', 'oidc-client-secret'];

    /**
     * Written through the REAL procedures, and swept with no backfill in
     * between. That ordering is the test.
     *
     * The first version of this planted a plaintext row, ran
     * backfillSealedFields and then swept — and passed with the seal removed
     * from the procedure, because the backfill had quietly put it back. Which is
     * also the honest limit of the backfill in production: it runs at boot, so a
     * token written at nine in the morning by a write site that forgot sits in
     * the clear until the next deploy. The backfill is for rows that predate the
     * seal; it is not a safety net for new code, and a test that let it act as
     * one was testing the wrong thing.
     */
    const sso = {
      issuer: 'https://login.microsoftonline.test/t/v2.0',
      clientId: 'apex-app',
      domains: ['vault.test'],
    };
    // twice: saveSso creates on the first call and updates on the second, and
    // those are two separate places the seal can be dropped
    const first = (await admin(A).org.saveSso({ ...sso, clientSecret: 'oidc-client-secret' } as never)) as {
      updatedAt?: Date;
    };
    // the stamp the first save handed back — the panel now carries one, so a
    // second administrator cannot silently restore five fields
    await admin(A).org.saveSso({
      ...sso,
      clientSecret: 'oidc-client-secret-rotated',
      expectedUpdatedAt: first.updatedAt,
    } as never);

    const tables: string[] = (
      await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'",
      )
    ).map((r) => r.name);
    expect(tables.length, 'read no tables — this test is looking at the wrong database').toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const table of tables) {
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "${table}"`);
      for (const row of rows) {
        for (const [column, value] of Object.entries(row)) {
          if (typeof value !== 'string') continue;
          for (const secret of secrets) {
            if (value.includes(secret)) offenders.push(`${table}.${column}`);
          }
        }
      }
    }

    expect(
      [...new Set(offenders)],
      'a credential is sitting in the database in plain text — seal it and add the column to SEALED_FIELDS',
    ).toEqual([]);
  });
});
