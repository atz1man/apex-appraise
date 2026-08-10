import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Xero.
 *
 * The reason this integration matters more than the others: every figure the
 * lender work rests on — drawdown against works, covenant tests, the funding pack
 * — comes from `CostPackage.committed`, which until now a human typed in. A
 * monitoring pack built on hand-keyed numbers is a pack a lender is right to
 * distrust. Bills live in the accounting system, so that is where the number
 * should come from.
 *
 * The part of OAuth that breaks Xero integrations, and the reason this module
 * exists rather than a few inline fetches: REFRESH TOKENS ROTATE. Every refresh
 * returns a NEW refresh token and invalidates the one used. Lose that write — a
 * crash between the HTTP call and the database, or two requests refreshing at
 * once — and the connection is dead permanently, with no error until the next
 * sync. So the new token is persisted before it is used for anything, and a
 * refresh already in flight is shared rather than raced.
 */

const AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const API_BASE = 'https://api.xero.com/api.xro/2.0';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

/** Read-only. Apex reports on the ledger; it has no business writing to it. */
export const XERO_SCOPES = 'offline_access accounting.transactions.read accounting.settings.read';

/** Refresh this far before expiry rather than after, so a slow call cannot straddle it. */
const REFRESH_MARGIN_MS = 60_000;

export const xeroConfigured = () => !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);

export interface XeroTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number;
    json: () => Promise<unknown>;
  }>;
}

const realTransport: XeroTransport = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};

/** The consent URL a user is sent to, plus the state to check when they return. */
export function authorizeUrl(redirectUri: string): { url: string; state: string } {
  const state = randomBytes(16).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });
  return { url: `${AUTH_URL}?${params}`, state };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

async function postToken(body: URLSearchParams, transport: XeroTransport): Promise<TokenResponse> {
  const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');
  const res = await transport(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (res.status !== 200 || !json.access_token) {
    throw new Error(`Xero token exchange failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

export const exchangeCode = (code: string, redirectUri: string, transport: XeroTransport = realTransport) =>
  postToken(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }), transport);

/** Which Xero organisations this authorisation covers. */
export async function listConnections(accessToken: string, transport: XeroTransport = realTransport) {
  const res = await transport(CONNECTIONS_URL, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (res.status !== 200) throw new Error(`Xero connections failed: HTTP ${res.status}`);
  return (await res.json()) as Array<{ tenantId: string; tenantName: string }>;
}

/**
 * In-flight refreshes, keyed by connection.
 *
 * Two requests noticing an expired token at the same moment would both refresh;
 * the second call invalidates the first's brand-new token, and the connection
 * dies. Sharing the promise means one refresh happens and both callers wait for
 * it. (A single process only — with several API instances this wants a database
 * lock, which is a note in the docs rather than pretend safety here.)
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * A valid access token for this workspace, refreshing if needed.
 *
 * The refreshed pair is WRITTEN BEFORE IT IS RETURNED. If the process died
 * between the HTTP call and the write, the token we hold would already be dead at
 * Xero and the customer would have to reconnect by hand.
 */
export async function accessTokenFor(
  prisma: PrismaClient,
  orgId: string,
  transport: XeroTransport = realTransport,
): Promise<string> {
  const conn = await prisma.xeroConnection.findUnique({ where: { orgId } });
  if (!conn) throw new Error('This workspace is not connected to Xero');

  if (conn.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) return conn.accessToken;

  const existing = inFlight.get(conn.id);
  if (existing) return existing;

  const promise = (async () => {
    const fresh = await postToken(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }),
      transport,
    );
    await prisma.xeroConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: fresh.access_token,
        // the rotated token, saved before anything else happens
        refreshToken: fresh.refresh_token,
        expiresAt: new Date(Date.now() + fresh.expires_in * 1000),
        lastSyncError: null,
      },
    });
    return fresh.access_token;
  })();

  inFlight.set(conn.id, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(conn.id);
  }
}

export interface XeroBill {
  InvoiceID: string;
  Type: string;
  Status: string;
  Total: number;
  AmountPaid?: number;
  LineItems?: Array<{
    LineAmount?: number;
    Tracking?: Array<{ TrackingCategoryID: string; TrackingOptionID: string; Name: string; Option: string }>;
  }>;
}

/**
 * Bills owed to suppliers — ACCPAY invoices, excluding drafts and anything
 * voided or deleted. A draft bill is somebody's intention, not a commitment, and
 * reporting it as drawn would overstate every position that carried one.
 */
export async function fetchBills(
  accessToken: string,
  tenantId: string,
  transport: XeroTransport = realTransport,
): Promise<XeroBill[]> {
  const where = encodeURIComponent('Type=="ACCPAY" AND Status!="DRAFT" AND Status!="VOIDED" AND Status!="DELETED"');
  const res = await transport(`${API_BASE}/Invoices?where=${where}&page=1`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, accept: 'application/json' },
  });
  if (res.status !== 200) throw new Error(`Xero invoices failed: HTTP ${res.status}`);
  const body = (await res.json()) as { Invoices?: XeroBill[] };
  return body.Invoices ?? [];
}

export interface DealSpend {
  trackingOptionId: string;
  trackingOptionName: string;
  /** committed: the bill exists and is owed or paid */
  committed: number;
  /** paid: money actually out of the door */
  paid: number;
  bills: number;
}

/**
 * Attribute bills to deals through their tracking options.
 *
 * Attribution is per LINE, not per bill: a single invoice from a main contractor
 * routinely covers several phases or sites, and counting its total against
 * whichever option appeared first would quietly move money between schemes.
 *
 * A line with no tracking is not guessed at. It is left out and counted, so the
 * sync can say how much it could not attribute rather than silently under-report.
 */
export function attributeSpend(
  bills: XeroBill[],
  categoryId: string,
): { byOption: Map<string, DealSpend>; untrackedTotal: number; untrackedLines: number } {
  const byOption = new Map<string, DealSpend>();
  let untrackedTotal = 0;
  let untrackedLines = 0;

  for (const bill of bills) {
    const total = bill.Total ?? 0;
    const paidShare = total > 0 ? (bill.AmountPaid ?? 0) / total : 0;

    for (const line of bill.LineItems ?? []) {
      const amount = line.LineAmount ?? 0;
      const tracking = (line.Tracking ?? []).find((t) => t.TrackingCategoryID === categoryId);
      if (!tracking) {
        untrackedTotal += amount;
        untrackedLines += 1;
        continue;
      }
      const cur = byOption.get(tracking.TrackingOptionID) ?? {
        trackingOptionId: tracking.TrackingOptionID,
        trackingOptionName: tracking.Option,
        committed: 0,
        paid: 0,
        bills: 0,
      };
      cur.committed += amount;
      // Xero reports payment against the whole invoice, so a part-paid bill is
      // apportioned across its lines rather than credited to whichever came first
      cur.paid += amount * paidShare;
      cur.bills += 1;
      byOption.set(tracking.TrackingOptionID, cur);
    }
  }

  return { byOption, untrackedTotal, untrackedLines };
}

export interface SyncResult {
  deals: number;
  packages: number;
  committed: number;
  paid: number;
  /** spend Xero holds that no tracking option claimed */
  untrackedTotal: number;
  untrackedLines: number;
  /** options with spend that nobody has mapped to a deal yet */
  unmapped: Array<{ trackingOptionId: string; trackingOptionName: string; committed: number }>;
}

/**
 * Pull the ledger into cost monitoring.
 *
 * Xero-sourced spend lands in its own package per deal, marked `source: 'xero'`.
 * It never touches a manual package: a quantity surveyor's budget, progress and
 * retention are their professional judgement, and an integration that overwrote
 * them would be the last one they ever enabled. The budget on a Xero package is
 * set once by a human and preserved on every sync — the ledger knows what has
 * been spent, not what was allowed.
 */
export async function syncXero(
  prisma: PrismaClient,
  orgId: string,
  transport: XeroTransport = realTransport,
): Promise<SyncResult> {
  const conn = await prisma.xeroConnection.findUnique({ where: { orgId } });
  if (!conn) throw new Error('This workspace is not connected to Xero');
  if (!conn.trackingCategoryId) {
    throw new Error('Choose which Xero tracking category identifies the scheme before syncing');
  }

  const token = await accessTokenFor(prisma, orgId, transport);
  const bills = await fetchBills(token, conn.tenantId, transport);
  const { byOption, untrackedTotal, untrackedLines } = attributeSpend(bills, conn.trackingCategoryId);

  const maps = await prisma.xeroDealMap.findMany({ where: { orgId } });
  const dealFor = new Map(maps.map((m) => [m.trackingOptionId, m.dealId]));

  let packages = 0;
  let committed = 0;
  let paid = 0;
  const unmapped: SyncResult['unmapped'] = [];
  const touched = new Set<string>();

  for (const [optionId, spend] of byOption) {
    const dealId = dealFor.get(optionId);
    if (!dealId) {
      // reported, not guessed at: money in the ledger that nobody has told us
      // where to put is a question for a human, not a default
      unmapped.push({ trackingOptionId: optionId, trackingOptionName: spend.trackingOptionName, committed: spend.committed });
      continue;
    }
    // the deal must still belong to this workspace — a map row outliving its deal
    // must not become a way to write into someone else's
    const deal = await prisma.deal.findFirst({ where: { id: dealId, orgId } });
    if (!deal) continue;

    const name = `Xero — ${spend.trackingOptionName}`;
    const existing = await prisma.costPackage.findFirst({ where: { orgId, dealId, name, source: 'xero' } });
    const data = {
      committed: BigInt(Math.round(spend.committed * 100)),
      spent: BigInt(Math.round(spend.paid * 100)),
    };
    if (existing) {
      // budget, progress and retention are left exactly as they were
      await prisma.costPackage.update({ where: { id: existing.id }, data });
    } else {
      await prisma.costPackage.create({
        data: {
          orgId,
          dealId,
          name,
          source: 'xero',
          budget: BigInt(0),
          forecast: data.committed,
          retentionPct: 0,
          ...data,
        },
      });
    }
    packages += 1;
    committed += spend.committed;
    paid += spend.paid;
    touched.add(dealId);
  }

  await prisma.xeroConnection.update({
    where: { id: conn.id },
    data: { lastSyncAt: new Date(), lastSyncError: null },
  });

  return {
    deals: touched.size,
    packages,
    committed: Math.round(committed * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    untrackedTotal: Math.round(untrackedTotal * 100) / 100,
    untrackedLines,
    unmapped,
  };
}

/** Tracking categories and their options, so an admin picks rather than types. */
export async function fetchTrackingCategories(
  accessToken: string,
  tenantId: string,
  transport: XeroTransport = realTransport,
): Promise<Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }>> {
  const res = await transport(`${API_BASE}/TrackingCategories`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, accept: 'application/json' },
  });
  if (res.status !== 200) throw new Error(`Xero tracking categories failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    TrackingCategories?: Array<{
      TrackingCategoryID: string;
      Name: string;
      Status?: string;
      Options?: Array<{ TrackingOptionID: string; Name: string; Status?: string }>;
    }>;
  };
  return (body.TrackingCategories ?? [])
    // an archived category still exists in Xero and would look selectable
    .filter((c) => (c.Status ?? 'ACTIVE') === 'ACTIVE')
    .map((c) => ({
      id: c.TrackingCategoryID,
      name: c.Name,
      options: (c.Options ?? [])
        .filter((o) => (o.Status ?? 'ACTIVE') === 'ACTIVE')
        .map((o) => ({ id: o.TrackingOptionID, name: o.Name })),
    }));
}
