import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the file people deploy actually says.
 *
 * docker-compose.yml is not code, so nothing typechecked it and no test read
 * it — and it had drifted into being a test fixture. It pinned
 * AUTH_RATE_LIMIT_PER_MIN to 1000 against a code default of 10, with a comment
 * explaining that the browser suite would otherwise trip the honest limit. The
 * suite got its way and every deployment built from this file shipped with
 * brute-force protection a hundred times looser than the application intends.
 *
 * These are string assertions on a YAML file, which is a blunt instrument. The
 * alternative was no assertion at all: there is no YAML parser in this
 * workspace, and the values here are interpolation expressions that a parser
 * would hand back verbatim anyway.
 */

const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');

/** The value of an `environment:` key, as written. */
const envValue = (key: string) => {
  const m = compose.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
  expect(m, `${key} is not set in docker-compose.yml at all`).toBeTruthy();
  return m![1]!.trim();
};

describe('the deployed stack is not loosened to suit the tests', () => {
  /**
   * The numbers themselves live in apps/api/src/security.ts. What matters here
   * is that compose does not overrule them with something laxer — a default is
   * fine, a hardcoded 1000 is not.
   */
  it.each([
    ['AUTH_RATE_LIMIT_PER_MIN', 10],
    ['RATE_LIMIT_PER_MIN', 600],
  ])('%s defaults to the limiter’s own number, and is only overridable', (key, expected) => {
    const value = envValue(key);
    expect(
      value,
      `${key} is pinned in the deployed file. Set it in the test job's environment instead.`,
    ).toBe(`\${${key}:-${expected}}`);
  });

  it('demands a database password rather than shipping one', () => {
    // ":?" — compose refuses to start without it, exactly as it does for the
    // signing key. The literal it replaced was "apex".
    expect(envValue('POSTGRES_PASSWORD')).toMatch(/^\$\{POSTGRES_PASSWORD:\?/);
    expect(compose, 'a password is still written into the connection string').not.toMatch(
      /postgresql:\/\/apex:apex@/,
    );
  });

  it('demands a signing key', () => {
    expect(envValue('JWT_SECRET')).toMatch(/^\$\{JWT_SECRET:\?/);
  });

  it('does not seed demo accounts unless asked', () => {
    // an empty default: a real deployment boots with no accounts it did not create
    expect(envValue('SEED_DEMO')).toBe('${SEED_DEMO:-}');
  });
});

describe('what is reachable from outside the host', () => {
  const published = [...compose.matchAll(/^\s*- '([^']*:)?(\d+):(\d+)'$/gm)].map((m) => ({
    host: m[1] ?? '',
    published: m[2]!,
  }));

  it('publishes the front door, and only the front door', () => {
    const open = published.filter((p) => p.host === '');
    expect(
      open.map((p) => p.published),
      'a port other than nginx is exposed to whoever can route to the host',
    ).toEqual(['8080']);
  });

  it.each([
    ['4100', 'the API — nginx is where the security headers and download routes are enforced'],
    ['55432', 'Postgres — published for the shadow-database tooling in docs/DATABASE.md'],
  ])('binds %s to the loopback address (%s)', (port) => {
    const entry = published.find((p) => p.published === port);
    expect(entry, `port ${port} is not published at all — this test is out of date`).toBeTruthy();
    expect(entry!.host).toBe('127.0.0.1:');
  });
});

describe('the stack comes back on its own', () => {
  it('restarts every service', () => {
    // three services; a container that dies otherwise stays dead until someone
    // notices, which on a Sunday is a long time
    expect(compose.match(/^\s*restart: unless-stopped$/gm) ?? []).toHaveLength(3);
  });

  it('waits for the API to be READY before opening the front door', () => {
    /**
     * nginx resolves `api` once at startup and caches it. Starting the proxy
     * before the thing behind it means the first visitors get a 502 from a
     * proxy that has stopped looking. And the API's own check is /ready, not
     * /health: liveness answers "the process is up", which a container that
     * cannot reach its database also answers.
     */
    expect(compose).toMatch(/healthcheck:[\s\S]*?\/ready/);
    expect(compose.match(/condition: service_healthy/g) ?? []).toHaveLength(2);
  });
});
