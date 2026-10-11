import { beforeAll, describe, expect, it } from 'vitest';
import { anonymous, callerFor, makeTenant, prisma, resetDatabase } from './harness.js';
import { hashPassword, hashResetToken, verifyPassword } from '../src/auth/password.js';

beforeAll(() => resetDatabase());

describe('customer account recovery', () => {
  it('consumes a reset link once when both requests read it before either writes', async () => {
    const tenant = await makeTenant('Reset race');
    const token = 'concurrent-reset-link';
    await prisma.user.update({
      where: { id: tenant.userId },
      data: {
        resetTokenHash: hashResetToken(token),
        resetTokenExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const original = prisma.user.findFirst.bind(prisma.user);
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    prisma.user.findFirst = (async (args: any) => {
      const result = await original(args);
      if (++reads === 2) release();
      await barrier;
      return result;
    }) as typeof prisma.user.findFirst;
    const passwords = ['first-customer-password', 'second-customer-password'];
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        passwords.map((password) => anonymous().auth.resetPassword({ token, password })),
      );
    } finally {
      prisma.user.findFirst = original;
    }
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } });
    expect(verifyPassword(passwords[winner], user.password)).toBe(true);
    expect(user.resetTokenHash).toBeNull();
    await expect(anonymous().auth.resetPassword({ token, password: 'replayed-password' })).rejects.toThrow(
      /invalid or has expired/,
    );
  });

  it('changing the password invalidates previously issued reset links', async () => {
    const tenant = await makeTenant('Changed password');
    const token = 'previous-reset-link';
    await prisma.user.update({
      where: { id: tenant.userId },
      data: {
        password: hashPassword('original-password'),
        resetTokenHash: hashResetToken(token),
        resetTokenExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await callerFor(tenant.principal).auth.changePassword({
      current: 'original-password',
      next: 'new-customer-password',
    });
    await expect(anonymous().auth.resetPassword({ token, password: 'stolen-link-password' })).rejects.toThrow(
      /invalid or has expired/,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: tenant.userId } });
    expect(verifyPassword('new-customer-password', user.password)).toBe(true);
  });
});
