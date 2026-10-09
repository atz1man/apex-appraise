import '../apps/api/src/env.js';
import { isIP } from 'node:net';
import { isPublicAddress } from '../apps/api/src/outbound.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITY, type LegalEntity } from '../apps/web/src/legal/entity.js';

/** Configuration checks only; delivery, restore drills and valuation acceptance need evidence. */
export function releaseConfigurationIssues(env: Record<string, string | undefined>, entity: LegalEntity): string[] {
  const issues: string[] = [];
  const required = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY', 'APP_URL', 'WEB_URL', 'SMTP_URL', 'EMAIL_FROM',
    'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'];
  for (const name of required) if (!env[name]?.trim()) issues.push(`${name} is missing`);
  if (env.NODE_ENV !== 'production') issues.push('NODE_ENV must be production');
  for (const name of ['DEMO_MODE', 'SEED_DEMO']) if (env[name] === '1') issues.push(`${name} must be disabled on the customer deployment`);
  if (env.RESET_TOKEN) issues.push('RESET_TOKEN must be absent on the customer deployment');
  if (env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) issues.push('DATABASE_URL must use PostgreSQL');
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) issues.push('JWT_SECRET must contain at least 32 characters');
  if (env.ENCRYPTION_KEY) {
    const key = env.ENCRYPTION_KEY;
    if (!/^[a-f\d]{64}$/i.test(key) && (!/^[A-Za-z\d+/]+={0,2}$/.test(key) || Buffer.from(key, 'base64').length !== 32)) {
      issues.push('ENCRYPTION_KEY must encode 32 bytes');
    }
    if (key === env.JWT_SECRET) issues.push('ENCRYPTION_KEY and JWT_SECRET must be separate');
  }
  for (const name of ['APP_URL', 'WEB_URL']) if (env[name]) {
    try {
      const url = new URL(env[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0 && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, '')))) throw new Error();
    } catch { issues.push(`${name} must be a public HTTPS URL`); }
  }
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith('sk_live_')) issues.push('STRIPE_SECRET_KEY must use live mode for customer billing');
  if (env.STRIPE_PUBLISHABLE_KEY && !env.STRIPE_PUBLISHABLE_KEY.startsWith('pk_live_')) issues.push('STRIPE_PUBLISHABLE_KEY must use live mode for customer billing');
  if (!entity.confirmed || !entity.name.trim() || !entity.companyNumber.trim() || !entity.registeredOffice.trim()) {
    issues.push('The published operator identity has not been confirmed');
  }
  for (const field of ['privacyContact', 'supportContact'] as const) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entity[field])) issues.push(`The operator ${field} must be a valid email address`);
  }
  return issues;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const issues = releaseConfigurationIssues(process.env, ENTITY);
  // Print names and requirements, never values, URLs containing credentials or transport errors.
  if (issues.length) {
    console.error('Customer release configuration is incomplete:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
  } else {
    console.log('Configuration checks passed. Complete the operational acceptance evidence in docs/SAAS-RELEASE.md before launch.');
  }
}
