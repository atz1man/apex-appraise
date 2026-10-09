import type { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { APP_URL } from '../email.js';
import { PLANS, ensurePrice, stripeConfigured, stripeFetch, stripePublishableKey } from '../stripe.js';
import { assertExclusiveStripeCustomer, assertStripeCustomerOpen, liveSubscriptions, planLookupKey, reconcileSubscription, soleSubscription } from '../billing.js';
import { recordAudit } from '../audit.js';
import { adminProcedure, authedProcedure, internalProcedure, router } from '../trpc.js';
import { usageFor } from '../entitlements.js';
import { trialStateOf } from '../trial.js';

/** Admin-only guard on top of internal. */

/**
 * The one live subscription to act on, or a refusal naming why there is not one.
 *
 * `changePlan`, `cancelPlan` and `resumePlan` all need it and all must refuse
 * rather than pick: acting on one of two leaves the other billing at the old
 * plan, which is the defect they exist to end, made worse by being half-fixed.
 */
async function theSubscription(prisma: PrismaClient, orgId: string) {
  if (!stripeConfigured()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Stripe is not configured on this server' });
  const found = await soleSubscription(prisma, orgId);
  if ('reason' in found) {
    throw new TRPCError({
      code: found.reason === 'none' ? 'PRECONDITION_FAILED' : 'CONFLICT',
      message:
        found.reason === 'none'
          ? 'There is no active subscription on this workspace. Subscribe to a plan first.'
          : `This workspace has ${found.count} live subscriptions in Stripe and is being billed for each. `
            + 'Acting on one would leave the others on their old plans — contact support to have the duplicates cancelled first.',
    });
  }
  return { id: found.sub.id, itemId: found.itemId, sub: found.sub };
}

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
      /**
       * Whether there is something to CHANGE as opposed to something to buy.
       * Without it the panel could only offer Checkout, and a second Checkout
       * against a customer who already subscribes is a second subscription.
       */
      subscribed: !!org?.stripeSubscriptionId,
      hasCustomer: !!org?.stripeCustomerId,
      paymentStatus: org?.subscriptionStatus ?? null,
      /**
       * A cancellation already scheduled. Read off the row rather than from
       * Stripe, so opening Settings does not cost a Stripe call per view —
       * `reconcileSubscription` is what keeps it true.
       */
      cancelAt: org?.subscriptionCancelAt ?? null,
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
      // A disabled Subscribe button is not a server-side guard. A stale tab
      // or direct call must not create a second paid subscription.
      if (org.stripeCustomerId) await assertExclusiveStripeCustomer(ctx.prisma, org.stripeCustomerId, org.id);
      if (org.stripeSubscriptionId || (org.stripeCustomerId && (await liveSubscriptions(org.stripeCustomerId)).length)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This workspace already has a subscription. Change its plan in Billing instead.' });
      }
      const plan = PLANS.find((p) => p.key === input.plan)!;

      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeFetch<{ id: string }>('/customers', {
          name: org.name,
          'metadata[orgId]': org.id,
        }, 'POST', `apex-customer-${org.id}`);
        customerId = customer.id;
        await ctx.prisma.organisation.update({ where: { id: org.id }, data: { stripeCustomerId: customerId } });
      }

      await assertStripeCustomerOpen(customerId);
      const sessions = await stripeFetch<{ data: Array<{ id: string; status: string; mode: string; url: string | null; metadata?: { plan?: string } }> }>(
        '/checkout/sessions', { customer: customerId, limit: '100' }, 'GET',
      );
      const previous = sessions.data.filter(s => s.mode === 'subscription')[0];
      const open = sessions.data.find(s => s.mode === 'subscription' && s.status === 'open');
      if (open) {
        if (open.metadata?.plan !== plan.key || !open.url) throw new TRPCError({
          code: 'CONFLICT', message: 'An unfinished checkout already exists for this workspace. Complete that checkout or wait for it to expire before choosing another plan.',
        });
        return { url: open.url };
      }
      // A completion can arrive between the first subscription check and this
      // session read. Recheck before allowing a replacement session.
      if ((await liveSubscriptions(customerId)).length) throw new TRPCError({
        code: 'CONFLICT', message: 'This workspace already has a subscription. Change its plan in Billing instead.',
      });
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
      }, 'POST', `apex-checkout-${org.id}-${previous?.id ?? 'first'}`);
      return { url: session.url };
    }),

  /**
   * Pull the subscription state from Stripe and reflect it on the workspace.
   * Called after Checkout returns (and safe to call any time) — no webhook
   * dependency for the tunnel/dev setup.
   */
  sync: internalProcedure.mutation(({ ctx }) => reconcileSubscription(ctx.prisma, ctx.principal.orgId)),

  /** Stripe hosts payment-method updates and invoice history, including after a failed payment. */
  paymentPortal: adminProcedure.mutation(async ({ ctx }) => {
    if (!stripeConfigured()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Stripe is not configured on this server' });
    const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
    if (!org?.stripeCustomerId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Subscribe to a plan before managing payment details.' });
    await assertExclusiveStripeCustomer(ctx.prisma, org.stripeCustomerId, org.id);
    await assertStripeCustomerOpen(org.stripeCustomerId);
    // Never accept a customer ID or return URL from the browser.
    const session = await stripeFetch<{ url: string }>('/billing_portal/sessions', {
      customer: org.stripeCustomerId,
      return_url: `${APP_URL()}/settings?billing=success`,
    });
    await recordAudit(ctx.prisma, {
      orgId: org.id, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: 'opened billing management', target: 'Stripe payment details and invoices', ip: ctx.ip,
    });
    return { url: session.url };
  }),

  /**
   * Move an existing subscription to another plan, in place.
   *
   * What this replaces: the panel's "Switch plan" called `billing.checkout`,
   * which opens a Checkout session in `mode: subscription`. Stripe does exactly
   * what that asks — it creates ANOTHER subscription against the same customer
   * and cancels nothing — so switching plan left the firm paying for both, and
   * `billing.sync` then ran the workspace at whichever one Stripe listed first.
   * There was no sign of it anywhere in this product: the panel showed one
   * CURRENT chip, and the second charge appeared on a card statement.
   *
   * Changing the ITEM's price is the one-subscription way to do it, and it is
   * also the only way to get proration right: Stripe credits the unused part of
   * the old plan against the new one, where two subscriptions bill in full.
   *
   * It REFUSES rather than picks when there are several live subscriptions —
   * changing one of two leaves the other billing at the old plan, which is the
   * defect this exists to end, made worse by being half-fixed. A firm already
   * in that state gets a message that says so, which is the first time this
   * product has ever mentioned it.
   */
  changePlan: adminProcedure
    .input(z.object({ plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']) }))
    .mutation(async ({ ctx, input }) => {
      const found = await theSubscription(ctx.prisma, ctx.principal.orgId);
      const plan = PLANS.find((p) => p.key === input.plan)!;
      const already = found.sub.items?.data?.[0]?.price?.lookup_key === planLookupKey(plan.key);
      if (already && found.sub.cancel_at_period_end) {
        await stripeFetch(`/subscriptions/${found.id}`, { cancel_at_period_end: 'false' });
      }
      if (!already) {
        const priceId = await ensurePrice(plan);
        await stripeFetch(`/subscriptions/${found.id}`, {
          'items[0][id]': found.itemId,
          'items[0][price]': priceId,
          // the unused part of the old plan is credited against the new one.
          // Two subscriptions billed in full, which is what the old path did.
          proration_behavior: 'create_prorations',
          /**
           * Choosing a plan is a statement of intent to keep paying, so it
           * withdraws a cancellation that had been scheduled. The alternative —
           * switch plan and still stop at the end of the month — is a state
           * nobody asks for and nothing in the panel could have explained.
           */
          cancel_at_period_end: 'false',
          'metadata[plan]': plan.key,
        });
      }
      await recordAudit(ctx.prisma, {
        orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
        action: already && found.sub.cancel_at_period_end ? 'withdrew the subscription cancellation' : already ? 'confirmed the subscription plan' : 'changed the subscription plan',
        target: `${plan.name} (£${(plan.pricePencePerMonth / 100).toLocaleString('en-GB')}/mo)`, ip: ctx.ip,
      });
      return reconcileSubscription(ctx.prisma, ctx.principal.orgId);
    }),

  /**
   * Stop paying, and change your mind about stopping.
   *
   * There was no way to cancel at all. The Terms this product asks a customer
   * to accept say the subscription can be cancelled at any time; the only
   * control that existed was Subscribe. A firm that wanted to leave had to ask
   * us to do it in the Stripe dashboard, which is not a product feature, and
   * `org.deleteWorkspace` — the GDPR erasure — was the only thing in the app
   * that stopped the billing, by destroying the firm's records to do it.
   *
   * At the END OF THE PERIOD, not immediately, and that is the substance of the
   * decision rather than a default: the period is paid for. Cancelling on the
   * spot would take away features the firm has already bought, in the middle of
   * work, and the refund question would then be ours to answer by hand.
   *
   * TWO procedures rather than one taking a boolean, and the reason is the web
   * sweep: `destructive` reads a verb out of the procedure NAME, so a single
   * `cancelPlan({ cancel })` made the undo button look like a cancellation that
   * asked nobody first. A name that carries the direction needs no matcher
   * cleverness to read the argument, and `benchmarks.optIn`/`optOut` and
   * `org.saveSso`/`deleteSso` are the same shape already.
   */
  cancelPlan: adminProcedure.mutation(async ({ ctx }) => {
    const sub = await theSubscription(ctx.prisma, ctx.principal.orgId);
    await stripeFetch(`/subscriptions/${sub.id}`, { cancel_at_period_end: 'true' });
    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: 'cancelled the subscription', target: 'ends at the end of the paid period', ip: ctx.ip,
    });
    return reconcileSubscription(ctx.prisma, ctx.principal.orgId);
  }),

  /**
   * Withdraw a cancellation that has not taken effect yet.
   *
   * Until the date arrives nothing has happened, so a mis-click should not cost
   * a subscription — the same reasoning as `org.resumeWebhook`, and one field in
   * Stripe either way.
   */
  resumePlan: adminProcedure.mutation(async ({ ctx }) => {
    const sub = await theSubscription(ctx.prisma, ctx.principal.orgId);
    await stripeFetch(`/subscriptions/${sub.id}`, { cancel_at_period_end: 'false' });
    await recordAudit(ctx.prisma, {
      orgId: ctx.principal.orgId, userId: ctx.principal.userId, actor: ctx.principal.name,
      action: 'withdrew the subscription cancellation', target: 'billing continues', ip: ctx.ip,
    });
    return reconcileSubscription(ctx.prisma, ctx.principal.orgId);
  }),
});
