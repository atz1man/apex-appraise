import { beforeAll, describe, expect, it } from 'vitest';
import { SHARE_MAX_DAYS, hashShareToken, newShareToken, shareRefusal } from '../src/share.js';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

let A: Tenant;
let B: Tenant;

const input = () => ({
  units: [{ label: 'Units', count: 8, area: 800, cap: 400 }],
  efficiency: 85,
  trades: [{ label: 'Build', rate: 120 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 16, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Sharer');
  B = await makeTenant('Rival');
  await callerFor(A.principal).appraisal.save({ dealId: A.dealId, input: input(), label: 'Base' } as never);
}, 120_000);

describe('the token', () => {
  it('is stored hashed, so a leaked row is not a working link', async () => {
    const created = (await callerFor(A.principal).appraisal.createShare({
      dealId: A.dealId, kind: 'appraisal', days: 30,
    } as never)) as { id: string; token: string };

    const row = await prisma.reportShare.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.tokenHash).not.toBe(created.token);
    expect(row.tokenHash).toBe(hashShareToken(created.token));
    // the raw token appears nowhere in the record
    expect(JSON.stringify(row)).not.toContain(created.token);
  });

  it('is long enough that guessing is not a strategy', () => {
    const { token } = newShareToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(newShareToken().token).not.toBe(token);
  });

  it('is never handed back after creation', async () => {
    const shares = (await callerFor(A.principal).appraisal.shares(A.dealId)) as Array<Record<string, unknown>>;
    expect(shares.length).toBeGreaterThan(0);
    for (const s of shares) {
      expect(s).not.toHaveProperty('token');
      // not even the hash: it is not the token, but hashes get treated as secrets
      expect(s).not.toHaveProperty('tokenHash');
    }
  });
});

describe('when a link stops working', () => {
  it('refuses once expired', () => {
    const past = new Date(Date.now() - 1000);
    expect(shareRefusal({ expiresAt: past, revokedAt: null })).toBe('expired');
    expect(shareRefusal({ expiresAt: new Date(Date.now() + 60_000), revokedAt: null })).toBeNull();
  });

  it('reports a withdrawn link as revoked even after it also ages out', () => {
    // the firm's own records should say what actually happened
    const refusal = shareRefusal({ expiresAt: new Date(Date.now() - 1000), revokedAt: new Date(Date.now() - 500) });
    expect(refusal).toBe('revoked');
  });

  it('can be revoked, and revoking twice is not an error', async () => {
    const created = (await callerFor(A.principal).appraisal.createShare({
      dealId: A.dealId, kind: 'appraisal',
    } as never)) as { id: string };

    await callerFor(A.principal).appraisal.revokeShare({ id: created.id } as never);
    // a second click in a panicked moment must not show a failure
    await expect(callerFor(A.principal).appraisal.revokeShare({ id: created.id } as never)).resolves.toMatchObject({ ok: true });

    const row = await prisma.reportShare.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(shareRefusal(row)).toBe('revoked');
  });

  it('caps how long a link can be made to live', async () => {
    await expect(
      callerFor(A.principal).appraisal.createShare({ dealId: A.dealId, kind: 'appraisal', days: SHARE_MAX_DAYS + 1 } as never),
    ).rejects.toThrow();
  });
});

describe('whose links they are', () => {
  it('will not share another firm’s deal', async () => {
    await expectDenied('createShare across orgs', () =>
      callerFor(B.principal).appraisal.createShare({ dealId: A.dealId, kind: 'appraisal' } as never),
    );
  });

  it('will not revoke another firm’s link', async () => {
    const created = (await callerFor(A.principal).appraisal.createShare({
      dealId: A.dealId, kind: 'appraisal',
    } as never)) as { id: string };
    await expectDenied('revokeShare across orgs', () =>
      callerFor(B.principal).appraisal.revokeShare({ id: created.id } as never),
    );
    const row = await prisma.reportShare.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.revokedAt).toBeNull();
  });

  it('records the share on the deal’s trail', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { orgId: A.orgId, action: { contains: 'shared a report' } },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.userId).toBe(A.userId);
  });
});
