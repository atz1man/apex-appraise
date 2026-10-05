import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Who a buyer is told to contact.
 *
 * The portal's contact card was typed into the page: "Sarah Reeve · Sales
 * progressor — your point of contact through to completion", initials SR,
 * `mailto:sales@apexappraise.co.uk` and `tel:+441202555555`. Nobody of that name
 * exists; the address is the SOFTWARE VENDOR's rather than the developer's; and
 * 555555 is the UK fictional-number range. A buyer who has reserved a plot and
 * paid a deposit was handed a made-up person, an inbox at the wrong company, and
 * a number that does not ring — so a question about their own house purchase
 * either arrived at a software firm with no account to look up, or went nowhere.
 *
 * `buyer.myUnit` returned no contact at all, which is why the page could invent
 * one. The INVESTOR portal beside it already did this properly
 * (`investors.myContact` — "the real administrator at the managing firm"), so the
 * convention existed and this one screen was left with the design mock in it.
 */

let T: Tenant;

const buyerFor = async (t: Tenant, unitName: string) => {
  const unit = await prisma.unit.create({
    data: {
      orgId: t.orgId, dealId: t.dealId, name: unitName, spec: '3 bed',
      appraisedValue: BigInt(450_000_00), status: 'RESERVED', buyerName: 'Buyer',
    },
  });
  const user = await prisma.user.create({
    data: {
      orgId: t.orgId, email: `buyer-${unit.id}@contact.test`, password: 'x', name: 'Buyer',
      initials: 'BY', role: 'VIEWER', principalType: 'buyer', buyerUnitId: unit.id,
    },
  });
  return callerFor({
    userId: user.id, orgId: t.orgId, principalType: 'buyer' as const, role: 'VIEWER',
    name: 'Buyer', initials: 'BY', investorId: null, buyerUnitId: unit.id,
  } as never);
};

type Contact = { firm: string; person: { name: string; email: string; initials: string } | null };
const contactOf = async (caller: Awaited<ReturnType<typeof buyerFor>>) =>
  ((await caller.buyer.myUnit()) as { contact: Contact }).contact;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('BuyerContact');
}, 120_000);

describe('the buyer is given a real person at a real firm', () => {
  /**
   * The owner is a SECOND person, not the tenant's own admin.
   *
   * Written the obvious way first — `ownerId = T.userId`, who is this tenant's
   * administrator — and removing the owner branch entirely left it green: the
   * function fell through to the admin lookup and found the same user, so the
   * case could not tell the two branches apart. A surviving mutant that means the
   * TEST is not discriminating, which is the shape `CLAUDE.md` warns about.
   */
  it('names the deal’s owner, with the address that is on their record', async () => {
    const owner = await prisma.user.create({
      data: {
        orgId: T.orgId, email: 'olu.adeyemi@contact.test', password: 'x', name: 'Olu Adeyemi',
        initials: 'OA', role: 'ANALYST', principalType: 'internal',
      },
    });
    const admin = await prisma.user.findFirstOrThrow({
      where: { orgId: T.orgId, principalType: 'internal', role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    expect(owner.email, 'the owner is the admin again, so this cannot discriminate').not.toBe(admin.email);

    await prisma.deal.update({ where: { id: T.dealId }, data: { ownerId: owner.id } });
    const contact = await contactOf(await buyerFor(T, 'Plot 1'));
    expect(contact.person?.name).toBe('Olu Adeyemi');
    expect(contact.person?.email, 'the buyer was given an address nobody reads').toBe(owner.email);
    expect(contact.person?.initials).toBe('OA');
  });

  it('names the firm, not this product', async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: T.orgId } });
    const contact = await contactOf(await buyerFor(T, 'Plot 2'));
    expect(contact.firm).toBe(org.name);
    expect(contact.firm).not.toMatch(/apex appraise/i);
  });

  /**
   * `Deal.ownerId` is nullable, so this is a real state and not an edge case.
   * The fallback is the account's first administrator — the same one
   * `investors.myContact` uses — because they are the person who can route the
   * enquiry.
   */
  it('falls back to the firm’s administrator when a deal has no owner', async () => {
    await prisma.deal.update({ where: { id: T.dealId }, data: { ownerId: null } });
    const admin = await prisma.user.findFirstOrThrow({
      where: { orgId: T.orgId, principalType: 'internal', role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    const contact = await contactOf(await buyerFor(T, 'Plot 3'));
    expect(contact.person?.email).toBe(admin.email);
  });

  /**
   * And NULL rather than a plausible substitute. A workspace with nobody to
   * answer is a state the screen can say ("contact the developer directly"); a
   * name it made up is not.
   */
  it('answers nobody rather than inventing somebody', async () => {
    const t = await makeTenant('BuyerContactEmpty');
    await prisma.deal.update({ where: { id: t.dealId }, data: { ownerId: null } });
    const caller = await buyerFor(t, 'Plot 1');
    await prisma.user.updateMany({
      where: { orgId: t.orgId, principalType: 'internal' },
      data: { role: 'ANALYST' },
    });
    const contact = await contactOf(caller);
    expect(contact.person, 'a contact was conjured for a firm with no administrator').toBeNull();
    expect(contact.firm, 'the firm’s own name is still known').not.toBe('');
  });

  /**
   * Each firm's buyer gets that firm's own people.
   *
   * An earlier version of this case planted another firm's user as the deal's
   * `ownerId` and asserted the email came back — which pins nothing, because no
   * procedure can set a foreign owner (`isolation-sweep` drives that) and a
   * fixture of an unreachable state proves only that a row written by hand is
   * read back. It also read as a leak under a heading claiming isolation, which
   * is the worse of the two failures: somebody reads the heading. So this drives
   * two real workspaces and checks neither answer bleeds into the other.
   */
  it('answers each firm with its own people', async () => {
    const other = await makeTenant('BuyerContactOther');
    const mine = await prisma.user.findFirstOrThrow({ where: { orgId: T.orgId, email: 'olu.adeyemi@contact.test' } });
    const theirs = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    await prisma.deal.update({ where: { id: T.dealId }, data: { ownerId: mine.id } });
    await prisma.deal.update({ where: { id: other.dealId }, data: { ownerId: theirs.id } });

    const [ours, theirsSeen] = await Promise.all([
      contactOf(await buyerFor(T, 'Plot 4')),
      contactOf(await buyerFor(other, 'Plot 1')),
    ]);
    expect(ours.person?.email).toBe(mine.email);
    expect(theirsSeen.person?.email, 'a buyer was given the wrong firm’s staff').toBe(theirs.email);
    expect(ours.firm).not.toBe(theirsSeen.firm);
  });
});
