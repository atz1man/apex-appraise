import { beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, principalFromAuthHeader } from '../src/context.js';
import { verifyPassword } from '../src/auth/password.js';
import { readMailbox } from '../src/email.js';
import { anonymous, callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
import type { Principal } from '../src/context.js';

/**
 * Letting a buyer or an investor in.
 *
 * The portals themselves have worked for a long time — a buyer's reservation and
 * conveyancing, an LP's position and cashflows. Nothing could create a login for
 * either one. Outside the demo seed the only ways a User row came into existence
 * were org.register and org.invite, and both write principalType 'internal'. So
 * "Buyer + investor portals" sat on the Growth column of the pricing page and a
 * firm that paid for it could not let one person in.
 *
 * The properties worth holding, in order of how badly they would hurt:
 *   an invited person sees THEIR OWN thing and nothing else;
 *   revoking works on any plan, because taking access back is not a feature;
 *   a portal login never consumes a team seat.
 */

let A: Tenant;
let B: Tenant;

const admin = (t: Tenant) => callerFor({ ...t.principal, role: 'ADMIN' });
const analyst = (t: Tenant) => callerFor({ ...t.principal, role: 'ANALYST' });

/** A workspace with an investor and a reserved unit to invite against. */
async function fixture(t: Tenant) {
  const investor = await prisma.investor.create({
    data: { orgId: t.orgId, name: 'Fischer Capital', initials: 'FC', sharePct: 25, contactFirst: 'Lena' },
  });
  const unit = await prisma.unit.create({
    data: {
      orgId: t.orgId,
      dealId: t.dealId,
      name: 'Plot 14',
      spec: '3 bed semi',
      appraisedValue: 42_500_000n,
      status: 'RESERVED',
      buyerName: 'A. & R. Coombes',
      reservedAt: new Date(),
    },
  });
  return { investor, unit };
}

let A_FIX: Awaited<ReturnType<typeof fixture>>;
let B_FIX: Awaited<ReturnType<typeof fixture>>;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Brookfield');
  B = await makeTenant('Rival');
  A_FIX = await fixture(A);
  B_FIX = await fixture(B);
  // ENTERPRISE so the plan is never what a test is measuring, except where it is
  await prisma.organisation.updateMany({ data: { plan: 'ENTERPRISE' } });
}, 120_000);

/** The principal the invited person would sign in as. */
const principalFor = async (email: string): Promise<Principal> => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return {
    userId: u.id,
    orgId: u.orgId,
    principalType: u.principalType as Principal['principalType'],
    role: u.role,
    name: u.name,
    initials: u.initials,
    investorId: u.investorId,
    buyerUnitId: u.buyerUnitId,
  };
};

describe('inviting an investor', () => {
  it('creates a login that reaches exactly one position', async () => {
    const res = (await admin(A).portalAccess.inviteInvestor({
      investorId: A_FIX.investor.id,
      name: 'Lena Fischer',
      email: 'lena@fischer.test',
    } as never)) as { tempPassword: string; emailed: boolean };

    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'lena@fischer.test' } });
    expect(row.principalType).toBe('investor');
    expect(row.investorId).toBe(A_FIX.investor.id);
    expect(row.role).toBe('VIEWER');
    // the password is hashed, and the one returned is the one that works
    expect(row.password).not.toBe(res.tempPassword);
    expect(verifyPassword(res.tempPassword, row.password)).toBe(true);

    const them = callerFor(await principalFor('lena@fischer.test'));
    const mine = (await them.investors.myPosition()) as { name: string };
    expect(mine.name).toBe('Fischer Capital');
  });

  it('sends them a way in that does not describe the firm to them', async () => {
    await admin(A).portalAccess.inviteInvestor({
      investorId: A_FIX.investor.id,
      name: 'Sam Reed',
      email: 'sam@fischer.test',
    } as never);
    const mail = readMailbox(A.orgId).find((m) => m.to === 'sam@fischer.test');
    expect(mail, 'no invitation was sent').toBeTruthy();
    // an LP told they have been "invited to join Brookfield Developments"
    // reasonably picks up the phone
    expect(mail!.subject).not.toMatch(/invited to join/i);
    expect(mail!.text).toContain('Fischer Capital');
    expect(mail!.text).toContain('/login');
  });

  it('refuses an investor belonging to another workspace', async () => {
    await expectDenied('investor from another org', () =>
      admin(A).portalAccess.inviteInvestor({
        investorId: B_FIX.investor.id,
        name: 'Cuckoo',
        email: 'cuckoo@fischer.test',
      } as never),
    );
    expect(await prisma.user.findUnique({ where: { email: 'cuckoo@fischer.test' } })).toBeNull();
  });

  it('refuses an address that already signs in somewhere', async () => {
    // an email is the identity; a second row for one would make sign-in a
    // question of which record happened to be found first
    await expect(
      admin(B).portalAccess.inviteInvestor({
        investorId: B_FIX.investor.id,
        name: 'Lena Again',
        email: 'lena@fischer.test',
      } as never),
    ).rejects.toThrow(/already exists/i);
  });
});

describe('inviting a buyer', () => {
  it('creates a login that reaches exactly one unit', async () => {
    await admin(A).portalAccess.inviteBuyer({
      unitId: A_FIX.unit.id,
      name: 'A. Coombes',
      email: 'coombes@buyer.test',
    } as never);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'coombes@buyer.test' } });
    expect(row.principalType).toBe('buyer');
    expect(row.buyerUnitId).toBe(A_FIX.unit.id);

    const them = callerFor(await principalFor('coombes@buyer.test'));
    const mine = (await them.buyer.myUnit()) as { unit: { name: string }; development: { name: string } };
    expect(mine.unit.name).toBe('Plot 14');
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: A.dealId } });
    expect(mine.development.name).toBe(deal.name);
  });

  it('cannot reach the pipeline it was invited from', async () => {
    const them = callerFor(await principalFor('coombes@buyer.test'));
    // the whole safety argument for handing a login to an outsider
    await expectDenied('deals.list as a buyer', () => them.deals.list({}));
    await expectDenied('investors.list as a buyer', () => them.investors.list());
    await expectDenied('org.members as a buyer', () => them.org.members());
    // and cannot enumerate the other outsiders: one buyer learning the address
    // of another buyer on the same development is a disclosure the firm made
    await expectDenied('portalAccess.list as a buyer', () => them.portalAccess.list());
  });

  it('refuses a unit belonging to another workspace', async () => {
    await expectDenied('unit from another org', () =>
      admin(A).portalAccess.inviteBuyer({ unitId: B_FIX.unit.id, name: 'Cuckoo', email: 'cuckoo2@buyer.test' } as never),
    );
  });
});

describe('who may issue and revoke', () => {
  it('is admin only', async () => {
    await expectDenied('analyst inviting an investor', () =>
      analyst(A).portalAccess.inviteInvestor({ investorId: A_FIX.investor.id, name: 'No One', email: 'no@one.test' } as never),
    );
    const id = (await prisma.user.findUniqueOrThrow({ where: { email: 'coombes@buyer.test' } })).id;
    await expectDenied('analyst revoking', () => analyst(A).portalAccess.revoke({ userId: id }));
  });

  it('is visible to the team, because knowing who can see a deal is not privileged', async () => {
    const list = (await analyst(A).portalAccess.list()) as Array<{ email: string; kind: string; sees: string | null }>;
    expect(list.map((l) => l.email)).toContain('coombes@buyer.test');
    expect(list.find((l) => l.email === 'coombes@buyer.test')!.sees).toContain('Plot 14');
  });

  it('shows no other workspace its logins', async () => {
    const list = (await analyst(B).portalAccess.list()) as Array<{ email: string }>;
    expect(list.map((l) => l.email)).not.toContain('coombes@buyer.test');
  });

  it('ends the session it revokes', async () => {
    const before = await principalFor('sam@fischer.test');
    const token = jwt.sign({ sub: before.userId }, JWT_SECRET, { expiresIn: '12h' });
    // signed in, right now, with a token that has hours left on it
    expect(await principalFromAuthHeader(prisma, `Bearer ${token}`)).not.toBeNull();

    await admin(A).portalAccess.revoke({ userId: before.userId });
    expect(await prisma.user.findUnique({ where: { email: 'sam@fischer.test' } })).toBeNull();

    /**
     * Asked at the layer that actually decides it. A tRPC caller built straight
     * from a Principal object never re-reads the user, so testing revocation
     * through the harness would assert nothing about the live path: a session
     * token is resolved to a row on every request, and a row that is gone is
     * nobody. The token still verifies — that is the point.
     */
    expect(jwt.verify(token, JWT_SECRET)).toBeTruthy();
    expect(await principalFromAuthHeader(prisma, `Bearer ${token}`)).toBeNull();
  });

  it('cannot be turned on a colleague', async () => {
    // scoped to portal types, so this control can never quietly become a way to
    // delete a member without the checks removeMember does
    await expectDenied('revoking an internal user', () => admin(A).portalAccess.revoke({ userId: A.userId }));
    expect(await prisma.user.findUnique({ where: { id: A.userId } })).not.toBeNull();
  });
});

describe('what a portal login costs', () => {
  it('does not use a seat on the plan', async () => {
    // entitlements.ts counts internal seats only and says charging a firm for
    // its own investor's read-only login would be indefensible — this is the
    // procedure that has to honour it
    const before = (await admin(B).billing.config()) as { usage: { members: { used: number } } };

    await admin(B).portalAccess.inviteInvestor({
      investorId: B_FIX.investor.id,
      name: 'Rival LP',
      email: 'lp@rival.test',
    } as never);

    const after = (await admin(B).billing.config()) as { usage: { members: { used: number } } };
    expect(after.usage.members.used).toBe(before.usage.members.used);
  });
});

describe('the plan', () => {
  it('gates issuing a login but never taking one back', async () => {
    await prisma.organisation.update({ where: { id: B.orgId }, data: { plan: 'STARTER' } });

    await expect(
      admin(B).portalAccess.inviteInvestor({ investorId: B_FIX.investor.id, name: 'Late', email: 'late@rival.test' } as never),
    ).rejects.toThrow(/is included from Growth/);

    // a downgraded workspace still has outsiders holding credentials to its deal
    // figures, and a paywall in front of revocation is a security incident
    const id = (await prisma.user.findUniqueOrThrow({ where: { email: 'lp@rival.test' } })).id;
    await expect(admin(B).portalAccess.revoke({ userId: id })).resolves.toEqual({ ok: true });
    await expect(analyst(B).portalAccess.list()).resolves.toBeDefined();
  });
});

describe('an outsider with no login', () => {
  it('reaches none of this', async () => {
    await expectDenied('anonymous list', () => anonymous().portalAccess.list());
    await expectDenied('anonymous invite', () =>
      anonymous().portalAccess.inviteInvestor({ investorId: A_FIX.investor.id, name: 'X', email: 'x@x.test' } as never),
    );
  });
});
