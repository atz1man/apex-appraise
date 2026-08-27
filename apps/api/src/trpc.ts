import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context.js';
import { assertTrialLive } from './trial.js';
import { assertFeature, type Feature } from './entitlements.js';

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

/** Any authenticated principal (internal, buyer or investor). */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.principal) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, principal: ctx.principal } });
});

/**
 * Internal team only — portals must never reach these procedures.
 *
 * This is also where a lapsed trial stops. On the MUTATIONS only: an expired
 * workspace stays fully readable, exportable and printable, and only loses the
 * ability to write. Enforced here rather than in each router because a rule
 * repeated in forty places is forty chances to forget it — and the one that gets
 * forgotten is always the one that mattered.
 *
 * IF YOU ADD A RULE HERE, ADD IT TO src/http-guards.ts TOO. The upload routes are
 * plain Fastify and cannot use this chain; internalWriter() is their copy of it.
 * They have already fallen out of this middleware twice — once for the session
 * cutoff, once for the trial — and both times it was invisible because there was
 * nowhere the two could be compared. test/trial.test.ts fails if an upload route
 * stops asking.
 */
export const internalProcedure = authedProcedure.use(async ({ ctx, next, type, path }) => {
  if (ctx.principal.principalType !== 'internal') throw new TRPCError({ code: 'FORBIDDEN' });
  if (type === 'mutation') await assertTrialLive(ctx.prisma, ctx.principal.orgId, path);
  return next({ ctx });
});

/** Investor portal only. */
/**
 * ADMIN-only. Defined ONCE: this guard was copied into two routers, and a
 * permission check that exists in several places is one edit away from meaning
 * different things in each.
 */
export const adminProcedure = internalProcedure.use(({ ctx, next }) => {
  if (ctx.principal.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  return next({ ctx });
});

export const investorProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.principal.principalType !== 'investor') throw new TRPCError({ code: 'FORBIDDEN' });
  return next({ ctx });
});

/** Buyer portal only. */
export const buyerProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.principal.principalType !== 'buyer') throw new TRPCError({ code: 'FORBIDDEN' });
  return next({ ctx });
});

/**
 * A capability the plan has to include.
 *
 * A middleware factory rather than a fourth procedure in the chain, because the
 * gated procedures sit at two different levels — benchmarking is any internal
 * user, minting an API key is an admin — and a feature is orthogonal to both.
 * Compose it: `internalProcedure.use(requiresFeature('benchmarking'))`,
 * `adminProcedure.use(requiresFeature('publicApi'))`.
 *
 * Queries are gated as well as mutations, unlike the trial rule above. A lapsed
 * trial keeps its data readable because the data is the customer's; a plan that
 * does not include benchmarking does not include READING the benchmarks, because
 * the reading IS the feature.
 */
export const requiresFeature = (feature: Feature) =>
  t.middleware(async ({ ctx, next }) => {
    // a free-standing middleware starts from the bare Context, so the principal
    // is re-narrowed and passed on — otherwise every procedure downstream of this
    // one loses the narrowing its own chain had already done
    const principal = ctx.principal;
    if (!principal) throw new TRPCError({ code: 'UNAUTHORIZED' });
    await assertFeature(ctx.prisma, principal.orgId, feature);
    return next({ ctx: { ...ctx, principal } });
  });
