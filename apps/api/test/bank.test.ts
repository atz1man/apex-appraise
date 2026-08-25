import { beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_DAYS, accessTokenFor, fetchAccounts, fetchTransactions, syncBank, type BankTransport } from '../src/open-banking.js';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
import { openFor } from '../src/sealed-fields.js';

/**
 * The bank feed, against a fake provider.
 *
 * Two properties carry the weight. Syncing the same window twice must import
 * nothing the second time — otherwise "sync now" pressed twice doubles a deal's
 * spend and the person who pressed it cannot tell. And a consent that has expired
 * must say so in those words: a PSD2 consent dies after ninety days while the
 * refresh token still looks fine, and "HTTP 403" sends someone hunting.
 */

let A: Tenant;

const remoteTx = (id: string, amountPounds: number, description = 'Payment') => ({
  transaction_id: id,
  timestamp: new Date().toISOString(),
  amount: amountPounds,
  description,
});

const transportFor = (txs: unknown[]): BankTransport => async (url) => {
  if (url.includes('/accounts/') && url.includes('/transactions')) {
    return { status: 200, json: async () => ({ results: txs }) };
  }
  if (url.includes('/data/v1/accounts')) {
    return {
      status: 200,
      json: async () => ({ results: [{ account_id: 'acc-1', display_name: 'Development account', currency: 'GBP', account_number: { number: '12345678' } }] }),
    };
  }
  return { status: 200, json: async () => ({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }) };
};

beforeAll(async () => {
  resetDatabase();
}, 120_000);

const connectFixture = async (over: Record<string, unknown> = {}) => {
  const t = await makeTenant('Bank');
  const conn = await prisma.bankConnection.create({
    data: {
      orgId: t.orgId,
      institution: 'Test Bank',
      accessToken: 'live-token',
      refreshToken: 'r1',
      expiresAt: new Date(Date.now() + 3_600_000),
      consentExpiresAt: new Date(Date.now() + CONSENT_DAYS * 86_400_000),
      createdById: t.userId,
      ...over,
    },
  });
  const account = await prisma.bankAccount.create({
    data: { orgId: t.orgId, connectionId: conn.id, externalId: 'acc-1', name: 'Development account', last4: '5678', dealId: t.dealId },
  });
  return { t, conn, account };
};

describe('reading the provider', () => {
  it('stores only the last four digits of an account number', async () => {
    const accounts = await fetchAccounts('token', transportFor([]));
    expect(accounts[0]).toMatchObject({ externalId: 'acc-1', last4: '5678' });
    // the full number has no business being kept just to show which account
    expect(JSON.stringify(accounts)).not.toContain('12345678');
  });

  it('converts pounds to integer pence, signs intact', async () => {
    const txs = await fetchTransactions('token', 'acc-1', new Date(0), transportFor([remoteTx('t1', -1234.56), remoteTx('t2', 5000)]));
    expect(txs.map((t) => t.amount)).toEqual([-123456, 500000]);
  });
});

describe('syncing', () => {
  it('imports transactions once, however many times it runs', async () => {
    const { t } = await connectFixture();
    const transport = transportFor([remoteTx('t1', -1000), remoteTx('t2', -2000)]);

    const first = await syncBank(prisma, t.orgId, { transport });
    expect(first).toMatchObject({ imported: 2, skipped: 0 });

    // the same window again: nothing new, and nothing doubled
    const second = await syncBank(prisma, t.orgId, { transport });
    expect(second).toMatchObject({ imported: 0, skipped: 2 });

    const rows = await prisma.bankTransaction.findMany({ where: { orgId: t.orgId } });
    expect(rows).toHaveLength(2);
  });

  it('says the consent expired, in those words', async () => {
    const { t } = await connectFixture({ consentExpiresAt: new Date(Date.now() - 1000) });
    // the refresh token is still fine; the CONSENT is not, and only one of those
    // is fixable by the person reading the message
    await expect(syncBank(prisma, t.orgId, { transport: transportFor([]) })).rejects.toThrow(/consent has expired/i);
  });

  it('records why a sync failed rather than losing it', async () => {
    const { t } = await connectFixture();
    const broken: BankTransport = async (url) =>
      url.includes('transactions') ? { status: 500, json: async () => ({}) } : { status: 200, json: async () => ({ results: [] }) };
    await expect(syncBank(prisma, t.orgId, { transport: broken })).rejects.toThrow();
    const conn = await prisma.bankConnection.findUniqueOrThrow({ where: { orgId: t.orgId } });
    expect(conn.lastSyncError).toContain('500');
  });

  it('refreshes an aged access token without touching the consent clock', async () => {
    const { t, conn } = await connectFixture({ expiresAt: new Date(Date.now() - 1000) });
    const token = await accessTokenFor(prisma, t.orgId, transportFor([]));
    expect(token).toBe('fresh');
    const after = await prisma.bankConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(openFor('bankConnection', 'refreshToken', t.orgId, after.refreshToken)).toBe('r2');
    // sealed on the way in: a PSD2 refresh token reads the customer's bank feed
    expect(after.refreshToken).not.toBe('r2');
    expect(after.consentExpiresAt.getTime()).toBe(conn.consentExpiresAt.getTime());
  });
});

describe('classification', () => {
  it('leaves money in unclassified until somebody says what it is', async () => {
    const { t } = await connectFixture();
    await syncBank(prisma, t.orgId, { transport: transportFor([remoteTx('in-1', 250000, 'FASTER PAYMENT')]) });
    const row = await prisma.bankTransaction.findFirstOrThrow({ where: { orgId: t.orgId } });
    // a credit might be the facility, equity or a sale receipt — guessing would
    // either flatter or damn the position
    expect(row.classification).toBe('unclassified');

    // the queue reports pounds: £250,000 in, awaiting a decision
    const pending = (await callerFor(t.principal).bank.unclassified()) as Array<{ id: string; amount: number }>;
    expect(pending.map((p) => p.amount)).toContain(250_000);
  });

  it('records who classified it', async () => {
    const { t } = await connectFixture();
    await syncBank(prisma, t.orgId, { transport: transportFor([remoteTx('in-2', 400000)]) });
    const row = await prisma.bankTransaction.findFirstOrThrow({ where: { orgId: t.orgId } });
    await callerFor(t.principal).bank.classify({ id: row.id, classification: 'drawdown' } as never);
    const after = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.id } });
    // a drawdown figure in a lender pack should be attributable to a person
    expect(after).toMatchObject({ classification: 'drawdown', classifiedById: t.userId });
  });

  it('will not classify another firm’s transaction', async () => {
    const { t } = await connectFixture();
    await syncBank(prisma, t.orgId, { transport: transportFor([remoteTx('in-3', 100000)]) });
    const row = await prisma.bankTransaction.findFirstOrThrow({ where: { orgId: t.orgId } });
    const other = await makeTenant('Nosy');
    await expectDenied('classify across orgs', () =>
      callerFor(other.principal).bank.classify({ id: row.id, classification: 'equity' } as never),
    );
  });
});

describe('what the portfolio uses', () => {
  it('prefers the bank, and says so', async () => {
    const { t } = await connectFixture();
    await callerFor(t.principal).appraisal.save({
      dealId: t.dealId,
      input: {
        units: [{ label: 'Units', count: 6, area: 800, cap: 400 }],
        efficiency: 85,
        trades: [{ label: 'Build', rate: 120 }],
        profFeePct: 11,
        contingencyPct: 5,
        otherCosts: [],
        finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 12, salesMonths: 3, arrangementFeePct: 1.5, spendProfile: 'scurve' },
        site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
        disposal: { agentPct: 1.5, legalPct: 0.5 },
        targetProfitOnGdvPct: 20,
      },
      label: 'Base',
    } as never);
    await syncBank(prisma, t.orgId, { transport: transportFor([remoteTx('d1', 300000), remoteTx('p1', -120000)]) });
    const draw = await prisma.bankTransaction.findFirstOrThrow({ where: { orgId: t.orgId, amount: { gt: 0 } } });
    await callerFor(t.principal).bank.classify({ id: draw.id, classification: 'drawdown' } as never);

    const e = (await callerFor(t.principal).deals.exposure()) as {
      positions: Array<{ dealId: string; drawn: number; drawnSource: string; paid: number }>;
    };
    const pos = e.positions.find((p) => p.dealId === t.dealId)!;
    expect(pos.drawnSource).toBe('bank');
    expect(pos.drawn).toBe(300_000);
    expect(pos.paid).toBe(120_000);
  });

  it('falls back to committed spend for a deal with no account, and labels it', async () => {
    const t = await makeTenant('NoFeed');
    await callerFor(t.principal).appraisal.save({
      dealId: t.dealId,
      input: {
        units: [{ label: 'Units', count: 6, area: 800, cap: 400 }],
        efficiency: 85,
        trades: [{ label: 'Build', rate: 120 }],
        profFeePct: 11,
        contingencyPct: 5,
        otherCosts: [],
        finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 12, salesMonths: 3, arrangementFeePct: 1.5, spendProfile: 'scurve' },
        site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
        disposal: { agentPct: 1.5, legalPct: 0.5 },
        targetProfitOnGdvPct: 20,
      },
      label: 'Base',
    } as never);
    const e = (await callerFor(t.principal).deals.exposure()) as {
      positions: Array<{ dealId: string; drawnSource: string }>;
    };
    expect(e.positions.find((p) => p.dealId === t.dealId)!.drawnSource).toBe('committed');
  });
});
