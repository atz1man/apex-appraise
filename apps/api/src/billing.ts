/**
 * The subscription, as this server understands it.
 *
 * Extracted from `billing.sync` because three procedures now need the same
 * answer and `trpc.ts` already says why a rule written in several places is one
 * edit away from meaning different things in each. `sync` reflects Stripe's
 * state onto the workspace; `changePlan` and `cancelPlan` change that state and
 * then reflect it, through this.
 */
import type { PrismaClient } from '@prisma/client';
import { PLANS, stripeConfigured, stripeFetch, type PlanDef } from './stripe.js';

export type PlanKey = PlanDef['key'];

/** The lookup key `ensurePrice` gives each plan. One spelling, used by both. */
export const planLookupKey = (key: string) => `apex_${key.toLowerCase()}_monthly`;

export type StripeSubscription = {
  id: string;
  status: string;
  cancel_at?: number | null;
  cancel_at_period_end?: boolean;
  metadata?: { plan?: string };
  items?: { data?: Array<{ id?: string; price?: { id?: string; lookup_key?: string | null } }> };
};

/**
 * Every live subscription for a customer.
 *
 * `limit` was 3 and nothing counted the results, which mattered once it turned
 * out a plan switch could leave two. Ten is enough to tell "one" from "more
 * than one", which is the only distinction anything here draws.
 */
export const activeSubscriptions = async (customerId: string): Promise<StripeSubscription[]> => {
  const subs = await stripeFetch<{ data: StripeSubscription[] }>(
    `/subscriptions?customer=${customerId}&status=active&limit=10`,
    undefined,
    'GET',
  );
  return (subs.data ?? []).filter((s) => s.status === 'active');
};

/**
 * WHICH plan a subscription is, decided from the subscription rather than
 * guessed.
 *
 * The price first, because the price is what the customer actually pays, and
 * `ensurePrice` gives every plan a deterministic lookup key. The metadata
 * second, for a subscription whose price predates those keys. Neither answers
 * for a subscription created in the Stripe dashboard against a hand-made price,
 * and the caller is expected to leave the plan alone rather than invent one —
 * see `reconcileSubscription`.
 */
export const planOfSubscription = (sub: StripeSubscription | undefined): PlanKey | undefined => {
  const fromLookupKey = sub?.items?.data
    ?.map((i) => PLANS.find((p) => i.price?.lookup_key === planLookupKey(p.key))?.key)
    .find((k): k is PlanKey => !!k);
  return fromLookupKey ?? PLANS.find((p) => p.key === sub?.metadata?.plan)?.key;
};

export type Reconciled = {
  plan: string;
  /** Set when Stripe reports a cancellation already scheduled. */
  cancelAt: Date | null;
  /**
   * More than one live subscription against this customer. The firm is being
   * billed twice and this server cannot say for what, so it changes nothing.
   */
  ambiguous: boolean;
};

/**
 * Pull Stripe's answer onto the workspace, and record the change.
 *
 * Three things here are deliberately NOT guesses, and each was once:
 *
 *   an active subscription this server cannot identify leaves the plan ALONE.
 *   Not GROWTH (which it used to invent) and not TRIAL. The customer is paying
 *   and we do not know for what, so any answer either hands out features nobody
 *   bought or takes away features somebody did.
 *
 *   SEVERAL active subscriptions leave it alone too. `billing.sync` used to
 *   take `data.find(s => s.status === 'active')` — the first Stripe happened to
 *   list — so a firm paying for two plans ran at whichever one came back first.
 *   That state was not hypothetical: "Switch plan" opened a second Checkout
 *   against the same customer and cancelled nothing, so every switch created
 *   it.
 *
 *   NO active subscription is TRIAL, and that one is not a guess at all: it is
 *   Stripe saying nobody is paying.
 */
export async function reconcileSubscription(prisma: PrismaClient, orgId: string): Promise<Reconciled> {
  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  if (!org) return { plan: 'TRIAL', cancelAt: null, ambiguous: false };
  if (!org.stripeCustomerId || !stripeConfigured()) {
    return { plan: org.plan, cancelAt: org.subscriptionCancelAt, ambiguous: false };
  }

  const live = await activeSubscriptions(org.stripeCustomerId);
  const ambiguous = live.length > 1;
  const active = ambiguous ? undefined : live[0];
  const named = planOfSubscription(active);
  const plan = ambiguous ? org.plan : active ? (named ?? org.plan) : 'TRIAL';
  const cancelAt = active?.cancel_at ? new Date(active.cancel_at * 1000) : null;

  await prisma.organisation.update({
    where: { id: org.id },
    data: {
      plan,
      // on ambiguity the id is left as it was: naming one of two is the same
      // invention as naming one of their plans
      ...(ambiguous ? {} : { stripeSubscriptionId: active?.id ?? null }),
      subscriptionCancelAt: ambiguous ? org.subscriptionCancelAt : cancelAt,
    },
  });

  /**
   * Recorded on EVERY change, not only when a subscription is active.
   *
   * The audit line used to sit inside `if (active && …)`, so a cancellation —
   * the change that takes features away, refuses saves and locks a firm out of
   * work mid-task — moved the workspace to TRIAL with no trace of when or why.
   * `provenance-sweep` exempts `billing.checkout` on the express grounds that
   * "billing.sync records it when it arrives"; that was only half true.
   *
   * The ambiguity is recorded too, and it has to be: it is the one outcome
   * where nothing changed BECAUSE something is wrong, and a reader looking for
   * why their plan is not moving has nowhere else to find out.
   */
  const changed = org.plan !== plan;
  const cancellationChanged = (org.subscriptionCancelAt?.getTime() ?? 0) !== (cancelAt?.getTime() ?? 0);
  if (changed || cancellationChanged || ambiguous) {
    const anyDeal = await prisma.deal.findFirst({ where: { orgId: org.id }, select: { id: true } });
    if (anyDeal) {
      await prisma.activityEvent.create({
        data: {
          orgId: org.id,
          dealId: anyDeal.id,
          actor: 'Stripe',
          action: ambiguous
            ? 'subscription needs attention'
            : !active
              ? 'subscription ended'
              : changed
                ? 'subscription active'
                : cancelAt
                  ? 'subscription cancellation scheduled'
                  : 'subscription cancellation withdrawn',
          target: ambiguous
            ? `${live.length} live subscriptions on one customer — plan left on ${org.plan}`
            : !active
              ? `${org.plan} plan ended — workspace on TRIAL`
              : changed
                ? `${plan} plan`
                : cancelAt
                  ? `${plan} plan ends ${cancelAt.toISOString().slice(0, 10)}`
                  : `${plan} plan continues`,
        },
      });
    }
  }

  return { plan, cancelAt, ambiguous };
}

/**
 * The ONE live subscription to act on, or why there is not one.
 *
 * `changePlan` and `cancelPlan` both need it and both must refuse rather than
 * pick: changing the price of one of two subscriptions leaves the other billing
 * at the old plan, which is the defect they exist to end, made worse by being
 * half-fixed.
 */
export async function soleSubscription(
  prisma: PrismaClient,
  orgId: string,
): Promise<{ sub: StripeSubscription; itemId: string } | { reason: 'none' | 'several'; count: number }> {
  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  if (!org?.stripeCustomerId) return { reason: 'none', count: 0 };
  const live = await activeSubscriptions(org.stripeCustomerId);
  if (live.length !== 1) return { reason: live.length === 0 ? 'none' : 'several', count: live.length };
  const sub = live[0]!;
  const itemId = sub.items?.data?.[0]?.id;
  // a subscription with no item has no price to change; Stripe does not make
  // them, so this is a shape we were handed rather than a case to design for
  if (!itemId) return { reason: 'none', count: 1 };
  return { sub, itemId };
}
