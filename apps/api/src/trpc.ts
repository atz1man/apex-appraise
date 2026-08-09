import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

/** Any authenticated principal (internal, buyer or investor). */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.principal) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, principal: ctx.principal } });
});

/** Internal team only — portals must never reach these procedures. */
export const internalProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.principal.principalType !== 'internal') throw new TRPCError({ code: 'FORBIDDEN' });
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
