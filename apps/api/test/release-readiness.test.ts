import { describe, expect, it } from 'vitest';
import { releaseConfigurationIssues } from '../../../infra/check-release.js';
import { ENTITY } from '../../web/src/legal/entity.js';

const env = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:fixture@db.test/customer',
  JWT_SECRET: 'fixture-signing-key-with-at-least-32-characters', ENCRYPTION_KEY: 'ab'.repeat(32),
  APP_URL: 'https://customer.example.test', WEB_URL: 'https://customer.example.test',
  TILE_URL: 'https://maps.example.test/{z}/{x}/{y}.png', TILE_ATTRIBUTION: 'Fixture licensed map', TILE_USER_AGENT: 'ApexAppraise (+https://example.test/contact)',
  SMTP_URL: 'smtp://test:fixture@mail.test', EMAIL_FROM: 'Apex <mail@example.test>',
  STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
};
const entity = { ...ENTITY, confirmed: true, name: 'Fixture Ltd', companyNumber: 'fixture', registeredOffice: 'Fixture address' };
describe('customer release configuration', () => {
  it('accepts a complete configuration without claiming delivery or restore proof', () => {
    expect(releaseConfigurationIssues(env, entity)).toEqual([]);
  });
  it('finds the actual incomplete defaults', () => {
    const issues = releaseConfigurationIssues({}, ENTITY);
    expect(issues).toContain('SMTP_URL is missing');
    expect(issues).toContain('The published operator identity has not been confirmed');
    expect(issues.length).toBeGreaterThan(10);
  });
  it.each(['DEMO_MODE', 'SEED_DEMO', 'RESET_TOKEN'])('refuses customer deployments with %s', name => {
    expect(releaseConfigurationIssues({ ...env, [name]: '1' }, entity).some(issue => issue.startsWith(name))).toBe(true);
  });
  it('finds insecure URLs, SQLite and a test payment account', () => {
    const issues = releaseConfigurationIssues({ ...env, APP_URL: 'http://localhost:5273', DATABASE_URL: 'file:dev.db', STRIPE_SECRET_KEY: 'sk_test_fixture' }, entity);
    expect(issues).toContain('APP_URL must be a public HTTPS URL');
    expect(issues).toContain('DATABASE_URL must use PostgreSQL');
    expect(issues).toContain('STRIPE_SECRET_KEY must use live mode for customer billing');
  });
  it.each(['https://127.0.0.1', 'https://10.0.0.1', 'https://[::1]'])('rejects a private customer URL: %s', url => {
    expect(releaseConfigurationIssues({ ...env, APP_URL: url }, entity)).toContain('APP_URL must be a public HTTPS URL');
  });
  it('requires an explicit production mapping service rather than the best-effort public default', () => {
    expect(releaseConfigurationIssues({ ...env, TILE_URL: '' }, entity)).toContain('TILE_URL is missing');
    expect(releaseConfigurationIssues({ ...env, TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }, entity).join(' ')).toContain('public OSM service has no SLA');
    expect(releaseConfigurationIssues({ ...env, TILE_URL: 'https://maps.example.test/tiles?key=sensitive-map-fixture' }, entity)).toContain('TILE_URL must be a public HTTPS tile template containing {z}, {x} and {y}');
  });
  it('does not disclose a tile provider token when its template is invalid', () => {
    expect(releaseConfigurationIssues({ ...env, TILE_URL: 'http://maps.example.test/tiles?key=sensitive-map-fixture' }, entity).join(' ')).not.toContain('sensitive-map-fixture');
  });
  it('rejects malformed or shared encryption keys', () => {
    expect(releaseConfigurationIssues({ ...env, ENCRYPTION_KEY: 'broken' }, entity)).toContain('ENCRYPTION_KEY must encode 32 bytes');
    expect(releaseConfigurationIssues({ ...env, ENCRYPTION_KEY: env.JWT_SECRET }, entity)).toContain('ENCRYPTION_KEY and JWT_SECRET must be separate');
  });
  it('never includes secret values in diagnostics', () => {
    const secret = 'sensitive-fixture-do-not-echo';
    const issues = releaseConfigurationIssues({ ...env, ENCRYPTION_KEY: secret, DATABASE_URL: secret, STRIPE_SECRET_KEY: secret }, entity);
    expect(issues.join('\n')).not.toContain(secret);
    expect(issues.join('\n')).not.toContain(env.SMTP_URL);
  });
});
