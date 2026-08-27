import { PrismaClient } from '@prisma/client';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import jwt from 'jsonwebtoken';

export const prisma = new PrismaClient();

export const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return secret ?? 'apex-dev-secret-change-in-prod';
})();

export interface Principal {
  userId: string;
  orgId: string;
  principalType: 'internal' | 'buyer' | 'investor';
  role: string;
  name: string;
  initials: string;
  investorId: string | null;
  buyerUnitId: string | null;
}

/**
 * Was this token issued before the account's sessions were cut off?
 *
 * A sign-in token carries nothing but a subject and an expiry, and it is good
 * for twelve hours on its signature alone. So changing a password used to do
 * nothing at all to the sessions already out there: someone whose laptop was
 * taken, or whose password was phished, did the one thing they are told to do
 * and the attacker stayed signed in for the rest of the day.
 *
 * `iat` is whole seconds, and `sessionsValidFrom` is not, so the comparison is
 * made in seconds. Rounding the cutoff DOWN means a token minted in the same
 * second as the change survives — which is the direction that matters, because
 * the replacement token issued by changePassword is exactly that token, and
 * signing the user out of the browser they just used would train them to expect
 * it and ignore it.
 *
 * A token with no `iat` cannot be placed relative to the cutoff, so it is
 * refused. Nothing this application signs omits it.
 */
export const issuedBefore = (iat: number | undefined, cutoff: Date) =>
  iat === undefined || iat < Math.floor(cutoff.getTime() / 1000);

/**
 * Resolve an Authorization header to a principal, or to nothing.
 *
 * Takes its client rather than closing over the module one so the guards here
 * can be tested against a throwaway database — the alternative is a test that
 * proves the JWT library works and nothing about this function.
 */
export async function principalFromAuthHeader(
  db: Pick<PrismaClient, 'user'>,
  auth: string | undefined,
): Promise<Principal | null> {
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as {
      sub: string;
      iat?: number;
      aud?: string | string[];
    };
    /**
     * A token minted for a named purpose is not a way to sign in.
     *
     * `download-token.ts` is careful in one direction: it refuses a session
     * token, so a twelve-hour credential cannot be spent as a download link.
     * Nothing checked the other direction, and the other direction is worse.
     * Download tokens are signed with this same secret and carry a `sub`, so
     * this function verified them, loaded the user and returned a full internal
     * principal — for the whole account, every procedure, every deal.
     *
     * Those tokens live in URLs, which is the entire reason they were invented:
     * browser history, the proxy log, the nginx log, the link someone pastes to
     * a colleague. Worst is the tile token, which is supposed to say only "someone
     * signed in is looking at a map" and rides in the `<img>` URL of every tile
     * Leaflet loads — a screenful per view, half an hour of validity, written to
     * the access log dozens of times per pan.
     *
     * The check is "carries any audience", not "carries the download audience",
     * so it stays closed for a token kind nobody has invented yet: a new purpose
     * gets a new audience and is refused here without anyone remembering to come
     * back. Sign-in tokens are the ones signed for no particular audience — see
     * the four `jwt.sign` sites in `auth.ts` and `org.ts` — so nothing that is
     * already signed in is disturbed.
     */
    if (payload.aud !== undefined) return null;
    const user = await db.user.findUnique({ where: { id: payload.sub } });
    // no row: the account is gone, and the token with it. This is what makes
    // removing a team member take effect on their very next request.
    if (!user || issuedBefore(payload.iat, user.sessionsValidFrom)) return null;
    return {
      userId: user.id,
      orgId: user.orgId,
      principalType: user.principalType as Principal['principalType'],
      role: user.role,
      name: user.name,
      initials: user.initials,
      investorId: user.investorId,
      buyerUnitId: user.buyerUnitId,
    };
  } catch {
    return null;
  }
}

export async function createContext({ req }: CreateFastifyContextOptions) {
  const principal = await principalFromAuthHeader(prisma, req.headers.authorization);
  // request metadata, kept for signature evidence on public signing routes
  return { prisma, principal, ip: req.ip, userAgent: (req.headers['user-agent'] as string | undefined) ?? null };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
