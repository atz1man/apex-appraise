import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/**
 * Liveness and readiness, which are different questions.
 *
 * There was one endpoint, `/health`, and it answered `{ ok: true }` without
 * touching anything. So it reported healthy when Postgres was unreachable, when
 * the disk was full, and when every tRPC call in the product was returning 500 —
 * which is the exact failure the API entrypoint warns about in its own comment:
 * "a server running against a half-migrated database is worse than a server that
 * is plainly down, because it corrupts quietly while every health check stays
 * green." The health check was doing the staying-green.
 *
 * A monitor that cannot go red is not a monitor, it is a decoration. Worse than
 * none, because it is the thing you check first at 3am and it will tell you the
 * service is fine.
 *
 * Two endpoints now, because a load balancer and a supervisor want opposite
 * things:
 *
 *   /health  LIVENESS  — is this process alive? Cheap, no dependencies, 200
 *                        while it can answer at all. A supervisor watching this
 *                        must not restart the API because the DATABASE blipped:
 *                        restarting fixes nothing and turns an outage into a
 *                        crash loop.
 *   /ready   READINESS — can it actually serve a request? Checks the database.
 *                        503 with the reason when it cannot, so a load balancer
 *                        stops sending traffic and a monitor pages someone.
 *
 * Point uptime monitoring at /ready. /health only ever tells you the process
 * exists, which is true of a great many broken things.
 */

/** A readiness probe must not become the slow query that takes the site down. */
const DB_TIMEOUT_MS = 3_000;

/**
 * The public reason is COARSE, on purpose.
 *
 * nginx serves /ready to anyone, because that is the point of a readiness probe.
 * The first version of this handler put the driver's own message in the body,
 * which on a real outage is not "the database is down" but
 *
 *     Can't reach database server at `db`:`5432`
 *
 * — the internal host and port of the database, handed to whoever asked, at
 * precisely the moment the service is least able to cope with attention. Prisma
 * also names the schema path and the connecting user in other failure modes.
 *
 * main.ts already settled this for every other route: "a 5xx never explains
 * itself to the caller: the detail is in the error table". A 503 from here is a
 * 5xx like any other, and this endpoint had quietly exempted itself. The
 * distinction an operator actually needs — refused versus never answered — costs
 * nothing to keep, so it is kept; the driver's text goes to the log.
 */
type Reason = 'unreachable' | 'timeout';
type Check = { ok: true; ms: number } | { ok: false; ms: number; reason: Reason };

async function checkDatabase(prisma: PrismaClient, log: FastifyBaseLogger): Promise<Check> {
  const started = Date.now();
  const timeout = Symbol('timeout');
  try {
    const raced = await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const),
      new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), DB_TIMEOUT_MS)),
    ]);
    if (raced === timeout) {
      log.error({ ms: Date.now() - started }, 'readiness: database did not answer');
      return { ok: false, ms: Date.now() - started, reason: 'timeout' };
    }
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    // the detail an engineer needs, in the place only an engineer can read
    log.error({ err: e }, 'readiness: database unreachable');
    return { ok: false, ms: Date.now() - started, reason: 'unreachable' };
  }
}

export function registerHealth(app: FastifyInstance, prisma: PrismaClient) {
  const startedAt = Date.now();

  // LIVENESS. No dependencies on purpose — see above.
  app.get('/health', async () => ({ ok: true, service: 'apex-api', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }));

  // READINESS. This one is allowed to say no.
  app.get('/ready', async (req, reply) => {
    const database = await checkDatabase(prisma, req.log);
    const body = {
      ok: database.ok,
      service: 'apex-api',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: { database },
    };
    /**
     * 503 rather than 200-with-a-flag. Every monitor, load balancer and uptime
     * service understands a status code; a great many will never read the body,
     * and one that reports "up" while the body says otherwise is the same lie in
     * a new place.
     */
    return reply.code(database.ok ? 200 : 503).send(body);
  });
}
