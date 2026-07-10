import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { JWT_SECRET } from '../context.js';
import { checkLockout, hashPassword, recordFailure } from '../auth/password.js';
import { APP_URL, inviteEmail, sendMail, welcomeEmail } from '../email.js';
import { internalProcedure, publicProcedure, router } from '../trpc.js';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('') || 'AA';

/** Admin-only guard on top of internal. */
const adminProcedure = internalProcedure.use(({ ctx, next }) => {
  if (ctx.principal.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  return next({ ctx });
});

const DEFAULT_INTEGRATIONS = [
  'HM Land Registry',
  'EPC Register',
  'PriceHubble AVM',
  'Planning Portal',
  'Ordnance Survey',
  'Environment Agency',
  'BCIS',
  'Xero',
  'DocuSign',
];

export const orgRouter = router({
  /** Self-serve tenant onboarding: new organisation + its first (admin) user. */
  register: publicProcedure
    .input(
      z.object({
        orgName: z.string().min(2).max(80),
        name: z.string().min(2).max(80),
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      // reuse the login throttle so registration can't be hammered either
      const lock = checkLockout(`register:${email}`);
      if (lock.locked) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts — try again later' });
      const existing = await ctx.prisma.user.findUnique({ where: { email } });
      if (existing) {
        recordFailure(`register:${email}`);
        throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists' });
      }
      const org = await ctx.prisma.organisation.create({ data: { name: input.orgName } });
      const user = await ctx.prisma.user.create({
        data: {
          orgId: org.id,
          email,
          password: hashPassword(input.password),
          name: input.name,
          role: 'ADMIN',
          principalType: 'internal',
          initials: initialsOf(input.name),
        },
      });
      // every workspace starts with the connector catalogue available
      for (const provider of DEFAULT_INTEGRATIONS) {
        await ctx.prisma.integrationConnection.create({ data: { orgId: org.id, provider, status: 'NOT_CONNECTED' } });
      }
      const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' });
      const welcome = welcomeEmail(user.name, org.name, APP_URL());
      void sendMail(email, welcome.subject, welcome.text);
      return {
        token,
        principal: {
          userId: user.id,
          name: user.name,
          initials: user.initials,
          role: user.role,
          principalType: user.principalType,
        },
      };
    }),

  get: internalProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
    if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
    const [deals, users, investors] = await Promise.all([
      ctx.prisma.deal.count({ where: { orgId: org.id } }),
      ctx.prisma.user.count({ where: { orgId: org.id, principalType: 'internal' } }),
      ctx.prisma.investor.count({ where: { orgId: org.id } }),
    ]);
    return { id: org.id, name: org.name, createdAt: org.createdAt, counts: { deals, users, investors } };
  }),

  update: adminProcedure
    .input(z.object({ name: z.string().min(2).max(80) }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.organisation.update({ where: { id: ctx.principal.orgId }, data: { name: input.name } }),
    ),

  members: internalProcedure.query(({ ctx }) =>
    ctx.prisma.user.findMany({
      where: { orgId: ctx.principal.orgId, principalType: 'internal' },
      select: { id: true, name: true, email: true, initials: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ),

  /**
   * Invite a teammate: creates the account with a one-time temporary password,
   * returned exactly once for the admin to hand over. (Email delivery slots in here
   * in production.)
   */
  invite: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(80),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'ANALYST', 'SURVEYOR', 'VIEWER']).default('ANALYST'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const existing = await ctx.prisma.user.findUnique({ where: { email } });
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists' });
      const tempPassword = randomBytes(6).toString('base64url');
      await ctx.prisma.user.create({
        data: {
          orgId: ctx.principal.orgId,
          email,
          password: hashPassword(tempPassword),
          name: input.name,
          role: input.role,
          principalType: 'internal',
          initials: initialsOf(input.name),
        },
      });
      const org = await ctx.prisma.organisation.findUnique({ where: { id: ctx.principal.orgId } });
      const mail = inviteEmail(input.name, org?.name ?? 'your team', email, tempPassword, APP_URL());
      const { emailed } = await sendMail(email, mail.subject, mail.text);
      return { tempPassword, emailed };
    }),

  setRole: adminProcedure
    .input(z.object({ userId: z.string(), role: z.enum(['ADMIN', 'ANALYST', 'SURVEYOR', 'VIEWER']) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findFirst({
        where: { id: input.userId, orgId: ctx.principal.orgId, principalType: 'internal' },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
      if (user.id === ctx.principal.userId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot change your own role' });
      return ctx.prisma.user.update({
        where: { id: user.id },
        data: { role: input.role },
        select: { id: true, role: true },
      });
    }),
});
