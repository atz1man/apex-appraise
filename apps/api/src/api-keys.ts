import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Credentials for the public API.
 *
 * A key belongs to an organisation, not a person. That is the whole point of
 * having one: a customer's integration keeps working after the colleague who
 * created it leaves, and it is revoked as a thing in its own right rather than by
 * disabling somebody's account.
 *
 * Everything here follows the discipline already used for reset tokens and share
 * links — the raw secret exists for exactly one response and is stored only as a
 * hash. A database leak is then a list of hashes, not a set of working keys.
 */

const PREFIX = 'apex_live_';
/** enough that guessing is not a strategy, short enough to paste */
const SECRET_BYTES = 24;

export type ApiScope = 'read' | 'write';

export interface MintedKey {
  /** shown once, at creation, and never obtainable again */
  key: string;
  prefix: string;
  keyHash: string;
}

export function mintApiKey(): MintedKey {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const key = `${PREFIX}${secret}`;
  return { key, prefix: key.slice(0, PREFIX.length + 6), keyHash: hashApiKey(key) };
}

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Constant-time compare, so a wrong key cannot be narrowed by timing it. */
export function keyMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash);
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ApiPrincipal {
  orgId: string;
  keyId: string;
  scopes: ApiScope[];
}

/**
 * Resolve a bearer credential to an organisation, or null.
 *
 * Deliberately narrow: it accepts ONLY strings carrying the API-key prefix. A
 * session JWT presented here is rejected outright rather than falling through to
 * the JWT verifier — the two credentials authorise different surfaces, and a
 * server that quietly accepts either has one surface, not two. (The same mistake
 * in reverse would let an API key drive the internal app.)
 */
export async function principalFromApiKey(
  prisma: PrismaClient,
  header: string | undefined,
): Promise<ApiPrincipal | null> {
  if (!header?.startsWith('Bearer ')) return null;
  const presented = header.slice(7).trim();
  if (!presented.startsWith(PREFIX)) return null;

  const row = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(presented) } });
  if (!row || row.revokedAt) return null;
  if (!keyMatches(hashApiKey(presented), row.keyHash)) return null;

  // last-used is best effort: a failure to record it must not fail the request
  void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return {
    orgId: row.orgId,
    keyId: row.id,
    scopes: row.scopes.split(',').map((s) => s.trim()) as ApiScope[],
  };
}

export const hasScope = (principal: ApiPrincipal, scope: ApiScope) => principal.scopes.includes(scope);
