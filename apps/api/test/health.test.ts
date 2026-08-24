import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerHealth } from '../src/health.js';

/**
 * The old `/health` answered `{ ok: true }` without touching anything, so it
 * reported healthy while Postgres was unreachable and every request in the
 * product was failing. A monitor that cannot go red is worse than no monitor:
 * it is the thing you check first at 3am, and it lies.
 */

/** Stands in for PrismaClient — only $queryRaw is exercised. */
const db = (impl: () => Promise<unknown>) => ({ $queryRaw: impl }) as never;

const up = () => db(async () => [{ '?column?': 1 }]);
const down = () => db(async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); });
const hung = () => db(() => new Promise(() => {}));

async function app(prisma: ReturnType<typeof db>) {
  const a = Fastify();
  registerHealth(a, prisma);
  return a;
}

describe('liveness', () => {
  it('answers while the process is alive, whatever the database is doing', async () => {
    for (const prisma of [up(), down()]) {
      const res = await (await app(prisma)).inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    }
  });

  /**
   * Deliberate: a supervisor watching liveness must not restart the API because
   * the DATABASE went away. Restarting fixes nothing and turns an outage into a
   * crash loop. That is why the database check lives on /ready instead.
   */
  it('does not touch the database', async () => {
    let asked = false;
    const prisma = db(async () => { asked = true; return []; });
    await (await app(prisma)).inject({ method: 'GET', url: '/health' });
    expect(asked, 'liveness queried the database').toBe(false);
  });
});

describe('readiness', () => {
  it('is ready when the database answers', async () => {
    const res = await (await app(up())).inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, checks: { database: { ok: true } } });
  });

  /** The whole point. This is the case the old endpoint got wrong. */
  it('goes RED when the database is unreachable, with a status code and a reason', async () => {
    const res = await (await app(down())).inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode, 'a monitor reading only the status code would have seen "up"').toBe(503);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.database).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  /**
   * nginx serves /ready to anyone, so the body is public. An earlier version of
   * this handler returned the driver's own message, which on a real outage reads
   * "Can't reach database server at `db`:`5432`" — the internal host and port,
   * handed to whoever asked. main.ts already had the rule for every other route:
   * a 5xx never explains itself to the caller.
   */
  it('never hands an anonymous caller the database host, port or credentials', async () => {
    const leaky = db(async () => {
      throw new Error("Can't reach database server at `db-primary.internal`:`5432` (user `pgadmin_svc`, password `hunter2`)");
    });
    const res = await (await app(leaky)).inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    for (const secret of ['db-primary.internal', '5432', 'pgadmin_svc', 'hunter2', 'reach database server']) {
      expect(res.body, `the readiness body leaked "${secret}"`).not.toContain(secret);
    }
    // and it still says enough to act on
    expect(res.json().checks.database.reason).toBe('unreachable');
  });

  /**
   * A database that never answers is the nastier outage: it does not throw, so
   * an unbounded probe hangs, the monitor times out with no reason, and the
   * readiness endpoint becomes the slow query it was meant to detect.
   */
  it('gives up on a database that hangs rather than hanging with it', async () => {
    const started = Date.now();
    const res = await (await app(hung())).inject({ method: 'GET', url: '/ready' });
    const took = Date.now() - started;
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database.reason).toBe('timeout');
    expect(took, 'the probe hung with the database').toBeLessThan(6_000);
  });
});
