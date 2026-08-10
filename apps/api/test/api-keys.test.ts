import { beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { hashApiKey, mintApiKey, principalFromApiKey } from '../src/api-keys.js';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Credentials for the public API.
 *
 * The property that matters most is not that a good key works — it is that
 * nothing ELSE does. A session JWT, a revoked key and a key from another
 * workspace must all fail here, because the public API is a second front door and
 * a server that quietly accepts either credential has one door, not two.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Keys');
  B = await makeTenant('Other');
}, 120_000);

const create = (t: Tenant, name = 'CI', write = false) =>
  callerFor({ ...t.principal, role: 'ADMIN' }).org.createApiKey({ name, write } as never) as Promise<{
    id: string;
    key: string;
    scopes: string[];
  }>;

describe('minting', () => {
  it('shows the key once and stores only a hash', async () => {
    const made = await create(A);
    expect(made.key).toMatch(/^apex_live_/);

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.keyHash).toBe(hashApiKey(made.key));
    expect(JSON.stringify(row)).not.toContain(made.key);

    const listed = (await callerFor({ ...A.principal, role: 'ADMIN' }).org.apiKeys()) as Array<Record<string, unknown>>;
    expect(JSON.stringify(listed)).not.toContain(made.key);
    expect(listed[0]).not.toHaveProperty('keyHash');
  });

  it('gives each key a different secret', () => {
    expect(mintApiKey().key).not.toBe(mintApiKey().key);
  });

  it('is read-only unless write is asked for', async () => {
    expect((await create(A, 'reader')).scopes).toEqual(['read']);
    expect((await create(A, 'writer', true)).scopes).toEqual(['read', 'write']);
  });

  it('is admin-only', async () => {
    await expect(
      callerFor({ ...A.principal, role: 'ANALYST' }).org.createApiKey({ name: 'sneaky', write: false } as never),
    ).rejects.toThrow(/Admin/i);
  });
});

describe('authenticating', () => {
  it('accepts a live key and resolves it to its workspace', async () => {
    const made = await create(A, 'live');
    const principal = await principalFromApiKey(prisma, `Bearer ${made.key}`);
    expect(principal?.orgId).toBe(A.orgId);
  });

  it('refuses a revoked key', async () => {
    const made = await create(A, 'doomed');
    await callerFor({ ...A.principal, role: 'ADMIN' }).org.revokeApiKey({ id: made.id } as never);
    expect(await principalFromApiKey(prisma, `Bearer ${made.key}`)).toBeNull();
  });

  it('refuses a SESSION token, however valid', async () => {
    /**
     * The mistake this exists to prevent: a session JWT is a perfectly good
     * credential for the app and must be worthless here. Accepting it would make
     * every logged-in browser an API client and the key model decoration.
     */
    const session = jwt.sign({ sub: A.userId }, process.env.JWT_SECRET ?? 'test-secret');
    expect(await principalFromApiKey(prisma, `Bearer ${session}`)).toBeNull();
  });

  it('refuses nonsense, and does not throw on it', async () => {
    for (const header of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', 'apex_live_no_bearer', 'Bearer apex_live_wrong']) {
      expect(await principalFromApiKey(prisma, header as string | undefined)).toBeNull();
    }
  });

  it('cannot revoke another workspace’s key', async () => {
    const made = await create(A, 'mine');
    await expectDenied('revoke across orgs', () =>
      callerFor({ ...B.principal, role: 'ADMIN' }).org.revokeApiKey({ id: made.id } as never),
    );
    // still live — a refusal that half-worked would be worse than none
    expect(await principalFromApiKey(prisma, `Bearer ${made.key}`)).not.toBeNull();
  });

  it('records minting and revoking on the audit trail', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { orgId: A.orgId, action: { contains: 'API key' } },
    });
    expect(events.some((e) => e.action.includes('created'))).toBe(true);
    expect(events.some((e) => e.action.includes('revoked'))).toBe(true);
    expect(events.every((e) => e.userId === A.userId)).toBe(true);
  });
});
