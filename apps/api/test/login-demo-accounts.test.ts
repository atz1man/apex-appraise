import { beforeAll, describe, expect, it } from 'vitest';
import { anonymous, prisma, resetDatabase } from './harness.js';
import { DEMO_ACCOUNTS } from '../src/routers/auth.js';

/**
 * The login page offers a demo login only where that login exists.
 *
 * `prisma/seed.ts` refuses to create the demo accounts in production unless
 * asked out loud, because a live system once shipped with three known
 * passwords reachable from the internet. The login page undid half of that:
 * it listed the three accounts under "password 'demo'" and arrived with the
 * demo founder's email and that password already typed, on every deployment.
 * The offer now follows the accounts.
 */
beforeAll(() => {
  resetDatabase();
});

describe('auth.demoAccounts', () => {
  it('offers nothing on a workspace the seed never touched', async () => {
    expect(await anonymous().auth.demoAccounts()).toEqual([]);
  });

  it('offers exactly the demo logins that exist, in the order the page lists them', async () => {
    const org = await prisma.organisation.create({ data: { name: 'Demo Developments', plan: 'TRIAL' } });
    const mk = (email: string, type: string) =>
      prisma.user.create({ data: { orgId: org.id, email, password: 'x', name: email, initials: 'DD', role: 'VIEWER', principalType: type } });
    await mk(DEMO_ACCOUNTS[2].email, 'buyer');
    let offered = await anonymous().auth.demoAccounts();
    expect(offered.map((a) => a.email)).toEqual([DEMO_ACCOUNTS[2].email]);

    await mk(DEMO_ACCOUNTS[0].email, 'internal');
    offered = await anonymous().auth.demoAccounts();
    expect(offered.map((a) => a.email)).toEqual([DEMO_ACCOUNTS[0].email, DEMO_ACCOUNTS[2].email]);
    // the page needs a label and a line for each, and never a password
    for (const a of offered) {
      expect(a.label).toBeTruthy();
      expect(a.blurb).toBeTruthy();
      expect(JSON.stringify(a)).not.toMatch(/password|demo"/i);
    }
  });

  it('is not a way to ask whether any other address has an account', async () => {
    await prisma.user.create({
      data: { orgId: (await prisma.organisation.findFirstOrThrow()).id, email: 'someone@real-firm.co.uk', password: 'x', name: 'S', initials: 'SS', role: 'ADMIN', principalType: 'internal' },
    });
    const offered = await anonymous().auth.demoAccounts();
    expect(offered.map((a) => a.email)).not.toContain('someone@real-firm.co.uk');
  });
});
