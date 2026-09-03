import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { allowedOrigins, batchesSensitive, clientIp, isSensitive, operationsIn, registerSecurity } from '../src/security.js';

/**
 * The edge controls, tested as mechanisms rather than as configuration.
 *
 * The production limits are deliberately not exercised here — a test that logs in
 * ten times to prove the eleventh fails is a slow test of a number. What matters
 * is that the limit APPLIES, that it counts per client IP rather than per proxy,
 * and that sensitive procedures get their own budget.
 */

const build = async (env: Record<string, string>) => {
  Object.assign(process.env, env);
  const app = Fastify({ trustProxy: true });
  await registerSecurity(app);
  app.post('/trpc/auth.login', async () => ({ ok: true }));
  app.post('/trpc/deals.list', async () => ({ ok: true }));
  /**
   * The real app routes every batch through one parameter — main.ts raises
   * maxParamLength to 5000 so a comma-joined path fits — and the guard below
   * runs at `preParsing`, which is AFTER routing. A harness with only static
   * routes would 404 a batched path before any hook saw it, and every test of
   * that guard would pass without exercising it.
   */
  app.post('/trpc/:path', async () => ({ ok: true }));
  await app.ready();
  return app;
};

let app: Awaited<ReturnType<typeof build>> | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const hit = (a: NonNullable<typeof app>, url: string, ip: string) =>
  a.inject({ method: 'POST', url, headers: { 'fly-client-ip': ip } });

describe('rate limiting', () => {
  it('refuses a caller who exceeds the sensitive budget, and says nothing useful', async () => {
    app = await build({ AUTH_RATE_LIMIT_PER_MIN: '3', RATE_LIMIT_PER_MIN: '1000' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await hit(app, '/trpc/auth.login', '1.1.1.1')).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const body = JSON.parse((await hit(app, '/trpc/auth.login', '1.1.1.1')).body);
    // no counts, no reset time, nothing that tells a prober how close they are
    expect(JSON.stringify(body)).not.toMatch(/\d+ *(requests|seconds|ms)/i);
  });

  it('counts per client IP — the whole point of forwarding it', async () => {
    app = await build({ AUTH_RATE_LIMIT_PER_MIN: '2', RATE_LIMIT_PER_MIN: '1000' });
    await hit(app, '/trpc/auth.login', '1.1.1.1');
    await hit(app, '/trpc/auth.login', '1.1.1.1');
    expect((await hit(app, '/trpc/auth.login', '1.1.1.1')).statusCode).toBe(429);
    // a DIFFERENT customer behind the same proxy must be unaffected; if this ever
    // returns 429 the limiter is bucketing everyone together and is worse than none
    expect((await hit(app, '/trpc/auth.login', '2.2.2.2')).statusCode).toBe(200);
  });

  it('keeps ordinary traffic out of the login budget', async () => {
    app = await build({ AUTH_RATE_LIMIT_PER_MIN: '2', RATE_LIMIT_PER_MIN: '1000' });
    for (let i = 0; i < 10; i++) expect((await hit(app, '/trpc/deals.list', '3.3.3.3')).statusCode).toBe(200);
    // and the login budget for that same IP is still intact
    expect((await hit(app, '/trpc/auth.login', '3.3.3.3')).statusCode).toBe(200);
  });

  it('sees through tRPC request batching', () => {
    // a batched path is comma-joined, so a prefix check would miss it
    expect(isSensitive('/trpc/deals.list,auth.login?batch=1')).toBe(true);
    expect(isSensitive('/trpc/deals.list?batch=1')).toBe(false);
  });
});

/**
 * The limiter counts REQUESTS. Batching puts many operations in one.
 *
 * The test above already had batching in view, and asked the right question for
 * the bucket: a comma-joined path still lands in the `auth` budget. The second
 * question went unasked — how many ATTEMPTS one request may carry. Ten per
 * minute was ten BATCHES per minute, each holding as many logins as the path had
 * room for.
 *
 * Measured against a real tRPC instance before the fix:
 *
 *   unbatched:  first 429 after 10 attempts, exactly as designed
 *   batched:    ONE request carrying 60 logins -> all 60 processed, counted once
 *   after that: a further 240 accepted from the same address in the same minute
 *
 * `auth.login,` is eleven characters, so a 5000-character path holds about 454:
 * a control written to allow ten attempts a minute allowing roughly four and a
 * half thousand.
 *
 * The per-email lockout in `auth/password.ts` does not cover this and was never
 * meant to. It stops five guesses against ONE account; what batching opens is
 * the other shape — one password against thousands of DIFFERENT accounts, where
 * no address is tried twice and no lock ever trips. This bucket is the only
 * thing in front of that, which is why it must not be multipliable.
 */
describe('operations inside one request', () => {
  it('reads the name out of an ordinary call', () => {
    expect(operationsIn('/trpc/auth.login')).toEqual(['auth.login']);
  });

  it('reads every name out of a batch', () => {
    expect(operationsIn('/trpc/org.get,billing.config,org.members?batch=1')).toEqual([
      'org.get',
      'billing.config',
      'org.members',
    ]);
  });

  /**
   * `%2C` is a comma. Splitting the raw path and decoding the pieces afterwards
   * sees ONE operation named "auth.login,auth.login" and lets the batch through,
   * which is the guard defeated by an escape sequence.
   */
  it('is not fooled by an encoded comma', () => {
    expect(operationsIn('/trpc/auth.login%2Cauth.login?batch=1')).toEqual(['auth.login', 'auth.login']);
  });

  it('ignores the query string', () => {
    expect(operationsIn('/trpc/auth.login?batch=1&x=2')).toEqual(['auth.login']);
  });
});

describe('a batch carrying a sensitive procedure', () => {
  it('is refused when there is more than one operation', () => {
    expect(batchesSensitive('/trpc/auth.login,auth.login?batch=1')).toBe(true);
    expect(batchesSensitive('/trpc/org.register,org.register?batch=1')).toBe(true);
    // padded with harmless names so the path reads like an ordinary page load
    expect(batchesSensitive('/trpc/deals.list,org.get,auth.login?batch=1')).toBe(true);
  });

  /** A batch of exactly one is how the browser's own link sends a sign-in. */
  it('is allowed alone, batched or not', () => {
    expect(batchesSensitive('/trpc/auth.login')).toBe(false);
    expect(batchesSensitive('/trpc/auth.login?batch=1')).toBe(false);
  });

  it('leaves an ordinary page load alone', () => {
    expect(batchesSensitive('/trpc/org.get,billing.config,org.members,org.policy?batch=1')).toBe(false);
  });

  it('is refused by the running server, not merely by the predicate', async () => {
    app = await build({ AUTH_RATE_LIMIT_PER_MIN: '50', RATE_LIMIT_PER_MIN: '1000' });
    const r = await hit(app, '/trpc/auth.login,auth.login,auth.login?batch=1', '4.4.4.1');
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body) as { message: string };
    expect(body.message).toMatch(/one per request/i);
    // no counts, no thresholds — the same reasoning as the 429 above
    expect(body.message).not.toMatch(/\d/);
  });

  it('does not refuse the sign-in the product actually sends', async () => {
    app = await build({ AUTH_RATE_LIMIT_PER_MIN: '50', RATE_LIMIT_PER_MIN: '1000' });
    expect((await hit(app, '/trpc/auth.login', '4.4.4.2')).statusCode).toBe(200);
    expect((await hit(app, '/trpc/org.get,billing.config?batch=1', '4.4.4.2')).statusCode).toBe(200);
  });

  /**
   * The refusal is charged for.
   *
   * If it were free an attacker could send them without limit and map the rule
   * out for nothing. Getting this right is a matter of WHICH PHASE the check
   * runs in, not which order it was registered: `register` is deferred and
   * `addHook` is immediate, so an onRequest hook added after the limiter still
   * runs before it — measured, with `after()` too. The limiter answers at
   * onRequest and short-circuits, so a check at `preParsing` is reached only on
   * requests it already counted.
   */
  it('spends the sender budget rather than refusing for free', async () => {
    app = await build({ AUTH_RATE_LIMIT_PER_MIN: '2', RATE_LIMIT_PER_MIN: '1000' });
    const batch = '/trpc/auth.login,auth.login?batch=1';
    expect((await hit(app, batch, '4.4.4.3')).statusCode).toBe(400);
    expect((await hit(app, batch, '4.4.4.3')).statusCode).toBe(400);
    expect((await hit(app, batch, '4.4.4.3')).statusCode, 'refused batches cost nothing').toBe(429);
  });
});

describe('client IP resolution', () => {
  const req = (headers: Record<string, string>) => ({ headers, ip: '10.0.0.1' }) as never;

  it('prefers the edge-stamped header over the proxy address', () => {
    expect(clientIp(req({ 'fly-client-ip': '5.5.5.5' }))).toBe('5.5.5.5');
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 10.0.0.9' }))).toBe('6.6.6.6');
    // nothing forwarded: the socket address, which is the proxy — correct only
    // because it is also the last resort
    expect(clientIp(req({}))).toBe('10.0.0.1');
  });
});

describe('CORS allowlist', () => {
  it('allows the configured app origins and nothing else', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://apex-appraise-web.fly.dev';
    const origins = allowedOrigins();
    expect(origins).toContain('https://apex-appraise-web.fly.dev');
    expect(origins).not.toContain('http://localhost:5273');
    expect(origins.some((o) => o.includes('evil'))).toBe(false);
  });

  it('adds local origins only outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(allowedOrigins()).toContain('http://localhost:5273');
  });
});
