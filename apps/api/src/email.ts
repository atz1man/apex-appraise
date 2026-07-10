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

export async function sendMail(to: string, subject: string, text: string): Promise<{ emailed: boolean }> {
  const t = getTransporter();
  if (!t) {
    console.log(`[email:demo-mode] to=${to} subject="${subject}"\n${text}\n`);
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
