import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { JWT_SECRET } from '../context.js';
import {
  checkLockout,
  hashPassword,
  hashResetToken,
  newResetToken,
  recordFailure,
  recordSuccess,
  tooManyResetRequests,
  verifyPassword,
} from '../auth/password.js';
import { APP_URL, resetEmail, sendMail } from '../email.js';
import { authedProcedure, publicProcedure, router } from '../trpc.js';

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const lock = checkLockout(email);
      if (lock.locked) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Account locked after repeated failures — try again in ${lock.retryAfterMins} min`,
        });
      }
      const user = await ctx.prisma.user.findUnique({ where: { email } });
      if (!user || !verifyPassword(input.password, user.password)) {
        recordFailure(email);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
      recordSuccess(email);
      const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' });
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

  me: authedProcedure.query(({ ctx }) => ctx.principal),

  /**
   * Request a reset link.
   *
   * Always returns the same shape, whether or not the address exists. An endpoint
   * that says "no such user" is an account-enumeration oracle, and for a product
   * whose users are named surveyors at named firms, confirming who holds an
   * account is itself a disclosure.
   */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      if (tooManyResetRequests(email)) return { ok: true };

      const user = await ctx.prisma.user.findUnique({ where: { email } });
      if (user) {
        const { token, hash, expiresAt } = newResetToken();
        await ctx.prisma.user.update({
          where: { id: user.id },
          data: { resetTokenHash: hash, resetTokenExpiresAt: expiresAt },
        });
        const mail = resetEmail(user.name, APP_URL(), token);
        await sendMail(user.email, mail.subject, mail.text);
      }
      return { ok: true };
    }),

  resetPassword: publicProcedure
    .input(z.object({ token: z.string().min(1), password: z.string().min(8, 'Password must be at least 8 characters') }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findFirst({
        where: { resetTokenHash: hashResetToken(input.token), resetTokenExpiresAt: { gt: new Date() } },
      });
      // one message for a bad token and an expired one: distinguishing them tells
      // an attacker which of their guesses was once real
      if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'That reset link is invalid or has expired' });
      }
      await ctx.prisma.user.update({
        where: { id: user.id },
        // cleared in the same write that sets the password: single use is not a
        // policy, it is the absence of a second chance
        data: { password: hashPassword(input.password), resetTokenHash: null, resetTokenExpiresAt: null },
      });
      // a reset is how someone locked out gets back in — leaving the lockout in
      // place would hand them a new password and still refuse the login
      recordSuccess(user.email);
      return { ok: true };
    }),

  changePassword: authedProcedure
    .input(z.object({ current: z.string().min(1), next: z.string().min(8, 'New password must be at least 8 characters') }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({ where: { id: ctx.principal.userId } });
      if (!user || !verifyPassword(input.current, user.password)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
      }
      await ctx.prisma.user.update({ where: { id: user.id }, data: { password: hashPassword(input.next) } });
      return { ok: true };
    }),
});
