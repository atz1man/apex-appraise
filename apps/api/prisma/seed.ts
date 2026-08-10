/**
 * Seed script (`pnpm seed`): full wipe of every table, then the demo-org seed.
 * The seed body lives in src/demo-seed.ts so the nightly demo reset endpoint
 * (POST /admin/reset-demo) can re-run it in-process against the demo org only.
 */
import { PrismaClient } from '@prisma/client';
import { seedDemo } from '../src/demo-seed.js';

const prisma = new PrismaClient();

async function main() {
  /**
   * REFUSES to run against a database that already has organisations.
   *
   * What follows is `DELETE FROM` every table — Organisation, User, Deal,
   * Appraisal, EngagementTerms, all of it. The API entrypoint calls this script
   * on every boot, which means that without this guard every deploy destroyed
   * every customer's workspace: their deals, their appraisals, and the engagement
   * terms their clients had signed. It has gone unnoticed only because the demo
   * org is currently the sole tenant and is recreated by the same script.
   *
   * A fresh database still seeds, which is what a new deployment and CI need.
   * Anything else requires someone to say so out loud with SEED_FORCE=1.
   */
  const existingOrgs = await prisma.organisation.count();
  if (existingOrgs > 0 && process.env.SEED_FORCE !== '1') {
    console.log(
      `[seed] ${existingOrgs} organisation(s) already exist — refusing to wipe. ` +
        'Set SEED_FORCE=1 if you genuinely mean to erase this database.',
    );
    return;
  }

  // wipe (idempotent seed)
  const tables = [
    'WebhookDelivery', 'WebhookEndpoint', 'ApiKey', 'ReportShare', 'ErrorEvent', 'XeroDealMap', 'XeroConnection', 'SsoConnection',
    'Payment', 'Cashflow', 'Holding', 'Investor', 'ActivityEvent', 'Task', 'Document', 'SitePhoto',
    'CostPackage', 'Contractor', 'SalesMilestone', 'Unit', 'Tenancy', 'Inspection',
    'Scenario', 'Comparable', 'Appraisal', 'EngagementTerms', 'OrgPolicy', 'BenchmarkPoint', 'IntegrationConnection',
    'Deal', 'User', 'Organisation',
  ];
  for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);

  await seedDemo(prisma);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
