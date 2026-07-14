import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Deletes for everything an organisation owns: children first (rows with no
 * orgId of their own), then org-scoped rows, then the org itself. Run the
 * result inside `prisma.$transaction`. Shared by the GDPR deleteWorkspace
 * mutation (routers/org.ts) and the demo-reset endpoint (admin.ts) so the
 * cascade order lives in exactly one place.
 */
export function orgCascadeDeletes(prisma: PrismaClient, orgId: string): Prisma.PrismaPromise<unknown>[] {
  return [
    prisma.salesMilestone.deleteMany({ where: { unit: { orgId } } }),
    prisma.holding.deleteMany({ where: { investor: { orgId } } }),
    prisma.cashflow.deleteMany({ where: { investor: { orgId } } }),
    prisma.unit.deleteMany({ where: { orgId } }),
    prisma.tenancy.deleteMany({ where: { orgId } }),
    prisma.investor.deleteMany({ where: { orgId } }),
    prisma.payment.deleteMany({ where: { orgId } }),
    prisma.appraisal.deleteMany({ where: { orgId } }),
    prisma.comparable.deleteMany({ where: { orgId } }),
    prisma.scenario.deleteMany({ where: { orgId } }),
    prisma.inspection.deleteMany({ where: { orgId } }),
    prisma.contractor.deleteMany({ where: { orgId } }),
    prisma.costPackage.deleteMany({ where: { orgId } }),
    prisma.sitePhoto.deleteMany({ where: { orgId } }),
    prisma.document.deleteMany({ where: { orgId } }),
    prisma.task.deleteMany({ where: { orgId } }),
    prisma.activityEvent.deleteMany({ where: { orgId } }),
    prisma.benchmarkPoint.deleteMany({ where: { orgId } }),
    prisma.integrationConnection.deleteMany({ where: { orgId } }),
    prisma.deal.deleteMany({ where: { orgId } }),
    prisma.user.deleteMany({ where: { orgId } }),
    prisma.organisation.delete({ where: { id: orgId } }),
  ];
}
