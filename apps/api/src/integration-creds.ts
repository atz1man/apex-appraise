import type { PrismaClient } from '@prisma/client';

/**
 * Self-serve integration credentials. Keys live in IntegrationConnection.config
 * (JSON, server-side only — the list endpoint never returns it). Connectors fall
 * back to env vars so a platform-wide key still works without per-org setup.
 */

/** Providers a workspace can connect with its own free API key. */
export const SELF_SERVE_PROVIDERS = {
  'EPC Register': {
    fields: [{ key: 'key', label: 'Bearer token' }],
    signupUrl: 'https://get-energy-performance-data.communities.gov.uk',
  },
  'Companies House': {
    fields: [{ key: 'key', label: 'API key' }],
    signupUrl: 'https://developer.company-information.service.gov.uk',
  },
} as const;

export type SelfServeProvider = keyof typeof SELF_SERVE_PROVIDERS;

export async function getIntegrationCreds(
  prisma: PrismaClient,
  orgId: string,
  provider: SelfServeProvider,
): Promise<Record<string, string> | null> {
  const conn = await prisma.integrationConnection.findFirst({ where: { orgId, provider } });
  if (!conn?.config) return null;
  try {
    const c = JSON.parse(conn.config) as unknown;
    return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, string>) : null;
  } catch {
    return null;
  }
}
