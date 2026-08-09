import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { allowedOrigins, clientIp, isSensitive, registerSecurity } from '../src/security.js';

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
