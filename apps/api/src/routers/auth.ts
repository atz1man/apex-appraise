import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { JWT_SECRET } from '../context.js';
import { authedProcedure, publicProcedure, router } from '../trpc.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user || user.password !== hash(input.password)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
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
});
