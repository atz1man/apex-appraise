import { beforeAll, describe, expect, it } from 'vitest';
import { demoFallbacksAllowed } from '../src/demo-mode.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Fabricating a result when the real integration is absent.
 *
 * Two features degrade to something plausible rather than failing, and in both
 * the trigger is the ABSENCE of configuration — which is not consent. A firm
 * that has deployed but not yet set up Stripe, or an AI key, is in exactly that
 * state on day one.
 *
 * What makes it dangerous is that the fabrication does not stay where it was
 * shown. Auto-Appraisal's warning banner lives on one screen; "Open full
 * appraisal" writes those units into a real Appraisal row, carrying citations
 * like "Drawing A-102" for a drawing this deal has never had, and `sample` is
 * not a column, so nothing downstream — the appraisal screen, the report, the
 * Red Book — can find out the figures were invented.
 */

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('DemoMode');
}, 120_000);

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.entries(env).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  try {
    await run();
  } finally {
    Object.entries(before).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  }
};

const extract = () =>
  callerFor(T.principal).autoAppraisal.extract({
    notes: 'Six trade counter units of about 2,500 sqft each, asking £1,200,000.',
  } as never);

describe('the switch itself', () => {
  it('is on outside production, so the flow can be exercised', async () => {
    await withEnv({ NODE_ENV: 'test', DEMO_MODE: undefined }, async () => {
      expect(demoFallbacksAllowed()).toBe(true);
    });
  });

  it('is off in production unless someone decided otherwise', async () => {
    await withEnv({ NODE_ENV: 'production', DEMO_MODE: undefined }, async () => {
      expect(demoFallbacksAllowed()).toBe(false);
    });
    await withEnv({ NODE_ENV: 'production', DEMO_MODE: '1' }, async () => {
      expect(demoFallbacksAllowed()).toBe(true);
    });
  });

  it('treats anything other than "1" as no', async () => {
    // "true", "yes" and "0" are all somebody guessing; only the documented value counts
    for (const v of ['0', 'true', 'yes', '']) {
      await withEnv({ NODE_ENV: 'production', DEMO_MODE: v }, async () => {
        expect(demoFallbacksAllowed(), `DEMO_MODE=${JSON.stringify(v)} was treated as consent`).toBe(false);
      });
    }
  });
});

describe('auto-appraisal with no AI key', () => {
  it('refuses in production rather than returning the worked example', async () => {
    await withEnv({ NODE_ENV: 'production', DEMO_MODE: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
      await expect(extract()).rejects.toThrow(/not configured.*Manual entry/is);
    });
  });

  it('still returns the sample on a demo instance, flagged as one', async () => {
    await withEnv({ NODE_ENV: 'production', DEMO_MODE: '1', ANTHROPIC_API_KEY: undefined }, async () => {
      const run = (await extract()) as { extraction: { sample?: boolean; units: Array<{ source: string }> } };
      expect(run.extraction.sample, 'the sample was returned without saying so').toBe(true);
      // the citations are the giveaway: they name documents this deal never had
      expect(run.extraction.units.some((u) => /Drawing A-102/.test(u.source))).toBe(true);
    });
  });

  it('still returns it in development, so the feature can be demonstrated', async () => {
    await withEnv({ NODE_ENV: 'test', DEMO_MODE: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
      expect(((await extract()) as { extraction: { sample?: boolean } }).extraction.sample).toBe(true);
    });
  });

  /**
   * The reason the refusal has to be server-side: nothing downstream can tell.
   * Appraisal has a `source` column ("manual | ai | field") and no `sample`, so
   * once saved, an invented scheme is indistinguishable from a read one.
   */
  it('has nowhere to record that a saved appraisal came from the sample', async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("Appraisal")');
    expect(columns.map((c) => c.name)).not.toContain('sample');
  });
});
