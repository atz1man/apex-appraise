import { beforeAll, describe, expect, it } from 'vitest';
import { PLANS } from '../src/stripe.js';
import { PLAN_ENTITLEMENTS, entitlementsFor } from '../src/entitlements.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Plan limits. The point of these is not that a number is a number — it is that
 * the number we ENFORCE is the number we SELL, and that hitting it produces
 * something a customer can act on.
 */

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Limits');
}, 120_000);

const setPlan = (plan: string) => prisma.organisation.update({ where: { id: T.orgId }, data: { plan } });

const addDeal = (n: number) =>
  callerFor(T.principal).deals.create({
    name: `Deal ${n}`,
    address: `${n} Test Street`,
    assetType: 'RESIDENTIAL',
    stage: 'SOURCING',
    probability: 50,
    gdv: 0,
    forecastProfit: 0,
    equityRequired: 0,
  } as never);

describe('what we enforce is what we sell', () => {
  it('matches the pricing page, feature for feature', () => {
    // if the marketing copy changes, this fails until the entitlements follow —
    // enforcement more generous than the page means nobody upgrades, stricter
    // means we are mis-selling
    const starter = PLANS.find((p) => p.key === 'STARTER')!;
    expect(starter.features).toContain(`${PLAN_ENTITLEMENTS.STARTER.maxDeals} active deals`);
    expect(starter.features).toContain(`${PLAN_ENTITLEMENTS.STARTER.maxMembers} team members`);

    const growth = PLANS.find((p) => p.key === 'GROWTH')!;
    expect(growth.features).toContain('Unlimited deals');
    expect(PLAN_ENTITLEMENTS.GROWTH.maxDeals).toBeNull();
    expect(growth.features).toContain(`${PLAN_ENTITLEMENTS.GROWTH.maxMembers} team members`);

    expect(PLANS.find((p) => p.key === 'ENTERPRISE')!.features).toContain('Unlimited members');
    expect(PLAN_ENTITLEMENTS.ENTERPRISE.maxMembers).toBeNull();
  });

  it('treats an unknown plan as the most restrictive one', () => {
    // a typo in a webhook must not silently hand someone Enterprise
    expect(entitlementsFor('PLATINUM')).toEqual(PLAN_ENTITLEMENTS.TRIAL);
  });
});

describe('the deal limit', () => {
  it('stops the fourth deal on a trial and says what to do about it', async () => {
    await setPlan('TRIAL');
    // the tenant fixture already owns one deal
    await addDeal(2);
    await addDeal(3);
    await expect(addDeal(4)).rejects.toThrow(/3 active deals.*Upgrade to Growth/s);
    expect(await prisma.deal.count({ where: { orgId: T.orgId } })).toBe(3);
  });

  it('lifts on Growth, and the deals made under the old plan are still there', async () => {
    await setPlan('GROWTH');
    await addDeal(4);
    expect(await prisma.deal.count({ where: { orgId: T.orgId } })).toBe(4);
  });

  it('does not delete anything when a plan is downgraded below current usage', async () => {
    await setPlan('TRIAL');
    // over the limit now — but a firm's existing deals must survive a downgrade
    expect(await prisma.deal.count({ where: { orgId: T.orgId } })).toBe(4);
    await expect(addDeal(5)).rejects.toThrow(/Upgrade/);
    expect(await prisma.deal.count({ where: { orgId: T.orgId } })).toBe(4);
  });
});

describe('the seat limit', () => {
  it('counts internal seats only — a portal login is not a team member', async () => {
    await setPlan('TRIAL'); // 2 seats; the fixture has 1 internal + 1 investor
    const invite = (email: string) =>
      callerFor(T.principal).org.invite({ name: 'New Person', email, role: 'ANALYST' } as never);

    // the investor already on this org must not be consuming a paid seat
    await invite(`second-${T.orgId}@limits.test`);
    await expect(invite(`third-${T.orgId}@limits.test`)).rejects.toThrow(/2 team members/);
  });
});
