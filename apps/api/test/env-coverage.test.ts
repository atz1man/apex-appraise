import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every variable this server reads can actually be supplied by the stacks that
 * run it.
 *
 * `deployment.test.ts` next door reads the same compose file and was written
 * after it "had drifted into being a test fixture". It asks whether the keys it
 * names carry honest VALUES. It never asks the other direction — whether a key
 * the CODE reads is in the file at all — and its own `envValue` helper only
 * demands a key exist when some test thinks to ask about that key.
 *
 * That gap had eight instances, measured by reading every `process.env.*` in
 * `apps/api/src` against both deployment files:
 *
 *   COMPANIES_HOUSE_KEY   XERO_CLIENT_ID        XERO_CLIENT_SECRET
 *   TRUELAYER_CLIENT_ID   TRUELAYER_CLIENT_SECRET
 *   TRUELAYER_AUTH_BASE   TRUELAYER_API_BASE    RESET_TOKEN
 *
 * None reached either stack. The effect is not a missing nicety: `xero.ts` and
 * `open-banking.ts` read ONLY the environment — unlike EPC and Companies House
 * there is no per-org credential path — so `xero.status` and `bank.status`
 * answered "not configured on this server" on every deployment, however
 * carefully an operator had followed the runbook, and the Integrations screen
 * offered two connections that could not be made to work by any means. The
 * runbook told them to set the variables. Nothing carried them to the process.
 *
 * This is the same defect `docker-compose.yml` already records for the TILE_*
 * trio, in a comment saying setting them "did nothing at all" — found by hand,
 * fixed by hand, and left free to happen again eight more times. It is also the
 * same shape as `proxy-coverage.test.ts`, which exists because a route and its
 * proxy entry are two files nobody diffs against each other.
 *
 * WHAT "ACCOUNTED FOR" MEANS, and why it is not simply "settable": for compose
 * the variable must be a key in the api service's `environment:` block, because
 * that block is the whole of what reaches the container. For Fly it need only
 * appear in `fly.api.toml` — secrets are set with `flyctl secrets set` and
 * deliberately do not live in the file, so what the file can carry is the
 * DOCUMENTATION of them, and a variable recorded there as deliberately absent
 * (DEMO_MODE, whose absence is what makes production refuse to fabricate)
 * counts as accounted for too. The defect being guarded is a variable nobody
 * considered, not one somebody decided against — so the rule asks for a
 * decision to be written down, and cannot tell a good decision from a bad one.
 */

const ROOT = new URL('../../../', import.meta.url).pathname;
const SRC = join(ROOT, 'apps/api/src');
const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
const fly = readFileSync(join(ROOT, 'infra/fly.api.toml'), 'utf8');
const dockerfile = readFileSync(join(ROOT, 'infra/api.Dockerfile'), 'utf8');

/**
 * Supplied by the IMAGE rather than by either deployment file, so neither is
 * wrong to omit it. Verified rather than trusted: if the Dockerfile stops
 * setting it, the exemption stops holding and the case below fails.
 */
const SET_BY_THE_IMAGE = ['CHROMIUM_PATH'] as const;

/** Every `process.env.NAME` the server's own source asks for. */
export function variablesRead(dir = SRC): string[] {
  const found = new Set<string>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) {
        const src = readFileSync(path, 'utf8');
        for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) found.add(m[1]!);
      }
    }
  };
  walk(dir);
  return [...found].sort();
}

/** The keys of the api service's `environment:` block — what reaches the container. */
export function composeEnvKeys(yaml = compose): string[] {
  // the api service runs from `  api:` to the next service at the same indent
  const start = yaml.indexOf('\n  api:\n');
  expect(start, 'docker-compose.yml declares no api service').toBeGreaterThan(-1);
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/^ {2}\w[\w-]*:$/m);
  const service = next === -1 ? rest : rest.slice(0, next + 1);
  const env = service.indexOf('environment:');
  expect(env, 'the api service sets no environment block').toBeGreaterThan(-1);
  const block = service.slice(env);
  // a key is `      NAME: value` — six spaces, which is one level inside `environment:`
  return [...block.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
}

describe('every variable the API reads can be supplied by the stacks that run it', () => {
  const read = variablesRead();

  it('reaches the container in the self-hosted stack', () => {
    const keys = new Set(composeEnvKeys());
    const missing = read.filter((v) => !keys.has(v) && !SET_BY_THE_IMAGE.includes(v as never));
    expect(
      missing,
      `apps/api/src reads these and docker-compose.yml passes none of them to the api service, ` +
        `so setting them does nothing at all:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('is accounted for on the live deployment', () => {
    const missing = read.filter(
      (v) => !new RegExp(`\\b${v}\\b`).test(fly) && !SET_BY_THE_IMAGE.includes(v as never),
    );
    expect(
      missing,
      `apps/api/src reads these and infra/fly.api.toml neither sets them nor documents them as ` +
        `secrets to set, so nobody deploying has been told they exist:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  /** The exemption, checked. An image that stops setting it is a real gap. */
  it.each(SET_BY_THE_IMAGE)('%s is exempt only because the image sets it', (name) => {
    expect(dockerfile, `${name} is exempt from both stacks but the image does not set it`).toMatch(
      new RegExp(`^ENV ${name}=`, 'm'),
    );
  });

  /**
   * A sweep over an empty list passes in silence. This says it read the real
   * tree, and that the rule reports a variable no deployment can supply.
   */
  it('finds what it is meant to be sweeping', () => {
    expect(read.length).toBeGreaterThan(20);
    expect(read).toContain('JWT_SECRET');
    expect(read).toContain('XERO_CLIENT_ID');

    const planted = 'A_VARIABLE_NO_DEPLOYMENT_SUPPLIES';
    expect(new RegExp(`\\b${planted}\\b`).test(fly)).toBe(false);
    expect(new Set(composeEnvKeys()).has(planted)).toBe(false);
  });

  /** And that the compose reader is reading the api service, not the database's. */
  it('reads the api service’s own environment, not another service’s', () => {
    const keys = composeEnvKeys();
    expect(keys).toContain('JWT_SECRET');
    expect(keys, 'POSTGRES_DB belongs to the db service').not.toContain('POSTGRES_DB');
  });
});
