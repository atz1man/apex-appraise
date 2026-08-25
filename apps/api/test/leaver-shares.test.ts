import { beforeAll, describe, expect, it } from 'vitest';
import { hashShareToken, shareRefusal } from '../src/share.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * What removing a colleague takes with them.
 *
 * removeMember hard-deletes the row and tells the admin how many live API keys
 * that person created — deliberately, because a key belongs to the workspace and
 * killing one would take a live integration down, so the admin is warned rather
 * than surprised.
 *
 * Report shares got no such warning, and they are the one thing that actually
 * BREAKS. src/reports.ts:94 looks the creator up on every request and answers
 * 404 when there is none: "This link is no longer available. Ask the sender for
 * a new one." So removing a leaver silently killed every valuation link they had
 * sent to a lender or a client, told the recipient to ask a sender who no longer
 * exists, and told the firm nothing at all.
 *
 * It is the ONLY field of its kind that is read back. Of the six models carrying
 * a user id — ReportShare, ApiKey, WebhookEndpoint, XeroConnection,
 * SsoConnection, BankConnection — only share.createdById is ever looked up
 * again, so this is the whole of the problem rather than an example of it.
 */

let T: Tenant;

const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

/** A colleague, and a live link they sent somebody. */
async function memberWithShare(email: string, over: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      orgId: T.orgId, email, password: 'x', name: 'Leaver Person',
      initials: 'LP', role: 'ANALYST', principalType: 'internal',
    },
  });
  const share = await prisma.reportShare.create({
    data: {
      orgId: T.orgId,
      dealId: T.dealId,
      kind: 'appraisal',
      tokenHash: hashShareToken(`token-${email}`),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      createdById: user.id,
      ...over,
    },
  });
  return { user, share };
}

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Leavers');
}, 120_000);

describe('removing a colleague', () => {
  it('says how many live links it is about to break', async () => {
    const { user } = await memberWithShare('leaver-1@firm.test');

    const res = (await admin().org.removeMember({ userId: user.id })) as { sharesCreated: number };
    // the admin can re-issue them; they cannot re-issue what nobody told them about
    expect(res.sharesCreated).toBe(1);
  });

  it('breaks them — which is why the count is worth having', async () => {
    const { user, share } = await memberWithShare('leaver-2@firm.test');
    await admin().org.removeMember({ userId: user.id });

    const still = await prisma.reportShare.findUniqueOrThrow({ where: { id: share.id } });
    // the link is not expired and not revoked: by the share's own rules it should open
    expect(shareRefusal(still)).toBeNull();
    /**
     * But this is the lookup src/reports.ts does on every request, and a null
     * creator is a 404. Asserting the condition rather than booting a browser to
     * watch it happen.
     */
    expect(await prisma.user.findUnique({ where: { id: still.createdById } })).toBeNull();
  });

  it('does not count links that were already dead', async () => {
    // a revoked or expired link breaking is no loss, and padding the number
    // would train an admin to ignore it
    const revoked = await memberWithShare('leaver-3@firm.test', { revokedAt: new Date() });
    const expired = await memberWithShare('leaver-4@firm.test', { expiresAt: new Date(Date.now() - 1000) });

    expect(((await admin().org.removeMember({ userId: revoked.user.id })) as { sharesCreated: number }).sharesCreated).toBe(0);
    expect(((await admin().org.removeMember({ userId: expired.user.id })) as { sharesCreated: number }).sharesCreated).toBe(0);
  });

  it('still reports API keys, which do not break', async () => {
    // the existing warning is about something different: a key goes on working,
    // and the admin is told because a leaver may hold a copy
    const { user } = await memberWithShare('leaver-5@firm.test');
    await prisma.apiKey.create({
      data: { orgId: T.orgId, name: 'theirs', prefix: 'apex_live_zzz', keyHash: `hash-${user.id}`, scopes: 'read', createdById: user.id },
    });
    const res = (await admin().org.removeMember({ userId: user.id })) as { apiKeysCreated: number; sharesCreated: number };
    expect(res.apiKeysCreated).toBe(1);
    expect(res.sharesCreated).toBe(1);
  });
});
