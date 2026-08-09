import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { anonymous, callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The audit trail, tested against the questions it exists to answer: who signed
 * in, who failed to, and who was locked out — the ones an insurer or a lender's
 * credit committee asks after something has gone wrong.
 */

let T: Tenant;
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Audit');
  await prisma.user.update({ where: { id: T.userId }, data: { password: hashPassword(PASSWORD) } });
}, 120_000);

const events = (action: string) =>
  prisma.activityEvent.findMany({ where: { orgId: T.orgId, action }, orderBy: { at: 'desc' } });

const emailOf = async () => (await prisma.user.findUniqueOrThrow({ where: { id: T.userId } })).email;

describe('authentication is on the record', () => {
  it('records a sign-in against an immutable user id, not just a name', async () => {
    const email = await emailOf();
    await anonymous().auth.login({ email, password: PASSWORD } as never);

    const [signIn] = await events('signed in');
    expect(signIn).toBeTruthy();
    expect(signIn!.userId).toBe(T.userId);
    expect(signIn!.dealId).toBeNull(); // a sign-in belongs to no deal

    // the display name is a snapshot, so renaming the user must not orphan the
    // event — this is the whole reason userId exists
    await prisma.user.update({ where: { id: T.userId }, data: { name: 'Renamed Person' } });
    const [after] = await events('signed in');
    expect(after!.userId).toBe(T.userId);
    expect(after!.actor).toBe('Audit Owner'); // as it stood at the time
  });

  it('records a failed attempt against the firm whose account was targeted', async () => {
    const email = await emailOf();
    await expect(anonymous().auth.login({ email, password: 'wrong' } as never)).rejects.toThrow();

    const [failed] = await events('failed sign-in');
    expect(failed).toBeTruthy();
    expect(failed!.orgId).toBe(T.orgId);
    expect(failed!.userId).toBe(T.userId);
  });

  it('files nothing for an address that has no account', async () => {
    const before = await prisma.activityEvent.count();
    await expect(
      anonymous().auth.login({ email: 'stranger@nowhere.test', password: 'wrong' } as never),
    ).rejects.toThrow();
    // nowhere to file it, and inventing a home would fill some workspace with
    // noise about people who have never had an account
    expect(await prisma.activityEvent.count()).toBe(before);
  });

  it('records a password reset end to end', async () => {
    const email = await emailOf();
    await anonymous().auth.requestPasswordReset({ email } as never);
    expect(await events('requested a password reset')).toHaveLength(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: T.userId } });
    expect(user.resetTokenHash).toBeTruthy();
  });
});

describe('the trail is evidence, not a feed', () => {
  it('exposes no way to alter or remove an event', async () => {
    // append-only is the property that makes it worth anything: if the audited
    // party can edit the record, the record proves nothing
    const caller = callerFor(T.principal) as unknown as Record<string, Record<string, unknown>>;
    const surfaces = Object.keys(caller);
    const mutators = surfaces.flatMap((r) =>
      Object.keys(caller[r] ?? {})
        .filter((p) => /(^|\b)(delete|update|edit|remove)/i.test(p) && /audit|activity|event/i.test(`${r}.${p}`))
        .map((p) => `${r}.${p}`),
    );
    expect(mutators).toEqual([]);
  });

  it('reads back for an admin, org-level events included', async () => {
    const log = await callerFor({ ...T.principal, role: 'ADMIN' }).org.auditLog({ limit: 50 } as never);
    const signIn = (log as Array<{ action: string; dealName: string | null }>).find((e) => e.action === 'signed in');
    expect(signIn).toBeTruthy();
    // no deal, and the reader is told so rather than shown a broken name
    expect(signIn!.dealName).toBeNull();
  });
});
