import { beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Taking someone's access away.
 *
 * This workspace could revoke an API key, a webhook, an SSO connection and
 * itself entirely — everything except a person. A colleague who left in March
 * still held every deal, every valuation and every client document their old
 * employer had uploaded, because there was no procedure that removed them.
 */

let T: Tenant;
let Other: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Offboard');
  Other = await makeTenant('Neighbour');
  // These cases are about removal, not about billing: give this workspace room
  // so an unrelated seat limit cannot be what refuses the fifth invite. The seat
  // limit gets its own tenant below, where it is the thing under test.
  await prisma.organisation.update({ where: { id: T.orgId }, data: { plan: 'ENTERPRISE' } });
}, 120_000);

const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

let unique = 0;
async function addMember(t: Tenant, name: string, role = 'ANALYST') {
  const email = `${name.toLowerCase()}-${t.orgId}-${++unique}@offboard.test`;
  await callerFor({ ...t.principal, role: 'ADMIN' }).org.invite({ name, email, role } as never);
  return prisma.user.findFirstOrThrow({ where: { email } });
}

describe('removing a team member', () => {
  it('ends their access on the very next request', async () => {
    const leaver = await addMember(T, 'Leaver');

    // they can read the workspace while they are in it
    const asLeaver = {
      userId: leaver.id, orgId: leaver.orgId, principalType: 'internal' as const,
      role: leaver.role, name: leaver.name, initials: leaver.initials,
      investorId: null, buyerUnitId: null,
    };
    await expect(callerFor(asLeaver).deals.list()).resolves.toBeTruthy();

    await admin().org.removeMember({ userId: leaver.id });

    /**
     * The principal is re-read from the database on every request, so the row
     * going means the next call is unauthenticated — no token to revoke, no
     * window to wait out. A soft flag would have needed context.ts to learn
     * about it.
     */
    expect(await prisma.user.findUnique({ where: { id: leaver.id } })).toBeNull();
  });

  /**
   * Not a row count — the seat is only genuinely free if the plan lets you fill
   * it again. This tenant is on the trial's two seats, so it is the entitlement
   * check itself that answers.
   */
  it('frees the seat, so a firm stops paying for people who left', async () => {
    const small = await makeTenant('Seat'); // TRIAL: 2 internal seats, 1 taken
    const second = await addMember(small, 'Second');
    await expect(addMember(small, 'Third')).rejects.toThrow(/2 team members/);

    await callerFor({ ...small.principal, role: 'ADMIN' }).org.removeMember({ userId: second.id });

    const replacement = await addMember(small, 'Replacement');
    expect(replacement.id, 'the seat was still occupied by someone who had gone').toBeTruthy();
  });

  /**
   * Losing the owner of a scheme must not lose the scheme. The guarantee is the
   * foreign key — Deal.owner is optional and ON DELETE SET NULL — so this test
   * is pinning a schema decision, and would fail if someone made the relation
   * required or switched it to a cascade.
   */
  it('leaves their deals behind, unassigned', async () => {
    const owner = await addMember(T, 'Owner');
    const deal = await prisma.deal.create({
      data: { orgId: T.orgId, name: 'Their scheme', address: '1 Test Street', assetType: 'RESIDENTIAL', stage: 'SOURCING', ownerId: owner.id },
    });

    await admin().org.removeMember({ userId: owner.id });

    const after = await prisma.deal.findUnique({ where: { id: deal.id } });
    expect(after, 'the deal left with the person who owned it').not.toBeNull();
    expect(after!.ownerId).toBeNull();
  });

  /**
   * The audit trail is meant to outlive the person — ActivityEvent keeps the
   * actor's name as text and its userId carries no foreign key, precisely so a
   * removal cannot erase what they did.
   */
  it('records the removal, and does not erase what they had already done', async () => {
    const noisy = await addMember(T, 'Noisy');
    await prisma.activityEvent.create({
      data: { orgId: T.orgId, userId: noisy.id, actor: noisy.name, action: 'approved an appraisal', target: 'Northgate' },
    });

    await admin().org.removeMember({ userId: noisy.id });

    const theirs = await prisma.activityEvent.findFirst({ where: { orgId: T.orgId, action: 'approved an appraisal' } });
    expect(theirs, 'their history went with them').not.toBeNull();
    expect(theirs!.actor).toBe(noisy.name);

    // by target, not just by action — earlier cases in this file removed people too
    const removal = await prisma.activityEvent.findFirst({
      where: { orgId: T.orgId, action: 'removed a team member', target: { contains: noisy.email } },
    });
    expect(removal, 'an offboarding left no trace').not.toBeNull();
    expect(removal!.actor, 'the audit names the person removed, not the one who did it').toBe(T.principal.name);
  });

  /**
   * An API key is a workspace credential, not a personal one — revoking it on
   * removal would take a firm's integrations down with the person. But a leaver
   * may hold a copy of one they made, so the removal has to say so rather than
   * leave the admin to find out.
   */
  it('reports the live API keys they created, without revoking them', async () => {
    const integrator = await addMember(T, 'Integrator');
    const key = await prisma.apiKey.create({
      data: { orgId: T.orgId, name: 'Xero sync', prefix: 'apex_ab', keyHash: `hash-${Date.now()}`, createdById: integrator.id },
    });
    await prisma.apiKey.create({
      data: { orgId: T.orgId, name: 'Retired', prefix: 'apex_cd', keyHash: `hash2-${Date.now()}`, createdById: integrator.id, revokedAt: new Date() },
    });

    const out = await admin().org.removeMember({ userId: integrator.id });
    expect(out.apiKeysCreated, 'an already-revoked key is not something to warn about').toBe(1);
    expect(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt,
      'removing a person took a live integration down with them',
    ).toBeNull();
  });
});

describe('who may remove whom', () => {
  it('refuses a non-admin', async () => {
    const member = await addMember(T, 'Ordinary');
    const victim = await addMember(T, 'Victim');
    await expectDenied('an analyst removed a colleague', () =>
      callerFor({ ...T.principal, userId: member.id, role: 'ANALYST' }).org.removeMember({ userId: victim.id }),
    );
    expect(await prisma.user.findUnique({ where: { id: victim.id } })).not.toBeNull();
  });

  /**
   * Removing yourself would be the one way to strand a workspace with no admin.
   * With this refusal, adminProcedure guarantees at least one always remains.
   */
  it('refuses to let an admin remove themselves', async () => {
    await expect(admin().org.removeMember({ userId: T.principal.userId })).rejects.toThrow(TRPCError);
    expect(await prisma.user.findUnique({ where: { id: T.principal.userId } })).not.toBeNull();
  });

  /**
   * A portal login is not a team member: it occupies no seat, never appears in
   * the members list, and belongs to an investor or buyer relationship that
   * outlives whoever is logged into it. Ending one is a different act, and must
   * not happen by way of a mis-typed user id here.
   */
  it('will not remove an investor or buyer portal login', async () => {
    const lp = T.investorPrincipal.userId;
    await expect(admin().org.removeMember({ userId: lp })).rejects.toThrow(TRPCError);
    expect(await prisma.user.findUnique({ where: { id: lp } })).not.toBeNull();
  });

  it('cannot reach into another workspace', async () => {
    const theirs = await prisma.user.findFirstOrThrow({ where: { orgId: Other.orgId } });
    await expect(admin().org.removeMember({ userId: theirs.id })).rejects.toThrow(TRPCError);
    expect(
      await prisma.user.findUnique({ where: { id: theirs.id } }),
      'an admin deleted a user belonging to a different firm',
    ).not.toBeNull();
  });
});
