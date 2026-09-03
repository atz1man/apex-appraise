import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { APP_URL } from '../email.js';
import { PLANS, ensurePrice, stripeConfigured, stripeFetch, stripePublishableKey } from '../stripe.js';
import { adminProcedure, authedProcedure, internalProcedure, router } from '../trpc.js';
import { usageFor } from '../entitlements.js';
import { trialStateOf } from '../trial.js';

/** Admin-only guard on top of internal. */

export const billingRouter = router({
  /** Publishable key + plan catalogue + this workspace's current plan. */
  config: authedProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
    return {
      configured: stripeConfigured(),
      publishableKey: stripePublishableKey(),
      mode: stripePublishableKey()?.startsWith('pk_test') ? ('test' as const) : ('live' as const),
      plan: org?.plan ?? 'TRIAL',
      plans: PLANS,
      // the clock, so the UI can say how long is left instead of the customer
      // finding out when a save is refused
      trial: org ? trialStateOf(org) : { endsAt: null, expired: false, daysLeft: null },
      // what the workspace has used against what it may use — so the UI can warn
      // before someone hits a wall mid-task rather than after
      usage: await usageFor(ctx.prisma, ctx.principal.orgId, org?.plan ?? 'TRIAL'),
    };
  }),

  /** Hosted Stripe Checkout for a subscription — returns the redirect URL. */
  checkout: adminProcedure
    .input(z.object({ plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']) }))
    .mutation(async ({ ctx, input }) => {
      if (!stripeConfigured()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Stripe is not configured on this server' });
      const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
      const plan = PLANS.find((p) => p.key === input.plan)!;

      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeFetch<{ id: string }>('/customers', {
          name: org.name,
          'metadata[orgId]': org.id,
        });
        customerId = customer.id;
        await ctx.prisma.organisation.update({ where: { id: org.id }, data: { stripeCustomerId: customerId } });
      }

      const priceId = await ensurePrice(plan);
      const session = await stripeFetch<{ id: string; url: string }>('/checkout/sessions', {
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: `${APP_URL()}/settings?billing=success`,
        cancel_url: `${APP_URL()}/settings?billing=cancelled`,
        'metadata[orgId]': org.id,
        'metadata[plan]': plan.key,
        'subscription_data[metadata][orgId]': org.id,
        'subscription_data[metadata][plan]': plan.key,
      });
      return { url: session.url };
    }),

  /**
   * Pull the subscription state from Stripe and reflect it on the workspace.
   * Called after Checkout returns (and safe to call any time) — no webhook
   * dependency for the tunnel/dev setup.
   */
  sync: internalProcedure.mutation(async ({ ctx }) => {
    const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
    if (!org?.stripeCustomerId || !stripeConfigured()) return { plan: org?.plan ?? 'TRIAL' };
    const subs = await stripeFetch<{
      data: Array<{
        id: string;
        status: string;
        metadata?: { plan?: string };
        items?: { data?: Array<{ price?: { lookup_key?: string | null } }> };
      }>;
    }>(`/subscriptions?customer=${org.stripeCustomerId}&status=active&limit=3`, undefined, 'GET');
    const active = subs.data.find((s) => s.status === 'active');

    /**
     * WHICH plan an active subscription is, decided from the subscription
     * rather than guessed.
     *
     * This was: metadata if it names a known plan, otherwise **GROWTH** if any
     * subscription is active. The fallback is a guess about what a customer
     * bought, and it is wrong in both directions. Only `billing.checkout` writes
     * `metadata[plan]`, so a subscription created any other way — in the Stripe
     * dashboard, by support, by an importer, or before that metadata was added
     * — carries none. A firm paying for STARTER was granted GROWTH; a firm
     * paying for ENTERPRISE was cut down to GROWTH and lost features it pays
     * for. Neither shows up as an error anywhere.
     *
     * Nothing needed guessing. `ensurePrice` gives every plan a deterministic
     * `lookup_key` — `apex_starter_monthly`, `apex_growth_monthly`,
     * `apex_enterprise_monthly` — so the PRICE on the subscription says which
     * plan it is, and the price is what the customer actually pays. Read that
     * first, and keep the metadata as the second source for a subscription
     * whose price predates the lookup keys.
     */
    const fromLookupKey = active?.items?.data
      ?.map((i) => PLANS.find((p) => i.price?.lookup_key === `apex_${p.key.toLowerCase()}_monthly`)?.key)
      .find((k): k is (typeof PLANS)[number]['key'] => !!k);
    const fromMetadata = PLANS.find((p) => p.key === active?.metadata?.plan)?.key;
    const named = fromLookupKey ?? fromMetadata;

    /**
     * An active subscription this server cannot identify leaves the plan ALONE.
     *
     * Not GROWTH, and not TRIAL either. We know the customer is paying and do
     * not know for what, so any answer is invented — and inventing one either
     * hands out features nobody bought or takes away features somebody did.
     * Leaving it visible and unchanged is a state a human can act on; a silent
     * wrong tier is not. No active subscription is a different thing entirely:
     * that is Stripe saying nobody is paying, which is TRIAL, and is not a guess.
     */
    const plan = active ? (named ?? org.plan) : 'TRIAL';

    await ctx.prisma.organisation.update({
      where: { id: org.id },
      data: { plan, stripeSubscriptionId: active?.id ?? null },
    });

    /**
     * Recorded on EVERY change, not only when a subscription is active.
     *
     * The audit line was inside `if (active && ...)`, so a cancellation — the
     * change that takes features away, refuses saves and locks a firm out of
     * work mid-task — moved the workspace to TRIAL with no trace of when or
     * why. `provenance-sweep` exempts `billing.checkout` on the express grounds
     * that "billing.sync records it when it arrives"; that was only half true.
     */
    if (org.plan !== plan) {
      const anyDeal = await ctx.prisma.deal.findFirst({ where: { orgId: org.id }, select: { id: true } });
      if (anyDeal) {
        await ctx.prisma.activityEvent.create({
          data: {
            orgId: org.id,
            dealId: anyDeal.id,
            actor: 'Stripe',
            action: active ? 'subscription active' : 'subscription ended',
            target: active ? `${plan} plan` : `${org.plan} plan ended — workspace on TRIAL`,
          },
        });
      }
    }
    return { plan };
  }),
});
