import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { appRouter } from '../src/router.js';
import type { Principal } from '../src/context.js';

/**
 * API test harness — a throwaway SQLite database and a tRPC caller per principal.
 *
 * Calls go through `appRouter.createCaller`, so every procedure runs its real
 * guards, its real zod parsing and its real Prisma queries. Only the transport is
 * skipped. Testing the handlers directly instead would prove nothing about the
 * thing that actually protects data — the procedure middleware.
 *
 * SQLite, not Postgres: tenancy is a question of `where` clauses, not of SQL
 * dialect, and a test suite that needs a database server is a test suite people
 * stop running.
 */

const DB_FILE = new URL('../test.db', import.meta.url).pathname;
const DB_URL = `file:${DB_FILE}`;

export function resetDatabase() {
  for (const suffix of ['', '-journal']) {
    const f = `${DB_FILE}${suffix}`;
    if (existsSync(f)) rmSync(f);
  }
  /**
   * schema.prisma hardcodes `url = "file:./dev.db"`, so `prisma db push` ignores
   * DATABASE_URL and would reshape the DEV database instead of the throwaway one.
   * Push a copy whose datasource reads the environment — the same rewrite CI and
   * the Docker image do, for the same reason.
   */
  const apiDir = new URL('..', import.meta.url).pathname;
  const testSchema = `${apiDir}/test/.schema.test.prisma`;
  writeFileSync(
    testSchema,
    readFileSync(`${apiDir}/prisma/schema.prisma`, 'utf8').replace('url      = "file:./dev.db"', 'url      = env("DATABASE_URL")'),
  );
  execSync(`npx prisma db push --skip-generate --accept-data-loss --schema ${testSchema}`, {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'pipe',
  });
}

export const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

export function callerFor(principal: Principal) {
  return appRouter.createCaller({ prisma, principal, ip: '127.0.0.1', userAgent: 'test' });
}

export const anonymous = () =>
  appRouter.createCaller({ prisma, principal: null, ip: '127.0.0.1', userAgent: 'test' });

/**
 * Two organisations with the same shape of data. Every isolation test is the same
 * question asked of a different procedure: holding org A's principal, can I reach
 * the row that belongs to org B?
 */
export interface Tenant {
  orgId: string;
  userId: string;
  dealId: string;
  principal: Principal;
  investorPrincipal: Principal;
}

let seq = 0;

export async function makeTenant(label: string): Promise<Tenant> {
  const n = ++seq;
  const org = await prisma.organisation.create({
    data: { name: `${label} Developments`, plan: 'TRIAL' },
  });
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      email: `owner-${n}@${label.toLowerCase()}.test`,
      password: 'x',
      name: `${label} Owner`,
      initials: label.slice(0, 2).toUpperCase(),
      role: 'ADMIN',
      principalType: 'internal',
    },
  });
  const deal = await prisma.deal.create({
    data: {
      orgId: org.id,
      name: `${label} Wharf`,
      address: `1 ${label} Road`,
      postcode: 'BH1 1AA',
      assetType: 'RESIDENTIAL',
      stage: 'APPRAISAL',
    },
  });
  const investorUser = await prisma.user.create({
    data: {
      orgId: org.id,
      email: `lp-${n}@${label.toLowerCase()}.test`,
      password: 'x',
      name: `${label} LP`,
      initials: 'LP',
      role: 'VIEWER',
      principalType: 'investor',
    },
  });

  const asPrincipal = (u: typeof user, type: Principal['principalType']): Principal => ({
    userId: u.id,
    orgId: org.id,
    principalType: type,
    role: u.role,
    name: u.name,
    initials: u.initials,
    investorId: u.investorId,
    buyerUnitId: u.buyerUnitId,
  });

  return {
    orgId: org.id,
    userId: user.id,
    dealId: deal.id,
    principal: asPrincipal(user, 'internal'),
    investorPrincipal: asPrincipal(investorUser, 'investor'),
  };
}

/**
 * Assert a call is refused. Deliberately strict about HOW: returning null or an
 * empty list is a pass, because no data crossed — but resolving with the other
 * org's record is a failure even though nothing threw.
 */
export async function expectDenied(label: string, call: () => Promise<unknown>) {
  let result: unknown;
  try {
    result = await call();
  } catch {
    return; // threw — denied
  }
  if (result === null || result === undefined) return;
  if (Array.isArray(result) && result.length === 0) return;
  throw new Error(`${label}: expected refusal, but the call returned data across orgs: ${JSON.stringify(result).slice(0, 300)}`);
}
