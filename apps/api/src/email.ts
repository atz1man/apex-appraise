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

/**
 * `||`, not `??`. compose passes EMAIL_FROM as `${EMAIL_FROM:-}`, so in the
 * deployed stack an unset variable arrives as an empty string — which `??`
 * accepts. Every message from a firm that configured SMTP but not a From
 * address went out with an empty From header, and this default, which reads
 * like the safety net, could never fire where it was needed.
 */
const FROM = () => process.env.EMAIL_FROM || 'Apex Appraise <no-reply@apexappraise.co.uk>';

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
/**
 * 25 was too small once the test suite started registering workspaces: each
 * signup sends a welcome email, and a reset email could be evicted between the
 * request that created it and the read that needed it — a failure that looks
 * exactly like a broken reset token. It is an in-memory demo aid; 200 costs
 * nothing and gives the mailbox enough depth to be trusted.
 */
const MAILBOX_LIMIT = 200;
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

/**
 * The reply when the workspace signs in with SSO.
 *
 * No token, no link — a password set here could never be used to sign in while
 * enforcement is on, and would become a live credential the moment it was
 * turned off. The person still gets an answer, because silence after clicking
 * "forgot password" reads as a broken product and sends them to support.
 */
export function ssoResetEmail(name: string, appUrl: string) {
  return {
    subject: 'Signing in to Apex Appraise',
    text: [
      `Hi ${name},`,
      '',
      'Someone asked to reset the password on your Apex Appraise account. Your organisation signs in with single sign-on, so there is no password to reset — use the single sign-on button on the sign-in page instead:',
      '',
      `${appUrl}/login`,
      '',
      'If it was not you who asked, nothing has changed and no action is needed. If you cannot sign in, your IT team manages this.',
    ].join('\n'),
  };
}

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
