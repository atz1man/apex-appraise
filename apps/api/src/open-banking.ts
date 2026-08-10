import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * UK Open Banking, through TrueLayer.
 *
 * Account information only. Apex reads a statement and never initiates a payment
 * — the scopes below say so, and a product that holds valuations has no business
 * asking a bank for the ability to move money.
 *
 * The detail that matters and that most implementations miss: under PSD2 an
 * account-information consent EXPIRES, ninety days being the UK norm. A feed set
 * up in March stops in June, and if the product only notices when a sync fails,
 * the firm finds out from a lender asking why the pack is stale. The expiry is
 * stored at connection time and surfaced before it bites.
 */

const AUTH_BASE = process.env.TRUELAYER_AUTH_BASE ?? 'https://auth.truelayer.com';
const API_BASE = process.env.TRUELAYER_API_BASE ?? 'https://api.truelayer.com';

/** Read-only. `accounts` and `transactions`, plus offline access to refresh. */
export const BANK_SCOPES = 'info accounts transactions offline_access';
/** UK PSD2 consent life. Stored per connection rather than assumed at read time. */
export const CONSENT_DAYS = 90;

export const bankConfigured = () => !!process.env.TRUELAYER_CLIENT_ID && !!process.env.TRUELAYER_CLIENT_SECRET;

export interface BankTransport {
  (url: string, init?: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number;
    json: () => Promise<unknown>;
  }>;
}

const realTransport: BankTransport = async (url, init) => {
  const res = await fetch(url, { ...(init ?? { method: 'GET', headers: {} }), signal: AbortSignal.timeout(20_000) });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TRUELAYER_CLIENT_ID ?? '',
    scope: BANK_SCOPES,
    redirect_uri: redirectUri,
    state,
    // UK banks only, and no test providers in a live deployment
    providers: 'uk-ob-all uk-oauth-all',
  });
  return `${AUTH_BASE}/?${params}`;
}

export interface BankTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
  transport: BankTransport = realTransport,
): Promise<BankTokens> {
  const res = await transport(`${AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.TRUELAYER_CLIENT_ID ?? '',
      client_secret: process.env.TRUELAYER_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (res.status !== 200 || !body.access_token || !body.refresh_token) {
    throw new Error(`The bank connection failed: ${body.error ?? `HTTP ${res.status}`}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
  };
}

async function refresh(refreshToken: string, transport: BankTransport = realTransport): Promise<BankTokens> {
  const res = await transport(`${AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.TRUELAYER_CLIENT_ID ?? '',
      client_secret: process.env.TRUELAYER_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (res.status !== 200 || !body.access_token) throw new Error('The bank connection needs to be renewed.');
  return {
    accessToken: body.access_token,
    // a rotated refresh token replaces the old one; a provider that does not
    // rotate returns the same value, so keeping the incoming one is wrong
    refreshToken: body.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
  };
}

/** A usable access token, refreshing if the stored one has aged out. */
export async function accessTokenFor(
  prisma: PrismaClient,
  orgId: string,
  transport: BankTransport = realTransport,
): Promise<string> {
  const conn = await prisma.bankConnection.findUnique({ where: { orgId } });
  if (!conn) throw new Error('No bank account is connected.');

  /**
   * Consent first. A refresh token can still be valid while the CONSENT behind
   * it has expired, and the request that follows fails in a way nobody can read.
   * Saying "the consent ran out, re-authorise" is the difference between a
   * five-minute fix and a support ticket.
   */
  if (conn.consentExpiresAt.getTime() <= Date.now()) {
    throw new Error('Your bank consent has expired — reconnect the account to resume the feed.');
  }

  if (conn.expiresAt.getTime() > Date.now() + 60_000) return conn.accessToken;
  const fresh = await refresh(conn.refreshToken, transport);
  await prisma.bankConnection.update({
    where: { id: conn.id },
    data: { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt },
  });
  return fresh.accessToken;
}

export interface RemoteAccount {
  externalId: string;
  name: string;
  last4: string;
  currency: string;
}

export async function fetchAccounts(accessToken: string, transport: BankTransport = realTransport): Promise<RemoteAccount[]> {
  const res = await transport(`${API_BASE}/data/v1/accounts`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (res.status !== 200) throw new Error(`Could not read accounts: HTTP ${res.status}`);
  const body = (await res.json()) as {
    results?: Array<{ account_id: string; display_name?: string; currency?: string; account_number?: { number?: string } }>;
  };
  return (body.results ?? []).map((a) => ({
    externalId: a.account_id,
    name: a.display_name ?? 'Account',
    // last four only — a full account number has no business being stored just
    // to show somebody which account they picked
    last4: (a.account_number?.number ?? '').slice(-4),
    currency: a.currency ?? 'GBP',
  }));
}

export interface RemoteTransaction {
  externalId: string;
  bookedAt: Date;
  /** pence, signed */
  amount: number;
  description: string;
}

export async function fetchTransactions(
  accessToken: string,
  externalAccountId: string,
  from: Date,
  transport: BankTransport = realTransport,
): Promise<RemoteTransaction[]> {
  const params = new URLSearchParams({ from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const res = await transport(`${API_BASE}/data/v1/accounts/${externalAccountId}/transactions?${params}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (res.status !== 200) throw new Error(`Could not read transactions: HTTP ${res.status}`);
  const body = (await res.json()) as {
    results?: Array<{ transaction_id: string; timestamp: string; amount: number; description?: string; currency?: string }>;
  };
  return (body.results ?? []).map((t) => ({
    externalId: t.transaction_id,
    bookedAt: new Date(t.timestamp),
    // the provider reports pounds as a float; pence as an integer is the only
    // representation this product stores money in
    amount: Math.round(t.amount * 100),
    description: (t.description ?? '').slice(0, 200),
  }));
}

export interface BankSyncResult {
  accounts: number;
  imported: number;
  /** already held — re-syncing a window must not double-count */
  skipped: number;
  unclassifiedIn: number;
  consentExpiresAt: Date;
}

/**
 * Pull recent transactions for every mapped account.
 *
 * Idempotent by the provider's own transaction id: syncing the same window twice
 * imports nothing the second time. Without that, "sync now" pressed twice would
 * double a deal's spend, and the person who pressed it would have no way to tell.
 */
export async function syncBank(
  prisma: PrismaClient,
  orgId: string,
  opts: { days?: number; transport?: BankTransport } = {},
): Promise<BankSyncResult> {
  const transport = opts.transport ?? realTransport;
  const conn = await prisma.bankConnection.findUnique({ where: { orgId }, include: { accounts: true } });
  if (!conn) throw new Error('No bank account is connected.');

  const token = await accessTokenFor(prisma, orgId, transport);
  const from = new Date(Date.now() - (opts.days ?? 90) * 24 * 60 * 60 * 1000);

  let imported = 0;
  let skipped = 0;
  try {
    for (const account of conn.accounts) {
      const remote = await fetchTransactions(token, account.externalId, from, transport);
      for (const t of remote) {
        const existing = await prisma.bankTransaction.findUnique({
          where: { accountId_externalId: { accountId: account.id, externalId: t.externalId } },
        });
        if (existing) {
          skipped++;
          continue;
        }
        await prisma.bankTransaction.create({
          data: {
            orgId,
            accountId: account.id,
            externalId: t.externalId,
            bookedAt: t.bookedAt,
            amount: BigInt(t.amount),
            description: t.description,
          },
        });
        imported++;
      }
    }
    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: { lastSyncAt: new Date(), lastSyncError: null },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'sync failed';
    await prisma.bankConnection.update({ where: { id: conn.id }, data: { lastSyncError: message.slice(0, 300) } });
    throw e;
  }

  const unclassifiedIn = await prisma.bankTransaction.count({
    where: { orgId, classification: 'unclassified', amount: { gt: 0 } },
  });

  return { accounts: conn.accounts.length, imported, skipped, unclassifiedIn, consentExpiresAt: conn.consentExpiresAt };
}

export const newState = () => randomBytes(16).toString('base64url');
