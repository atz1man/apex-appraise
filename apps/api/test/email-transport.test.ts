import nodemailer from 'nodemailer';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

let server: Server | undefined;
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function fixture(mode: 'silent' | 'stall' | 'deliver') {
  server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (mode === 'silent') return;
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '';
    let data = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (mode === 'stall') return; // greeting succeeds, but EHLO never receives an answer
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') { data = false; socket.write('250 queued locally\r\n'); }
        } else if (line.startsWith('DATA')) { data = true; socket.write('354 continue\r\n'); }
        else if (line.startsWith('QUIT')) socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  vi.stubEnv('SMTP_URL', `smtp://127.0.0.1:${address.port}`);
  vi.stubEnv('EMAIL_FROM', 'sender@example.test');
  vi.resetModules();
  return import('../src/email.js');
}
describe('mail transport failures return control to the customer', () => {
  it('closes a silent server connection and reports failure within fifteen seconds', async () => {
    const { sendMail } = await fixture('silent');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendMail('local', 'recipient@example.test', 'Local test', 'Synthetic body')).toEqual({ emailed: false });
    await vi.waitFor(() => expect(sockets.size).toBe(0));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SMTP delivery failed'));
  }, 15_000);
  it('closes an established but stalled SMTP conversation within twenty-five seconds', async () => {
    const { sendMail } = await fixture('stall');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendMail('local', 'recipient@example.test', 'Local test', 'Synthetic body')).toEqual({ emailed: false });
    await vi.waitFor(() => expect(sockets.size).toBe(0));
  }, 25_000);
  it('customer signup returns a retryable delivery failure while preserving pending access', async () => {
    await fixture('silent');
    vi.stubEnv('SMTP_URL', `${process.env.SMTP_URL}?greetingTimeout=25`);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', '0');
    vi.stubEnv('JWT_SECRET', 'local-mail-test-signing-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { anonymous, prisma, resetDatabase } = await import('./harness.js');
    resetDatabase();
    try {
      const email = 'pending-smtp@example.test';
      const result = await anonymous().org.register({ email, name: 'Mail Test', orgName: 'Local mail fixture', password: 'long-test-password' });
      expect(result).toMatchObject({ token: '', verificationRequired: true, emailSent: false });
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
      await expect(anonymous().auth.login({ email, password: 'long-test-password' })).rejects.toThrow(/Verify your email/);
    } finally { await prisma.$disconnect(); }
  }, 120_000);

  it('caps connection options without changing credentials or TLS settings', async () => {
    const create = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: async () => ({}) } as any);
    vi.stubEnv('SMTP_URL', 'smtps://fixture%40user:fixture%3Apass@localhost:465?greetingTimeout=999999&socketTimeout=75&tls.rejectUnauthorized=true');
    vi.resetModules();
    const { sendMail } = await import('../src/email.js');
    expect(await sendMail('local', 'recipient@example.test', 'Local test', 'Synthetic body')).toEqual({ emailed: true });
    const configured = new URL(create.mock.calls[0][0] as unknown as string);
    expect(configured.protocol).toBe('smtps:');
    expect(decodeURIComponent(configured.username)).toBe('fixture@user');
    expect(decodeURIComponent(configured.password)).toBe('fixture:pass');
    expect(configured.port).toBe('465');
    expect(configured.searchParams.get('tls.rejectUnauthorized')).toBe('true');
    expect(configured.searchParams.get('greetingTimeout')).toBe('10000');
    expect(configured.searchParams.get('connectionTimeout')).toBe('10000');
    expect(configured.searchParams.get('dnsTimeout')).toBe('10000');
    expect(configured.searchParams.get('socketTimeout')).toBe('75');
  });
  it('returns a sanitized failure for malformed configuration', async () => {
    vi.stubEnv('SMTP_URL', 'not-a-url-with-private-credential');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    const { sendMail } = await import('../src/email.js');
    expect(await sendMail('local', 'recipient@example.test', 'Local test', 'Synthetic body')).toEqual({ emailed: false });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-credential');
  });
  it('still delivers to a responsive local SMTP server', async () => {
    const { sendMail } = await fixture('deliver');
    expect(await sendMail('local', 'recipient@example.test', 'Local test', 'Synthetic body')).toEqual({ emailed: true });
  });
});
