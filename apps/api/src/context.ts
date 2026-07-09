import { PrismaClient } from '@prisma/client';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import jwt from 'jsonwebtoken';

export const prisma = new PrismaClient();

export const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return secret ?? 'apex-dev-secret-change-in-prod';
})();

export interface Principal {
  userId: string;
  orgId: string;
  principalType: 'internal' | 'buyer' | 'investor';
  role: string;
  name: string;
  initials: string;
  investorId: string | null;
  buyerUnitId: string | null;
}

export async function createContext({ req }: CreateFastifyContextOptions) {
  let principal: Principal | null = null;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { sub: string };
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) {
        principal = {
          userId: user.id,
          orgId: user.orgId,
          principalType: user.principalType as Principal['principalType'],
          role: user.role,
          name: user.name,
          initials: user.initials,
          investorId: user.investorId,
          buyerUnitId: user.buyerUnitId,
        };
      }
    } catch {
      principal = null;
    }
  }
  return { prisma, principal };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
