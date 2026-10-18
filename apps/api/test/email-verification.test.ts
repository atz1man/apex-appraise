import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { anonymous, prisma, resetDatabase } from './harness.js';
import { hashResetToken } from '../src/auth/password.js';
import { JWT_SECRET, principalFromAuthHeader } from '../src/context.js';
import { sendMail } from '../src/email.js';
vi.mock('../src/email.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/email.js')>(),
  sendMail: vi.fn(async () => ({ emailed: true })),
}));
beforeAll(() => resetDatabase());
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(sendMail).mockClear(); });
let sequence = 0;
async function signup() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DEMO_MODE', '0');
  const email = `verify-${++sequence}@example.test`;
  const result = await anonymous().org.register({ orgName: 'Verify firm', name: 'Test Owner', email, password: 'long-test-password' });
  const mail = vi.mocked(sendMail).mock.calls.at(-1)!;
  const url = mail[3].match(/https?:\/\/[^\s]+/)![0];
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { email, result, token, user };
}
describe('customer email activation', () => {
  it('requires proof before password or bearer access and consumes a link once', async () => {
    const { email, result, token, user } = await signup();
    expect(result.verificationRequired).toBe(true);
    expect(result.token).toBe('');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.emailVerificationHash).toBe(hashResetToken(token));
    expect(user.emailVerificationHash).not.toBe(token);
    await expect(anonymous().auth.login({ email, password: 'long-test-password' })).rejects.toThrow(/Verify your email/);
    const bearer = `Bearer ${jwt.sign({ sub: user.id }, JWT_SECRET)}`;
    expect(await principalFromAuthHeader(prisma, bearer)).toBeNull();
    const attempts = await Promise.allSettled([anonymous().auth.verifyEmail({ token }), anonymous().auth.verifyEmail({ token })]);
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(anonymous().auth.verifyEmail({ token })).rejects.toThrow(/invalid or has expired/);
    expect((await anonymous().auth.login({ email, password: 'long-test-password' })).token).toBeTruthy();
    expect((await principalFromAuthHeader(prisma, bearer))?.userId).toBe(user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerificationHash).toBeNull();
  });
  it('rejects expired and reset credentials and leaves other accounts untouched', async () => {
    const first = await signup();
    const other = await signup();
    await prisma.user.update({ where: { id: first.user.id }, data: { emailVerificationExpiresAt: new Date(Date.now() - 1), resetTokenHash: hashResetToken('reset-credential-not-verification') } });
    await expect(anonymous().auth.verifyEmail({ token: first.token })).rejects.toThrow(/expired/);
    await expect(anonymous().auth.verifyEmail({ token: 'reset-credential-not-verification' })).rejects.toThrow(/invalid/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } })).emailVerifiedAt).toBeNull();
  });
  it('bounds concurrent resend mail and invalidates older links without disclosing account state', async () => {
    const { email, token, user } = await signup();
    vi.mocked(sendMail).mockClear();
    const responses = await Promise.all(Array.from({ length: 12 }, () => anonymous().auth.resendVerification({ email })));
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(responses.every(r => r.accepted)).toBe(true);
    expect(await anonymous().auth.resendVerification({ email: 'unknown@example.test' })).toEqual(responses[0]);
    await expect(anonymous().auth.verifyEmail({ token })).rejects.toThrow(/invalid/);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const links = vi.mocked(sendMail).mock.calls.map(mail => new URLSearchParams(new URL(mail[3].match(/https?:\/\/[^\s]+/)![0]).hash.slice(1)).get('token')!);
    const current = links.find(link => hashResetToken(link) === row.emailVerificationHash)!;
    await anonymous().auth.verifyEmail({ token: current });
    await anonymous().auth.resendVerification({ email });
    expect(sendMail).toHaveBeenCalledTimes(3);
  });
  it('reports failed initial delivery honestly and keeps the account locked', async () => {
    vi.mocked(sendMail).mockResolvedValueOnce({ emailed: false });
    const { result, email } = await signup();
    expect(result.emailSent).toBe(false);
    expect(result.token).toBe('');
    await expect(anonymous().auth.login({ email, password: 'long-test-password' })).rejects.toThrow(/Verify/);
  });
  it('keeps explicit demo signup usable without inventing verified email evidence', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DEMO_MODE', '1');
    const email = 'demo-verification@example.test';
    const result = await anonymous().org.register({ orgName: 'Demo firm', name: 'Demo Owner', email, password: 'long-test-password' });
    expect(result.verificationRequired).toBe(false);
    expect(result.token).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
  });
});
