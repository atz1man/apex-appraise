import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';

/**
 * What a plan actually entitles you to.
 *
 * These numbers are not a product decision made here — they are what the pricing
 * page SELLS (see PLANS in stripe.ts: "3 active deals, 2 team members" on
 * Starter, "10 team members" on Growth). Enforcement that is more generous than
 * the marketing means nobody ever upgrades; enforcement that is stricter than the
 * marketing is mis-selling. If the pricing copy changes, this file changes with
 * it, and the test that pins them together fails until it does.
 */

export type PlanKey = 'TRIAL' | 'STARTER' | 'GROWTH' | 'ENTERPRISE';

export interface Entitlements {
  /** null means unlimited */
  maxDeals: number | null;
  maxMembers: number | null;
}

/**
 * The trial deliberately carries Starter's VOLUMES. A trial that lets someone run
 * their whole pipeline for free is not a trial, and the limit people meet is what
 * makes them decide.
 */
export const PLAN_ENTITLEMENTS: Record<PlanKey, Entitlements> = {
  TRIAL: { maxDeals: 3, maxMembers: 2 },
  STARTER: { maxDeals: 3, maxMembers: 2 },
  GROWTH: { maxDeals: null, maxMembers: 10 },
  ENTERPRISE: { maxDeals: null, maxMembers: null },
};

export const entitlementsFor = (plan: string): Entitlements =>
  PLAN_ENTITLEMENTS[(plan as PlanKey) in PLAN_ENTITLEMENTS ? (plan as PlanKey) : 'TRIAL'];

/**
 * A limit refusal names the limit, the plan it belongs to and what lifts it.
 * "FORBIDDEN" with no explanation reads as a bug and generates a support ticket
 * instead of an upgrade.
 */
function limitReached(what: string, limit: number, plan: string): never {
  const next = plan === 'GROWTH' ? 'Enterprise' : 'Growth';
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `Your ${plan === 'TRIAL' ? 'trial' : plan.toLowerCase()} plan includes ${limit} ${what}. Upgrade to ${next} to add more.`,
  });
}

/**
 * Counted at the moment of creation, against what exists NOW.
 *
 * Existing records over the limit are never touched — a plan change must not make
 * a firm's data disappear or become unreachable. Downgrading simply means you
 * cannot add another until you are back under.
 */
export async function assertCanAddDeal(prisma: PrismaClient, orgId: string, plan: string) {
  const { maxDeals } = entitlementsFor(plan);
  if (maxDeals === null) return;
  const deals = await prisma.deal.count({ where: { orgId } });
  if (deals >= maxDeals) limitReached('active deals', maxDeals, plan);
}

export async function assertCanAddMember(prisma: PrismaClient, orgId: string, plan: string) {
  const { maxMembers } = entitlementsFor(plan);
  if (maxMembers === null) return;
  // internal seats only: a portal login for a buyer or an investor is not a
  // team member, and charging for one would be indefensible
  const members = await prisma.user.count({ where: { orgId, principalType: 'internal' } });
  if (members >= maxMembers) limitReached('team members', maxMembers, plan);
}

/** What the UI needs to show an allowance before the user hits a wall. */
export async function usageFor(prisma: PrismaClient, orgId: string, plan: string) {
  const e = entitlementsFor(plan);
  const [deals, members] = await Promise.all([
    prisma.deal.count({ where: { orgId } }),
    prisma.user.count({ where: { orgId, principalType: 'internal' } }),
  ]);
  return {
    plan,
    deals: { used: deals, limit: e.maxDeals },
    members: { used: members, limit: e.maxMembers },
  };
}
