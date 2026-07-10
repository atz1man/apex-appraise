import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { APP_URL } from '../email.js';
import { PLANS, ensurePrice, stripeConfigured, stripeFetch, stripePublishableKey } from '../stripe.js';
import { authedProcedure, internalProcedure, router } from '../trpc.js';

/** Admin-only guard on top of internal. */
const adminProcedure = internalProcedure.use(({ ctx, next }) => {
  if (ctx.principal.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  return next({ ctx });
});

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
    const subs = await stripeFetch<{ data: Array<{ id: string; status: string; metadata?: { plan?: string } }> }>(
      `/subscriptions?customer=${org.stripeCustomerId}&status=active&limit=3`,
      undefined,
      'GET',
    );
    const active = subs.data.find((s) => s.status === 'active');
    const plan = active?.metadata?.plan && PLANS.some((p) => p.key === active.metadata!.plan) ? active.metadata!.plan : active ? 'GROWTH' : 'TRIAL';
    await ctx.prisma.organisation.update({
      where: { id: org.id },
      data: { plan, stripeSubscriptionId: active?.id ?? null },
    });
    if (active && org.plan !== plan) {
      const anyDeal = await ctx.prisma.deal.findFirst({ where: { orgId: org.id }, select: { id: true } });
      if (anyDeal) {
        await ctx.prisma.activityEvent.create({
          data: { orgId: org.id, dealId: anyDeal.id, actor: 'Stripe', action: 'subscription active', target: `${plan} plan` },
        });
      }
    }
    return { plan };
  }),
});
