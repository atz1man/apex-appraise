import type { Prisma, PrismaClient } from '@prisma/client';
import { throttleKeysFor } from './auth/password.js';

/**
 * Deletes for everything an organisation owns: children first (rows with no
 * orgId of their own), then org-scoped rows, then the org itself. Run the
 * result inside `prisma.$transaction`. Shared by the GDPR deleteWorkspace
 * mutation (routers/org.ts) and the demo-reset endpoint (admin.ts) so the
 * cascade order lives in exactly one place.
 *
 * Every model carrying an `orgId` must appear here or "delete my workspace"
 * quietly leaves rows behind. That is not a rule anyone can be trusted to
 * remember — test/cascade.test.ts reads the schema and fails the build when a new
 * model is missing.
 *
 * AuthThrottle is the exception that rule cannot catch. It is keyed by the email
 * address someone typed and carries no orgId at all, so the structural test
 * cannot see it — and a firm that exercised its right to erasure was left with
 * its people's addresses sitting in a lockout table. Async for that one reason:
 * the keys are built from the emails, so they have to be read first.
 */
export async function orgCascadeDeletes(
  prisma: PrismaClient,
  orgId: string,
): Promise<Prisma.PrismaPromise<unknown>[]> {
  const users = await prisma.user.findMany({ where: { orgId }, select: { email: true } });
  const throttleKeys = users.flatMap((u) => throttleKeysFor(u.email));
  return [
    prisma.salesMilestone.deleteMany({ where: { unit: { orgId } } }),
    prisma.holding.deleteMany({ where: { investor: { orgId } } }),
    prisma.cashflow.deleteMany({ where: { investor: { orgId } } }),
    prisma.unit.deleteMany({ where: { orgId } }),
    prisma.tenancy.deleteMany({ where: { orgId } }),
    prisma.investor.deleteMany({ where: { orgId } }),
    prisma.payment.deleteMany({ where: { orgId } }),
    prisma.appraisal.deleteMany({ where: { orgId } }),
    prisma.engagementTerms.deleteMany({ where: { orgId } }),
    prisma.comparable.deleteMany({ where: { orgId } }),
    prisma.scenario.deleteMany({ where: { orgId } }),
    prisma.inspection.deleteMany({ where: { orgId } }),
    prisma.contractor.deleteMany({ where: { orgId } }),
    prisma.costPackage.deleteMany({ where: { orgId } }),
    prisma.sitePhoto.deleteMany({ where: { orgId } }),
    prisma.document.deleteMany({ where: { orgId } }),
    prisma.task.deleteMany({ where: { orgId } }),
    prisma.activityEvent.deleteMany({ where: { orgId } }),
    // a share row outliving its workspace leaves a public token pointing at a
    // deal that no longer exists — dead, but not something to leave lying around
    prisma.reportShare.deleteMany({ where: { orgId } }),
    // deliveries reference their endpoint, so they go first
    prisma.webhookDelivery.deleteMany({ where: { orgId } }),
    prisma.webhookEndpoint.deleteMany({ where: { orgId } }),
    prisma.apiKey.deleteMany({ where: { orgId } }),
    // transactions reference their account, which references the connection
    prisma.bankTransaction.deleteMany({ where: { orgId } }),
    prisma.bankAccount.deleteMany({ where: { orgId } }),
    prisma.bankConnection.deleteMany({ where: { orgId } }),
    prisma.xeroDealMap.deleteMany({ where: { orgId } }),
    // the tokens go with the workspace: a refresh token outliving the firm that
    // granted it is a standing key to their accounting system
    prisma.xeroConnection.deleteMany({ where: { orgId } }),
    // the client secret goes with the workspace that owned it
    prisma.ssoConnection.deleteMany({ where: { orgId } }),
    prisma.errorEvent.deleteMany({ where: { orgId } }),
    prisma.benchmarkPoint.deleteMany({ where: { orgId } }),
    prisma.integrationConnection.deleteMany({ where: { orgId } }),
    prisma.orgPolicy.deleteMany({ where: { orgId } }),
    prisma.deal.deleteMany({ where: { orgId } }),
    // exact keys rather than a suffix match on the address: one person's email
    // can be the tail of another's, and this runs across every tenant's rows
    prisma.authThrottle.deleteMany({ where: { key: { in: throttleKeys } } }),
    prisma.user.deleteMany({ where: { orgId } }),
    prisma.organisation.delete({ where: { id: orgId } }),
  ];
}
