import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context.js';
import { assertTrialLive } from './trial.js';

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
