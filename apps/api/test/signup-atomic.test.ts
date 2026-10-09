import { beforeAll, describe, expect, it } from 'vitest';
import { anonymous, prisma, resetDatabase } from './harness.js';

beforeAll(() => resetDatabase());
const signup = (email: string) => anonymous().org.register({
  orgName: 'New customer', name: 'Customer Owner', email, password: 'a-long-test-password',
});

describe('signup creates one complete workspace', () => {
  it('starts a private trial with an admin and the connector catalogue', async () => {
    const result = await signup('new@customer.test');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new@customer.test' } });
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: user.orgId } });
    expect(result.principal).toMatchObject({ userId: user.id, role: 'ADMIN' });
    expect(org.plan).toBe('TRIAL');
    expect(org.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.integrationConnection.count({ where: { orgId: org.id } })).toBe(10);
    expect(await prisma.deal.count({ where: { orgId: org.id } })).toBe(0);
  });
  it('rolls back the losing workspace when simultaneous signups use one email', async () => {
    const before = await prisma.organisation.count();
    const results = await Promise.allSettled([signup('race@customer.test'), signup('race@customer.test')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.organisation.count()).toBe(before + 1);
    expect(await prisma.user.count({ where: { email: 'race@customer.test' } })).toBe(1);
  });
  it('adds nothing for an already registered address', async () => {
    const before = await prisma.organisation.count();
    await expect(signup('new@customer.test')).rejects.toThrow(/already exists/);
    expect(await prisma.organisation.count()).toBe(before);
  });
});
