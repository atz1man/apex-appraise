import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { prisma, principalFromAuthHeader, type Principal } from './context.js';
import { assertTrialLive } from './trial.js';

/**
 * The rules tRPC applies, for the routes that are not tRPC.
 *
 * trpc.ts builds them as middleware — authedProcedure, then internalProcedure
 * (which rejects portal logins and stops a lapsed trial writing), then
 * adminProcedure — and says why they live in one place: "a rule repeated in
 * forty places is forty chances to forget it, and the one that gets forgotten is
 * always the one that mattered."
 *
 * The upload routes are plain Fastify. They cannot use that chain, and they have
 * now fallen out of it twice, for two different rules and the same reason. The
 * session cutoff landed in context.ts and this surface kept verifying tokens
 * itself, so a phished password shut the attacker out of the application and
 * left them the data room. The trial rule landed in internalProcedure, and a
 * workspace that stopped paying in March went on filling that same data room.
 *
 * Neither was subtle. Both were invisible, because there was nowhere the two
 * chains could be compared. This is that place: when a rule is added to
 * internalProcedure, it belongs here too, and the comment there says so.
 */

/** What a refused request should be answered with. */
export class GuardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A signed-in member of the firm, on a workspace that may still be written to.
 *
 * The equivalent of `internalProcedure` on a mutation:
 *   - a valid session token, honouring User.sessionsValidFrom
 *   - an internal principal, never an investor or buyer portal login
 *   - a trial that has not lapsed
 *
 * `what` names the action for the trial check, in the same `namespace.action`
 * shape tRPC paths use, so allowedWhileExpired() reads the two alike.
 */
export async function internalWriter(
  req: Pick<FastifyRequest, 'headers'>,
  what: string,
  db: PrismaClient = prisma,
): Promise<Principal> {
  const principal = await principalFromAuthHeader(db, req.headers.authorization);
  if (!principal) throw new GuardError(401, 'unauthorised');
  if (principal.principalType !== 'internal') throw new GuardError(403, 'internal access required');
  // throws a TRPCError with the message a customer should read
  await assertTrialLive(db, principal.orgId, what);
  return principal;
}

/**
 * Run a guard and answer the request if it refuses. Returns null when it did,
 * so the handler's first line reads `if (!user) return;`.
 */
export async function guard<T>(reply: FastifyReply, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    const status = e instanceof GuardError ? e.status : 403;
    reply.code(status).send({ error: e instanceof Error ? e.message : 'forbidden' });
    return null;
  }
}
