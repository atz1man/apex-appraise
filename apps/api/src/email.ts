import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Outbound email. Configured with SMTP_URL (e.g. smtp://user:pass@smtp.postmarkapp.com:587)
 * + EMAIL_FROM. Without SMTP_URL, mail is logged to the API console (dev/demo mode) so
 * flows remain testable; callers receive { emailed: false } and surface the fallback UI.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  if (!transporter) transporter = nodemailer.createTransport(url);
  return transporter;
}

const FROM = () => process.env.EMAIL_FROM ?? 'Apex Appraise <no-reply@apexappraise.co.uk>';

/**
 * Demo mailbox — the last few messages, in memory, ONLY when no SMTP is
 * configured.
 *
 * Without this, every email-shaped flow (invites, reset links) is untestable and
 * unusable on a demo instance: the mail goes to a console nobody reads. It is
 * deliberately impossible to enable alongside real email — the moment SMTP_URL is
 * set, nothing is recorded and the reader returns nothing, so a production
 * instance cannot serve anyone else's messages even by mistake.
 */
const MAILBOX_LIMIT = 25;
const mailbox: Array<{ to: string; subject: string; text: string; at: string }> = [];

export const mailboxEnabled = () => !process.env.SMTP_URL;

export function readMailbox(): typeof mailbox {
  return mailboxEnabled() ? [...mailbox].reverse() : [];
}

export async function sendMail(to: string, subject: string, text: string): Promise<{ emailed: boolean }> {
  const t = getTransporter();
  if (!t) {
    console.log(`[email:demo-mode] to=${to} subject="${subject}"\n${text}\n`);
    mailbox.push({ to, subject, text, at: new Date().toISOString() });
    if (mailbox.length > MAILBOX_LIMIT) mailbox.shift();
    return { emailed: false };
  }
  try {
    await t.sendMail({ from: FROM(), to, subject, text });
    return { emailed: true };
  } catch (e) {
    console.error('[email] send failed:', e instanceof Error ? e.message : e);
    return { emailed: false };
  }
}

export function inviteEmail(inviteeName: string, orgName: string, email: string, tempPassword: string, appUrl: string) {
  return {
    subject: `You've been invited to ${orgName} on Apex Appraise`,
    text: `Hi ${inviteeName},

You've been invited to join ${orgName} on Apex Appraise — one connected workfile for UK property development.

Sign in at ${appUrl}/login
Email: ${email}
Temporary password: ${tempPassword}

Please change your password straight away in Settings → Security.

— Apex Appraise`,
  };
}

export function welcomeEmail(name: string, orgName: string, appUrl: string) {
  return {
    subject: `Welcome to Apex Appraise, ${name.split(' ')[0]}`,
    text: `Hi ${name},

Your workspace “${orgName}” is ready at ${appUrl}.

Start with a deal: Pipeline → New deal from documents, or run the Auto-Appraisal on your first scheme.

— Apex Appraise`,
  };
}

export const APP_URL = () => process.env.APP_URL ?? 'http://localhost:5273';

export function resetEmail(name: string, appUrl: string, token: string) {
  const link = `${appUrl}/reset?token=${token}`;
  return {
    subject: 'Reset your Apex Appraise password',
    text: [
      `Hi ${name},`,
      '',
      'Someone asked to reset the password on your Apex Appraise account. If that was you, use the link below within the hour:',
      '',
      link,
      '',
      'If it was not you, no action is needed — your password has not changed, and this link can be used only once.',
    ].join('\n'),
  };
}
