import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { JWT_SECRET } from '../context.js';
import { checkLockout, hashPassword, recordFailure, recordSuccess, verifyPassword } from '../auth/password.js';
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
