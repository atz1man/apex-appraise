import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * "Unset" and "empty" are not the same thing, and compose turns one into the
 * other.
 *
 * `SOME_KEY: ${SOME_KEY:-}` gives the container an EMPTY STRING when the
 * operator has not set the variable — not an absent one. `??` only catches
 * absent. So every `process.env.X ?? 'a sensible default'` paired with an
 * empty-default in compose was a fallback that could never fire in the one
 * environment it was written for.
 *
 * It had bitten twice. EMAIL_FROM meant a firm with SMTP configured and no From
 * address sent every invite with an empty From header. TILE_* was worse in a
 * different way — those were not passed to the container at all, so the runbook
 * told an operator to choose a tile provider and the choice did nothing.
 */
describe('an unset variable reaches the code as one', () => {
  const emptyDefaulted = [...compose.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*\$\{\1:-\}\s*$/gm)].map((m) => m[1]!);

  const sources = () => {
    const dir = new URL('../src/', import.meta.url);
    const walk = (u: URL): string[] =>
      readdirSync(u, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(new URL(`${e.name}/`, u))
          : e.name.endsWith('.ts')
            ? [readFileSync(new URL(e.name, u), 'utf8')]
            : [],
      );
    return walk(dir).join('\n');
  };

  it('found the empty-defaulted variables to check', () => {
    // a regex matching nothing would make the assertion below vacuous
    expect(emptyDefaulted.length).toBeGreaterThan(3);
    expect(emptyDefaulted).toContain('EMAIL_FROM');
  });

  it.each([['??']])('never falls back with %s on one of them', () => {
    const src = sources();
    const offenders = emptyDefaulted.filter((key) =>
      // `process.env.KEY ?? <something that is not empty>`
      new RegExp(`process\\.env\\.${key}\\s*\\?\\?\\s*(?!['"\`]{2})`).test(src),
    );
    expect(
      offenders,
      `these use ?? against a compose empty-default, so the fallback can never fire: ${offenders.join(', ')}. Use || instead.`,
    ).toEqual([]);
  });

  it('passes the tile settings to the container the runbook tells you to set', () => {
    // the runbook says this choice has to be made before selling the product;
    // it was documented and never wired up
    for (const key of ['TILE_URL', 'TILE_ATTRIBUTION', 'TILE_USER_AGENT']) {
      expect(emptyDefaulted, `${key} is documented in infra/DEPLOY.md but not passed to the API`).toContain(key);
    }
  });
});
