/**
 * Seed script (`pnpm seed`): full wipe of every table, then the demo-org seed.
 * The seed body lives in src/demo-seed.ts so the nightly demo reset endpoint
 * (POST /admin/reset-demo) can re-run it in-process against the demo org only.
 */
import { PrismaClient } from '@prisma/client';
import { seedDemo } from '../src/demo-seed.js';

const prisma = new PrismaClient();

async function main() {
  // wipe (idempotent seed)
  const tables = [
    'Payment', 'Cashflow', 'Holding', 'Investor', 'ActivityEvent', 'Task', 'Document', 'SitePhoto',
    'CostPackage', 'Contractor', 'SalesMilestone', 'Unit', 'Tenancy', 'Inspection',
    'Scenario', 'Comparable', 'Appraisal', 'BenchmarkPoint', 'IntegrationConnection',
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
