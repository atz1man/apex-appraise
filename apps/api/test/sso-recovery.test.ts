import { beforeAll, describe, expect, it } from 'vitest';
import { anonymous, callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
import { formatRecoveryCode, hashRecoveryCode, matchRecoveryCode, newRecoveryCodes, normaliseRecoveryCode } from '../src/auth/sso-recovery.js';

/**
 * A firm locked out of its own workspace can get back in.
 *
 * `sso-enforcement.test.ts` beside this one pins the precondition: enforcement
 * cannot be switched on until somebody has signed in through the connection, so
 * a firm cannot ARRIVE at a lockout on a configuration nobody has tested. That
 * commit said what it did not reach, and this is it — three causes the
 * precondition cannot touch, because each happens after the save:
 *
 *   the issuer or client id is edited on an already-enforced connection;
 *   the signing certificate expires;
 *   the identity provider is simply down.
 *
 * No precondition can help with any of them. An IdP that worked this morning
 * passes every check there is, and an issuer edit is indistinguishable from a
 * legitimate migration to a new provider. The answer is a recovery path, and
 * until this landed the answer was the platform operator editing `enforced` in
 * the database — which is not a product, it is a phone number.
 *
 * NOT drivable from the browser suite, which is why the claim lives here:
 * reaching the state needs a workspace whose SSO is enforced and whose provider
 * cannot be contacted, and the only honest way to get there is to write the rows
 * and call the procedure. `e2e/sso-recovery.spec.ts` drives the two screens.
 */

let T: Tenant;
let other: Tenant;
const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

const CONFIG = {
  issuer: 'https://login.microsoftonline.com/recovery/v2.0',
  clientId: 'client-rec',
  clientSecret: 'secret-rec',
  domains: ['recovery.example'],
  defaultRole: 'ANALYST' as const,
};

const stored = () => prisma.ssoConnection.findUniqueOrThrow({ where: { orgId: T.orgId } });
const unusedCount = (orgId = T.orgId) => prisma.ssoRecoveryCode.count({ where: { orgId, usedAt: null } });
const adminEmail = async () =>
  (await prisma.user.findUniqueOrThrow({ where: { id: T.userId } })).email;

/** Enforce SSO the way the product does, and keep the codes it hands back. */
async function enforceAndCollect(): Promise<string[]> {
  await admin().org.saveSso({ ...CONFIG, enforced: false } as never);
  // the precondition: a sign-in has to have succeeded once
  await prisma.ssoConnection.update({ where: { orgId: T.orgId }, data: { lastLoginAt: new Date() } });
  const c = await stored();
  const res = (await admin().org.saveSso({
    ...CONFIG,
    enforced: true,
    expectedUpdatedAt: c.updatedAt,
  } as never)) as { recoveryCodes: string[] | null };
  expect(res.recoveryCodes, 'enforcing SSO handed back no recovery codes').toBeTruthy();
  return res.recoveryCodes!;
}

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('SsoRec');
  other = await makeTenant('SsoRecOther');
}, 120_000);

describe('the codes themselves', () => {
  /**
   * Everything a person does to a code between the paper and the box. This is
   * the moment a firm is locked out, so a correct code refused for a
   * transcription error is indistinguishable from a code that does not work.
   */
  it('is read the same however it is typed', () => {
    const canonical = normaliseRecoveryCode('A1B2C-D3E4F');
    for (const typed of [
      'A1B2C-D3E4F',
      'a1b2c-d3e4f',
      'A1B2CD3E4F',
      'A1B2C D3E4F',
      ' A1B2C-D3E4F ',
      'a1b2c d3e4f',
    ]) {
      expect(normaliseRecoveryCode(typed), typed).toBe(canonical);
    }
  });

  /**
   * The three substitutions the alphabet was chosen to make unambiguous. Safe
   * BECAUSE O, I and L are not in it — there is no code containing an O to
   * confuse with one containing a zero.
   */
  it('reads O as zero and I or L as one, because nothing uses those letters', () => {
    expect(normaliseRecoveryCode('O1B2C')).toBe(normaliseRecoveryCode('01B2C'));
    expect(normaliseRecoveryCode('AIB2C')).toBe(normaliseRecoveryCode('A1B2C'));
    expect(normaliseRecoveryCode('ALB2C')).toBe(normaliseRecoveryCode('A1B2C'));
  });

  it('drops anything else rather than failing on it, so a stray paste costs no attempt', () => {
    expect(normaliseRecoveryCode('A1B2C-D3E4F.')).toBe(normaliseRecoveryCode('A1B2C-D3E4F'));
    expect(normaliseRecoveryCode('"A1B2C-D3E4F"')).toBe(normaliseRecoveryCode('A1B2C-D3E4F'));
  });

  it('mints distinct, grouped, printable codes', () => {
    const { codes, hashes } = newRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size, 'a duplicate reads as a code that was never valid').toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(hashes).toEqual(codes.map(hashRecoveryCode));
  });

  /** The letters a reader confuses are not in the alphabet to begin with. */
  it('never mints a code containing I, L, O or U', () => {
    const { codes } = newRecoveryCodes(40);
    expect(codes.join('')).not.toMatch(/[ILOU]/);
  });

  it('stores a digest, never the code', () => {
    const { codes, hashes } = newRecoveryCodes(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[0]).not.toContain(normaliseRecoveryCode(codes[0]!));
  });

  it('matches a stored digest and answers null for anything else', () => {
    const { codes, hashes } = newRecoveryCodes(3);
    const rows = hashes.map((codeHash, i) => ({ id: `r${i}`, codeHash }));
    expect(matchRecoveryCode(codes[1]!, rows)?.id).toBe('r1');
    // typed badly, and still found
    expect(matchRecoveryCode(codes[2]!.toLowerCase().replace('-', ' '), rows)?.id).toBe('r2');
    expect(matchRecoveryCode('ZZZZZ-ZZZZZ', rows)).toBeNull();
    expect(matchRecoveryCode(codes[0]!, [])).toBeNull();
  });

  it('formats for printing without changing what is compared', () => {
    expect(formatRecoveryCode('A1B2CD3E4F')).toBe('A1B2C-D3E4F');
    expect(hashRecoveryCode('A1B2C-D3E4F')).toBe(hashRecoveryCode('A1B2CD3E4F'));
  });
});

describe('enforcing single sign-on', () => {
  let codes: string[] = [];

  it('mints the break-glass codes in the same save, and returns them once', async () => {
    codes = await enforceAndCollect();
    expect(codes).toHaveLength(10);
    expect(await unusedCount()).toBe(10);
    expect((await stored()).enforced).toBe(true);
  });

  /**
   * Only digests are stored and nothing can recover a code from one, so the
   * save's response is the single moment they exist in readable form.
   */
  it('never hands them out again, by any read', async () => {
    const cfg = (await admin().org.ssoConfig()) as { recoveryCodesRemaining: number };
    expect(cfg.recoveryCodesRemaining).toBe(10);
    expect(JSON.stringify(cfg), 'a code came back from a read').not.toContain(codes[0]!);
    const rows = await prisma.ssoRecoveryCode.findMany({ where: { orgId: T.orgId } });
    expect(JSON.stringify(rows), 'the plaintext is in the table').not.toContain(normaliseRecoveryCode(codes[0]!));
  });

  /**
   * A firm that stood enforcement down for an afternoon and turned it back on
   * has the printed sheet in a drawer. Replacing it silently would make the
   * drawer the one place the codes are not.
   */
  it('keeps the sheet a firm already holds when enforcement is re-applied', async () => {
    const c1 = await stored();
    await admin().org.saveSso({ ...CONFIG, enforced: false, expectedUpdatedAt: c1.updatedAt } as never);
    const c2 = await stored();
    const res = (await admin().org.saveSso({
      ...CONFIG, enforced: true, expectedUpdatedAt: c2.updatedAt,
    } as never)) as { recoveryCodes: string[] | null };
    expect(res.recoveryCodes, 'the printed sheet was silently replaced').toBeNull();
    expect(await unusedCount()).toBe(10);
  });
});

describe('signing in with a code', () => {
  let codes: string[] = [];

  beforeAll(async () => {
    codes = (await prisma.ssoRecoveryCode.count({ where: { orgId: T.orgId } }))
      ? ((await admin().org.regenerateSsoRecoveryCodes()) as { codes: string[] }).codes
      : await enforceAndCollect();
  });

  it('refuses a password, which is the state this exists for', async () => {
    await expect(
      anonymous().auth.login({ email: await adminEmail(), password: 'x' }),
    ).rejects.toThrow(/single sign-on/i);
  });

  it('lets an admin in with a code, and says how many are left', async () => {
    const res = (await anonymous().auth.recoveryLogin({
      email: await adminEmail(),
      code: codes[0]!,
    })) as { token: string; codesLeft: number; principal: { role: string } };
    expect(res.token, 'no session was issued').toBeTruthy();
    expect(res.principal.role).toBe('ADMIN');
    expect(res.codesLeft).toBe(9);
  });

  /** Single use is not a policy, it is the absence of a second chance. */
  it('will not take the same code twice', async () => {
    await expect(
      anonymous().auth.recoveryLogin({ email: await adminEmail(), code: codes[0]! }),
    ).rejects.toThrow(/not valid/i);
  });

  it('accepts the next one typed badly — lower case, no dash', async () => {
    const typed = codes[1]!.toLowerCase().replace('-', '');
    const res = (await anonymous().auth.recoveryLogin({
      email: await adminEmail(), code: typed,
    })) as { codesLeft: number };
    expect(res.codesLeft).toBe(8);
  });

  /**
   * The spent row STAYS. "An admin signed in with a break-glass code on the
   * 4th" is exactly what a security review asks about, and a deleted row
   * answers nothing.
   */
  it('keeps the spent code, stamped with who spent it', async () => {
    const spent = await prisma.ssoRecoveryCode.findMany({
      where: { orgId: T.orgId, usedAt: { not: null } },
      orderBy: { usedAt: 'asc' },
    });
    expect(spent).toHaveLength(2);
    for (const row of spent) expect(row.usedById).toBe(T.userId);
  });

  it('writes the sign-in to the audit trail, naming the code as the route in', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId },
      orderBy: { at: 'desc' },
      take: 20,
    });
    const recovery = events.filter((e) => /RECOVERY CODE/.test(e.target ?? ''));
    expect(recovery.length, 'a break-glass sign-in left no trail').toBeGreaterThanOrEqual(2);
  });

  /**
   * It does NOT stand the control down. The session is the whole grant; the
   * admin then decides. Clearing `enforced` here would make one leaked code a
   * silent way to switch single sign-on off.
   */
  it('leaves enforcement exactly as it was', async () => {
    expect((await stored()).enforced).toBe(true);
  });

  /**
   * The race, which the sequential case above cannot reach.
   *
   * Two requests arriving together both read the unused list before either
   * writes, so both find the code and both would issue a session — one code,
   * two ways in, which is the whole value of single use gone. `updateMany` with
   * `usedAt: null` in the WHERE is the compare-and-set: whoever the database
   * serialises first gets `count: 1` and the other gets 0.
   *
   * Recorded because it was found by mutation: removing that one clause passed
   * every other test in this file, since a second SEQUENTIAL attempt is refused
   * by `matchRecoveryCode` — the spent row is no longer in the list it searches
   * — and the guard was never asked about.
   */
  it('issues one session when two requests arrive with the same code', async () => {
    const fresh = ((await admin().org.regenerateSsoRecoveryCodes()) as { codes: string[] }).codes;
    const email = await adminEmail();
    const results = await Promise.allSettled([
      anonymous().auth.recoveryLogin({ email, code: fresh[0]! }),
      anonymous().auth.recoveryLogin({ email, code: fresh[0]! }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won, 'one code let two requests in').toHaveLength(1);
    expect(await unusedCount()).toBe(9);
  });
});

describe('who the door opens for', () => {
  /**
   * One message for every refusal, and the same one — otherwise this is an
   * oracle for which firms enforce SSO and who their administrators are.
   */
  const SAME = /that recovery code is not valid for this address/i;

  it('refuses an address nobody holds, in the same words as a wrong code', async () => {
    await expect(
      anonymous().auth.recoveryLogin({ email: 'nobody@recovery.example', code: 'A1B2C-D3E4F' }),
    ).rejects.toThrow(SAME);
  });

  /**
   * Where passwords still work there is nothing to recover from, and a code
   * that signed in anyway would be a second credential path for every firm in
   * the product — granted by a sheet of paper that never expires.
   */
  it('refuses a workspace that does not enforce single sign-on', async () => {
    const otherAdmin = callerFor({ ...other.principal, role: 'ADMIN' });
    const res = (await otherAdmin.org.saveSso({
      issuer: 'https://login.microsoftonline.com/other/v2.0',
      clientId: 'client-other',
      clientSecret: 'secret-other',
      domains: ['other-recovery.example'],
      defaultRole: 'ANALYST',
      enforced: false,
    } as never)) as { recoveryCodes: string[] | null };
    expect(res.recoveryCodes, 'codes were minted for an unenforced connection').toBeNull();

    /**
     * A REAL code, written by hand onto an unenforced workspace, and still
     * refused. The first version of this case passed a made-up literal, so the
     * refusal came from the wrong code rather than from the workspace — and
     * deleting the `enforced` check survived all 28 tests. A code that is
     * genuinely valid is the only thing that puts the condition under test.
     */
    const { codes, hashes } = newRecoveryCodes(1);
    await prisma.ssoRecoveryCode.create({ data: { orgId: other.orgId, codeHash: hashes[0]! } });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: other.userId } })).email;
    await expect(
      anonymous().auth.recoveryLogin({ email, code: codes[0]! }),
      'a valid code signed an admin in to a workspace where passwords still work',
    ).rejects.toThrow(SAME);
    // and it was not spent on the way to refusing
    expect(await unusedCount(other.orgId)).toBe(1);
  });

  /**
   * The point of getting in is to correct the issuer or stand enforcement down,
   * and both are `adminProcedure`. A code that signs in an analyst fixes
   * nothing and widens what one leaked sheet is worth.
   */
  it('refuses a member who could not fix the connection anyway', async () => {
    const codes = ((await admin().org.regenerateSsoRecoveryCodes()) as { codes: string[] }).codes;
    const analyst = await prisma.user.create({
      data: {
        orgId: T.orgId,
        email: 'analyst@ssorec.test',
        password: 'x',
        name: 'Rec Analyst',
        initials: 'RA',
        role: 'ANALYST',
        principalType: 'internal',
      },
    });
    await expect(
      anonymous().auth.recoveryLogin({ email: analyst.email, code: codes[0]! }),
    ).rejects.toThrow(SAME);
    // and the code was not spent on the way to refusing
    expect(await unusedCount()).toBe(10);
  });

  /**
   * An investor or buyer in the workspace is not a member of the firm and
   * cannot hold a role that fixes anything.
   */
  it('refuses a portal principal in an enforced workspace', async () => {
    const codes = ((await admin().org.regenerateSsoRecoveryCodes()) as { codes: string[] }).codes;
    const lp = await prisma.user.findUniqueOrThrow({ where: { id: T.investorPrincipal.userId } });
    await expect(
      anonymous().auth.recoveryLogin({ email: lp.email, code: codes[0]! }),
    ).rejects.toThrow(SAME);
  });

  /**
   * A code belongs to its own workspace, like every other row in this product.
   *
   * BOTH workspaces are enforced for this one, and that is the whole point.
   * The first version left the other firm unenforced, so the refusal came from
   * the `enforced` check and removing the `orgId` scope from the unused-codes
   * query passed all 29 tests — a valid code from any firm would have signed in
   * any other firm's admin. Two enforced workspaces is the only arrangement
   * that puts the tenancy scope under test.
   */
  it('refuses another firm’s code, with both workspaces enforced', async () => {
    const otherAdmin = callerFor({ ...other.principal, role: 'ADMIN' });
    await prisma.ssoConnection.update({ where: { orgId: other.orgId }, data: { lastLoginAt: new Date() } });
    const oc = await prisma.ssoConnection.findUniqueOrThrow({ where: { orgId: other.orgId } });
    await otherAdmin.org.saveSso({
      issuer: 'https://login.microsoftonline.com/other/v2.0',
      clientId: 'client-other',
      domains: ['other-recovery.example'],
      defaultRole: 'ANALYST',
      enforced: true,
      expectedUpdatedAt: oc.updatedAt,
    } as never);
    expect(
      (await prisma.ssoConnection.findUniqueOrThrow({ where: { orgId: other.orgId } })).enforced,
      'the other workspace is not enforced, so this would test the wrong guard',
    ).toBe(true);

    const mine = ((await admin().org.regenerateSsoRecoveryCodes()) as { codes: string[] }).codes;
    const otherEmail = (await prisma.user.findUniqueOrThrow({ where: { id: other.userId } })).email;
    await expect(
      anonymous().auth.recoveryLogin({ email: otherEmail, code: mine[0]! }),
      'one firm’s recovery code signed in another firm’s administrator',
    ).rejects.toThrow(SAME);
    expect(await unusedCount(T.orgId), 'another firm’s attempt spent one of ours').toBe(10);
  });
});

describe('regenerating', () => {
  it('withdraws every unused code and hands back a new set', async () => {
    const before = ((await admin().org.regenerateSsoRecoveryCodes()) as { codes: string[] }).codes;
    const after = ((await admin().org.regenerateSsoRecoveryCodes()) as { codes: string[] }).codes;
    expect(after).toHaveLength(10);
    expect(after).not.toEqual(before);
    expect(await unusedCount()).toBe(10);
    await expect(
      anonymous().auth.recoveryLogin({ email: await adminEmail(), code: before[0]! }),
    ).rejects.toThrow(/not valid/i);
  });

  /** The spent ones are the record; only what is still live is withdrawn. */
  it('leaves the spent rows alone, because they are the audit trail', async () => {
    const spentBefore = await prisma.ssoRecoveryCode.count({ where: { orgId: T.orgId, usedAt: { not: null } } });
    expect(spentBefore).toBeGreaterThan(0);
    await admin().org.regenerateSsoRecoveryCodes();
    expect(await prisma.ssoRecoveryCode.count({ where: { orgId: T.orgId, usedAt: { not: null } } })).toBe(spentBefore);
  });

  it('refuses a workspace with no connection at all — there is no door to unlock', async () => {
    const T3 = await makeTenant('SsoRecNone');
    const a3 = callerFor({ ...T3.principal, role: 'ADMIN' });
    await expect(a3.org.regenerateSsoRecoveryCodes()).rejects.toThrow(/set up single sign-on first/i);
    expect(await prisma.ssoRecoveryCode.count({ where: { orgId: T3.orgId } })).toBe(0);
  });

  it('is admin-only', async () => {
    const viewer = callerFor({ ...T.principal, role: 'VIEWER' });
    await expect(viewer.org.regenerateSsoRecoveryCodes()).rejects.toThrow(/admin/i);
  });
});

describe('removing single sign-on', () => {
  /**
   * The break-glass goes with the door. A code left behind unlocks nothing —
   * `recoveryLogin` refuses a workspace that does not enforce SSO — but it is
   * still a live credential on a row, and the next time the firm federates they
   * would be handed a sheet that is already somewhere else.
   */
  it('takes the codes with it, spent and unspent alike', async () => {
    expect(await prisma.ssoRecoveryCode.count({ where: { orgId: T.orgId } })).toBeGreaterThan(0);
    await admin().org.deleteSso();
    expect(await prisma.ssoRecoveryCode.count({ where: { orgId: T.orgId } })).toBe(0);
  });
});
