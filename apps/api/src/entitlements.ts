import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import { FEATURE_COPY, cheapestPlanWith, planHasFeature, planLabel, type Feature, type PlanKey } from '@apex/types/plan';

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

export type { PlanKey } from '@apex/types/plan';

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
 * FEATURES, as opposed to volumes.
 *
 * The pricing page sells two different kinds of thing and they need different
 * enforcement. A volume ("3 active deals") is about how much of your own data
 * you may accumulate. A feature ("Benchmarking", "Public API + webhooks") is a
 * capability you rent by the month.
 *
 * Until this existed only the volumes were enforced, so every word on the Growth
 * and Enterprise columns was already switched on for a Starter subscriber at
 * £49: the AI Development Director, both portals, benchmarking, and the public
 * API. Nobody had a reason to upgrade except to add a fourth deal.
 *
 * The catalogue itself is in @apex/types/plan because the app needs it too — to show a
 * locked surface with an upgrade route rather than a live control that answers
 * FORBIDDEN. Keeping a second copy here is precisely the mistake this whole
 * change is about.
 */
export {
  FEATURES,
  FEATURE_COPY,
  PLAN_FEATURES,
  PAID_PLANS_BY_PRICE,
  featuresFor,
  planHasFeature,
  cheapestPlanWith,
  planLabel,
} from '@apex/types/plan';
export type { Feature } from '@apex/types/plan';

/**
 * Refuse a capability this workspace is not paying for.
 *
 * A downgrade turns features OFF, where it leaves volumes alone. The distinction
 * is not arbitrary: deals and members are the customer's data and must never
 * become unreachable, but a capability rented by the month stops when the month
 * is not paid for. Nothing is deleted either way — API keys, webhook endpoints
 * and portal logins survive a downgrade and light back up on re-subscription.
 */
export async function assertFeature(
  prisma: PrismaClient,
  orgId: string,
  feature: Feature,
): Promise<void> {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { plan: true } });
  // a missing org resolves to '' — not in the map, so the restrictive fallback
  const plan = org?.plan ?? '';
  if (planHasFeature(plan, feature)) return;
  const need = cheapestPlanWith(feature);
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `${FEATURE_COPY[feature]} is included from ${planLabel(need)}. Upgrade in Settings → Billing to switch it on.`,
  });
}

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
