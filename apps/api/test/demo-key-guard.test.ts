import { describe, expect, it } from 'vitest';
import { billableKeysOnPublicDemo, demoKeyWarning } from '../src/demo-key-guard.js';

/**
 * The boundaries that decide whether this guard is heeded or ignored.
 *
 * It fires on the combination — published credentials AND a key that costs
 * money — and the two false positives it must not produce are a real
 * deployment (which seeds no public logins, so its keys are its own business)
 * and a Stripe TEST key on a demo (which moves no money and is the right way
 * to show the buyer journey). A guard that cried wolf at `sk_test_…` would be
 * a guard nobody reads.
 */
describe('a demo build holding a billable key', () => {
  it('says nothing when the build does not seed the published logins', () => {
    expect(billableKeysOnPublicDemo({ ANTHROPIC_API_KEY: 'sk-ant-real', STRIPE_SECRET_KEY: 'sk_live_real' })).toEqual([]);
    expect(billableKeysOnPublicDemo({ SEED_DEMO: '0', ANTHROPIC_API_KEY: 'sk-ant-real' })).toEqual([]);
    expect(demoKeyWarning({ ANTHROPIC_API_KEY: 'sk-ant-real' })).toBeNull();
  });

  it('names the Anthropic key on a demo build, because the logins are public', () => {
    const found = billableKeysOnPublicDemo({ SEED_DEMO: '1', ANTHROPIC_API_KEY: 'sk-ant-real' });
    expect(found.map((k) => k.name)).toEqual(['ANTHROPIC_API_KEY']);
    const warned = demoKeyWarning({ SEED_DEMO: '1', ANTHROPIC_API_KEY: 'sk-ant-real' });
    expect(warned?.keys).toEqual(['ANTHROPIC_API_KEY']);
    // the message has to carry the fix, not just the alarm
    expect(warned?.msg).toMatch(/spend cap|remove/i);
  });

  it('ignores a Stripe TEST key and names a LIVE one', () => {
    expect(billableKeysOnPublicDemo({ SEED_DEMO: '1', STRIPE_SECRET_KEY: 'sk_test_abc' })).toEqual([]);
    expect(billableKeysOnPublicDemo({ SEED_DEMO: '1', STRIPE_SECRET_KEY: 'sk_live_abc' }).map((k) => k.name)).toEqual([
      'STRIPE_SECRET_KEY',
    ]);
  });

  it('names both when both are held', () => {
    const found = billableKeysOnPublicDemo({ SEED_DEMO: '1', ANTHROPIC_API_KEY: 'x', STRIPE_SECRET_KEY: 'sk_live_y' });
    expect(found.map((k) => k.name)).toEqual(['ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY']);
    expect(demoKeyWarning({ SEED_DEMO: '1', ANTHROPIC_API_KEY: 'x', STRIPE_SECRET_KEY: 'sk_live_y' })?.msg).toMatch(/cost money/i);
  });

  it('treats an empty or whitespace value as unset — compose passes "" for every unset optional', () => {
    // docker-compose.yml defaults each optional integration to '', so a build
    // with no key still has the variable present and empty
    expect(billableKeysOnPublicDemo({ SEED_DEMO: '1', ANTHROPIC_API_KEY: '' })).toEqual([]);
    expect(billableKeysOnPublicDemo({ SEED_DEMO: '1', ANTHROPIC_API_KEY: '   ' })).toEqual([]);
    expect(billableKeysOnPublicDemo({ SEED_DEMO: '1', STRIPE_SECRET_KEY: '' })).toEqual([]);
  });

  it('does not fire on the free integrations — a warning per variable is a warning nobody reads', () => {
    expect(billableKeysOnPublicDemo({ SEED_DEMO: '1', EPC_BEARER_TOKEN: 'free-gov-api', JWT_SECRET: 's' })).toEqual([]);
  });
});
