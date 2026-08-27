import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mailboxEnabled, readMailbox, sendMail } from '../src/email.js';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The mailbox a demo instance keeps in memory.
 *
 * It holds what would have been emailed when no SMTP is configured, because
 * otherwise an invite or a reset link goes to a console nobody reads and those
 * flows cannot be tried or tested.
 *
 * Three things were wrong at once, and only together did they matter:
 *
 *   it turned itself on whenever SMTP_URL was unset — the exact hazard
 *   demo-mode.ts describes, since a firm that has deployed and not got to SMTP
 *   yet is in that state on day one, and this holds reset links;
 *
 *   the array is process-wide, not per-workspace;
 *
 *   and the procedure that read it was open to any internal user.
 *
 * So on a real multi-tenant deployment with SMTP unset, any analyst in any
 * workspace could read the password-reset link for anyone in any other
 * workspace, and take the account. Each of the three tested below on its own.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Mailbox');
  B = await makeTenant('Neighbour');
}, 120_000);

const env = { ...process.env };
afterEach(() => {
  for (const k of ['NODE_ENV', 'DEMO_MODE', 'SMTP_URL']) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

const admin = (t: Tenant) => callerFor({ ...t.principal, role: 'ADMIN' });
const analyst = (t: Tenant) => callerFor({ ...t.principal, role: 'ANALYST' });

describe('when it is on at all', () => {
  it('is off in production that has not opted in, even with no SMTP', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    delete process.env.SMTP_URL;

    expect(mailboxEnabled()).toBe(false);
    // and nothing is RECORDED either, so turning demo mode on later cannot
    // reveal a backlog of reset links collected while nobody was looking
    await sendMail(A.orgId, 'someone@firm.test', 'Reset your password', 'https://app/reset?token=secret-abc');
    process.env.DEMO_MODE = '1';
    expect(readMailbox(A.orgId).some((m) => m.text.includes('secret-abc'))).toBe(false);
  });

  it('is off whenever real email is configured, demo mode or not', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = '1';
    process.env.SMTP_URL = 'smtp://user:pass@smtp.example.test:587';
    expect(mailboxEnabled()).toBe(false);
    expect(readMailbox(A.orgId)).toEqual([]);
  });

  it('is on for a demo instance, which is the whole point', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = '1';
    delete process.env.SMTP_URL;
    expect(mailboxEnabled()).toBe(true);

    await sendMail(A.orgId, 'invitee@firm.test', 'You have been invited', 'temporary password: abc123');
    expect(readMailbox(A.orgId).some((m) => m.text.includes('abc123'))).toBe(true);
  });
});

describe('whose messages it hands back', () => {
  it('shows a workspace its own and never a neighbour’s', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SMTP_URL;

    await sendMail(A.orgId, 'a@firm.test', 'Reset your password', 'https://app/reset?token=alpha-token');
    await sendMail(B.orgId, 'b@rival.test', 'Reset your password', 'https://app/reset?token=beta-token');

    const mine = readMailbox(A.orgId);
    expect(mine.some((m) => m.text.includes('alpha-token'))).toBe(true);
    // the account-takeover path: a reset link belonging to another firm
    expect(mine.some((m) => m.text.includes('beta-token'))).toBe(false);
    expect(readMailbox(B.orgId).some((m) => m.text.includes('alpha-token'))).toBe(false);
  });

  it('scopes the procedure the same way', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SMTP_URL;
    await sendMail(B.orgId, 'b2@rival.test', 'Reset your password', 'https://app/reset?token=gamma-token');

    const box = (await admin(A).org.demoMailbox()) as { enabled: boolean; messages: Array<{ text: string }> };
    expect(box.enabled).toBe(true);
    expect(JSON.stringify(box.messages)).not.toContain('gamma-token');
  });
});

describe('who may read it', () => {
  it('is admin only — a reset link is a credential', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SMTP_URL;
    await expectDenied('analyst reading the mailbox', () => analyst(A).org.demoMailbox());
  });

  it('is not reachable without a session', async () => {
    const { anonymous } = await import('./harness.js');
    await expectDenied('anonymous reading the mailbox', () => anonymous().org.demoMailbox());
  });
});

describe('what still happens when it is off', () => {
  it('logs, so an operator can find what would have been sent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    delete process.env.SMTP_URL;

    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      const res = await sendMail(A.orgId, 'nobody@firm.test', 'Welcome', 'body');
      // a deployment with neither SMTP nor demo mode is misconfigured rather
      // than malicious; silence would leave nothing to diagnose it with
      expect(res.emailed).toBe(false);
      expect(lines.join('\n')).toContain('nobody@firm.test');
    } finally {
      console.log = original;
    }
    expect(prisma).toBeTruthy();
  });
});
