import { afterEach, describe, expect, it, vi } from 'vitest';

const { deliver } = vi.hoisted(() => ({ deliver: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: deliver }) } }));
import { readMailbox, sendMail } from '../src/email.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  deliver.mockReset();
});

describe('email credentials stay out of operational logs', () => {
  it.each(['production', 'test'])('redacts undelivered email in %s', async mode => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('DEMO_MODE', '');
    vi.stubEnv('SMTP_URL', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = 'Temporary password: secret-password; /reset?token=secret-token';
    expect(await sendMail('logging-test', 'private@firm.test', 'Private client', body)).toEqual({ emailed: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SMTP is not configured'));
    const output = JSON.stringify(log.mock.calls);
    for (const secret of ['secret-password', 'secret-token', 'private@firm.test', 'Private client']) {
      expect(output).not.toContain(secret);
    }
    if (mode === 'test') expect(readMailbox('logging-test').some(mail => mail.text === body)).toBe(true);
  });

  it('does not forward an SMTP error that echoes credentials or message contents', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://smtp-user:smtp-password@mail.test');
    deliver.mockRejectedValue(new Error('smtp-password private@firm.test /reset?token=secret-token'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendMail('logging-test', 'private@firm.test', 'Reset', '/reset?token=secret-token')).toEqual({ emailed: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SMTP delivery failed'));
    const output = JSON.stringify(log.mock.calls);
    for (const secret of ['smtp-password', 'private@firm.test', 'secret-token']) expect(output).not.toContain(secret);
  });

  it('still delivers the original message to the configured mail transport', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://mail.test');
    deliver.mockResolvedValue({});
    expect(await sendMail('logging-test', 'private@firm.test', 'Reset', 'private body')).toEqual({ emailed: true });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ to: 'private@firm.test', subject: 'Reset', text: 'private body' }));
  });
});
