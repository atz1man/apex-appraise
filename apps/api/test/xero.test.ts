import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accessTokenFor,
  attributeSpend,
  authorizeUrl,
  exchangeCode,
  syncXero,
  type XeroBill,
  type XeroTransport,
} from '../src/xero.js';
import { makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Xero, against a fake Xero.
 *
 * The real service cannot be reached from a test suite and should not be: what
 * matters here is the logic that breaks integrations in production — rotating
 * refresh tokens, attributing a contractor's invoice across schemes, and never
 * standing on a quantity surveyor's own figures.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  process.env.XERO_CLIENT_ID = 'test-client';
  process.env.XERO_CLIENT_SECRET = 'test-secret';
  // reset ONCE: the Prisma client holds a connection, and dropping the file under
  // it mid-file leaves every later test talking to a database that is not there
  resetDatabase();
}, 120_000);

beforeEach(async () => {
  // a fresh pair of workspaces per test instead, so nothing is shared
  A = await makeTenant('Ledger');
  B = await makeTenant('Rival');
}, 60_000);

/** A Xero that hands out a new refresh token every time, as the real one does. */
function fakeXero(opts: { bills?: XeroBill[]; rotation?: string[] } = {}) {
  const calls: string[] = [];
  let rotationIndex = 0;
  const transport: XeroTransport = async (url, init) => {
    calls.push(`${init.method} ${url.split('?')[0]}`);
    if (url.includes('connect/token')) {
      const next = opts.rotation?.[rotationIndex++] ?? `refresh-${rotationIndex}`;
      return {
        status: 200,
        json: async () => ({ access_token: `access-${rotationIndex}`, refresh_token: next, expires_in: 1800 }),
      };
    }
    if (url.includes('/connections')) {
      return { status: 200, json: async () => [{ tenantId: 'xero-tenant-1', tenantName: 'Brookfield Ltd' }] };
    }
    return { status: 200, json: async () => ({ Invoices: opts.bills ?? [] }) };
  };
  return { transport, calls };
}

const connect = (t: Tenant, over: Record<string, unknown> = {}) =>
  prisma.xeroConnection.create({
    data: {
      orgId: t.orgId,
      tenantId: 'xero-tenant-1',
      tenantName: 'Brookfield Ltd',
      accessToken: 'access-0',
      refreshToken: 'refresh-0',
      expiresAt: new Date(Date.now() + 30 * 60_000),
      scopes: 'accounting.transactions.read',
      connectedById: t.userId,
      trackingCategoryId: 'cat-1',
      trackingCategoryName: 'Scheme',
      ...over,
    },
  });

const bill = (id: string, total: number, lines: Array<[string, string, number]>, paid = 0): XeroBill => ({
  InvoiceID: id,
  Type: 'ACCPAY',
  Status: 'AUTHORISED',
  Total: total,
  AmountPaid: paid,
  LineItems: lines.map(([optId, optName, amount]) => ({
    LineAmount: amount,
    Tracking: optId ? [{ TrackingCategoryID: 'cat-1', TrackingOptionID: optId, Name: 'Scheme', Option: optName }] : [],
  })),
});

describe('the consent step', () => {
  it('asks for read-only access and carries a state to check on return', () => {
    const { url, state } = authorizeUrl('https://apex.test/xero/callback');
    expect(url).toContain('accounting.transactions.read');
    // Apex reports on the ledger; it has no business writing to it
    expect(url).not.toContain('.write');
    expect(url).toContain(encodeURIComponent('https://apex.test/xero/callback'));
    expect(state.length).toBeGreaterThan(10);
    expect(authorizeUrl('https://apex.test/x').state).not.toBe(state);
  });

  it('surfaces a refusal from Xero rather than storing a broken connection', async () => {
    const transport: XeroTransport = async () => ({
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'code expired' }),
    });
    await expect(exchangeCode('stale', 'https://apex.test/cb', transport)).rejects.toThrow(/code expired/);
  });
});

describe('refresh tokens rotate', () => {
  it('saves the NEW refresh token, because the old one is dead the moment it is used', async () => {
    await connect(A, { expiresAt: new Date(Date.now() - 1000) });
    const { transport } = fakeXero({ rotation: ['refresh-NEW'] });

    const token = await accessTokenFor(prisma, A.orgId, transport);
    expect(token).toBe('access-1');

    const row = await prisma.xeroConnection.findUniqueOrThrow({ where: { orgId: A.orgId } });
    // losing this write kills the connection permanently, with no error until the
    // next sync — which is the failure this whole module is shaped around
    expect(row.refreshToken).toBe('refresh-NEW');
    expect(row.accessToken).toBe('access-1');
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not refresh a token that is still good', async () => {
    await connect(A);
    const { transport, calls } = fakeXero();
    expect(await accessTokenFor(prisma, A.orgId, transport)).toBe('access-0');
    expect(calls).toEqual([]);
  });

  it('refreshes once when two callers race, not twice', async () => {
    /**
     * Two refreshes in parallel means the second invalidates the first's brand-new
     * token and the connection dies. The in-flight promise is shared for exactly
     * this reason.
     */
    await connect(A, { expiresAt: new Date(Date.now() - 1000) });
    const { transport, calls } = fakeXero();
    const [one, two] = await Promise.all([
      accessTokenFor(prisma, A.orgId, transport),
      accessTokenFor(prisma, A.orgId, transport),
    ]);
    expect(one).toBe(two);
    expect(calls.filter((c) => c.includes('connect/token'))).toHaveLength(1);
  });

  it('refreshes early rather than late', async () => {
    // a token with 30 seconds left would expire mid-call
    await connect(A, { expiresAt: new Date(Date.now() + 30_000) });
    const { transport, calls } = fakeXero();
    await accessTokenFor(prisma, A.orgId, transport);
    expect(calls.filter((c) => c.includes('connect/token'))).toHaveLength(1);
  });
});

describe('attributing a bill to a scheme', () => {
  it('splits a contractor invoice across schemes by LINE, not by whichever came first', () => {
    // one invoice, two sites — counting the total against either would move money
    // between schemes
    const bills = [bill('inv-1', 100_000, [['opt-a', 'Harbour', 60_000], ['opt-b', 'Kingsway', 40_000]])];
    const { byOption } = attributeSpend(bills, 'cat-1');
    expect(byOption.get('opt-a')!.committed).toBe(60_000);
    expect(byOption.get('opt-b')!.committed).toBe(40_000);
  });

  it('apportions a part-payment across the lines it covers', () => {
    const bills = [bill('inv-1', 100_000, [['opt-a', 'Harbour', 60_000], ['opt-b', 'Kingsway', 40_000]], 50_000)];
    const { byOption } = attributeSpend(bills, 'cat-1');
    // half the invoice is paid, so half of each line is
    expect(byOption.get('opt-a')!.paid).toBeCloseTo(30_000, 6);
    expect(byOption.get('opt-b')!.paid).toBeCloseTo(20_000, 6);
  });

  it('counts what it could not attribute instead of guessing', () => {
    const bills = [bill('inv-1', 50_000, [['', 'untagged', 50_000]])];
    const { byOption, untrackedTotal, untrackedLines } = attributeSpend(bills, 'cat-1');
    expect(byOption.size).toBe(0);
    // silently dropping it would under-report every position
    expect(untrackedTotal).toBe(50_000);
    expect(untrackedLines).toBe(1);
  });

  it('ignores tracking from a different category', () => {
    const bills: XeroBill[] = [
      {
        InvoiceID: 'inv-1',
        Type: 'ACCPAY',
        Status: 'AUTHORISED',
        Total: 10_000,
        LineItems: [
          { LineAmount: 10_000, Tracking: [{ TrackingCategoryID: 'cat-OTHER', TrackingOptionID: 'x', Name: 'Region', Option: 'South' }] },
        ],
      },
    ];
    const { byOption, untrackedLines } = attributeSpend(bills, 'cat-1');
    expect(byOption.size).toBe(0);
    expect(untrackedLines).toBe(1);
  });
});

describe('the sync', () => {
  it('writes ledger spend to the mapped deal and leaves manual packages alone', async () => {
    await connect(A);
    await prisma.xeroDealMap.create({
      data: { orgId: A.orgId, dealId: A.dealId, trackingOptionId: 'opt-a', trackingOptionName: 'Harbour' },
    });
    const manual = await prisma.costPackage.create({
      data: { orgId: A.orgId, dealId: A.dealId, name: 'Groundworks', budget: BigInt(500_000_00), committed: BigInt(100_000_00), spent: BigInt(0), forecast: BigInt(500_000_00), retentionPct: 5, progressPct: 40 },
    });

    const { transport } = fakeXero({ bills: [bill('inv-1', 80_000, [['opt-a', 'Harbour', 80_000]], 20_000)] });
    const out = await syncXero(prisma, A.orgId, transport);

    expect(out).toMatchObject({ deals: 1, packages: 1, committed: 80_000, paid: 20_000 });
    const fromXero = await prisma.costPackage.findFirstOrThrow({ where: { orgId: A.orgId, source: 'xero' } });
    expect(Number(fromXero.committed)).toBe(80_000_00);
    expect(Number(fromXero.spent)).toBe(20_000_00);

    // the QS's package is untouched — budget, progress and retention are their
    // judgement, and an integration that overwrote them would be switched off
    const after = await prisma.costPackage.findUniqueOrThrow({ where: { id: manual.id } });
    expect(after).toMatchObject({ budget: manual.budget, progressPct: 40, retentionPct: 5 });
  });

  it('preserves a budget set by a human across syncs', async () => {
    await connect(A);
    await prisma.xeroDealMap.create({
      data: { orgId: A.orgId, dealId: A.dealId, trackingOptionId: 'opt-a', trackingOptionName: 'Harbour' },
    });
    const first = fakeXero({ bills: [bill('inv-1', 10_000, [['opt-a', 'Harbour', 10_000]])] });
    await syncXero(prisma, A.orgId, first.transport);

    // a human sets the budget the ledger cannot know
    const pkg = await prisma.costPackage.findFirstOrThrow({ where: { orgId: A.orgId, source: 'xero' } });
    await prisma.costPackage.update({ where: { id: pkg.id }, data: { budget: BigInt(250_000_00), progressPct: 30 } });

    const second = fakeXero({ bills: [bill('inv-1', 90_000, [['opt-a', 'Harbour', 90_000]])] });
    await syncXero(prisma, A.orgId, second.transport);

    const after = await prisma.costPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(Number(after.committed)).toBe(90_000_00); // the ledger moved
    expect(Number(after.budget)).toBe(250_000_00); // the judgement did not
    expect(after.progressPct).toBe(30);
  });

  it('reports spend nobody has mapped rather than inventing a home for it', async () => {
    await connect(A);
    const { transport } = fakeXero({ bills: [bill('inv-1', 30_000, [['opt-unknown', 'Mystery Site', 30_000]])] });
    const out = await syncXero(prisma, A.orgId, transport);
    expect(out.packages).toBe(0);
    expect(out.unmapped).toEqual([
      { trackingOptionId: 'opt-unknown', trackingOptionName: 'Mystery Site', committed: 30_000 },
    ]);
  });

  it('will not write into another workspace’s deal', async () => {
    await connect(A);
    // a stale map row pointing at somebody else's deal
    await prisma.xeroDealMap.create({
      data: { orgId: A.orgId, dealId: B.dealId, trackingOptionId: 'opt-a', trackingOptionName: 'Theirs' },
    });
    const { transport } = fakeXero({ bills: [bill('inv-1', 40_000, [['opt-a', 'Theirs', 40_000]])] });
    const out = await syncXero(prisma, A.orgId, transport);

    expect(out.packages).toBe(0);
    expect(await prisma.costPackage.count({ where: { dealId: B.dealId } })).toBe(0);
  });

  it('refuses to sync before someone says which category names the scheme', async () => {
    await connect(A, { trackingCategoryId: null, trackingCategoryName: null });
    const { transport } = fakeXero();
    await expect(syncXero(prisma, A.orgId, transport)).rejects.toThrow(/tracking category/i);
  });

  it('refuses to sync a workspace that is not connected', async () => {
    const { transport } = fakeXero();
    await expect(syncXero(prisma, A.orgId, transport)).rejects.toThrow(/not connected/i);
  });
});
