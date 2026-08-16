import { beforeAll, describe, expect, it } from 'vitest';
import { TRIAL_DAYS, allowedWhileExpired, trialEndFrom, trialStateOf } from '../src/trial.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The trial had no clock. TRIAL carried Starter's volumes and never ended, so the
 * "trial" was a free tier nobody decided to offer — three deals and two seats,
 * forever, for nothing.
 *
 * What matters as much as the ending is WHAT ENDS. An expired workspace must stay
 * readable: a valuer whose trial lapsed mid-instruction still has a client and a
 * signed engagement, and holding their own valuations hostage to a card detail is
 * a complaint to their regulator, not a collections strategy.
 */

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Clocked');
}, 120_000);

const setTrial = (orgId: string, endsAt: Date | null, plan = 'TRIAL') =>
  prisma.organisation.update({ where: { id: orgId }, data: { trialEndsAt: endsAt, plan } });

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe('the clock', () => {
  it('runs for the number of days the pricing page sells', () => {
    const start = new Date('2026-08-01T09:00:00Z');
    expect(trialEndFrom(start).toISOString()).toBe(new Date('2026-08-15T09:00:00Z').toISOString());
    expect(TRIAL_DAYS).toBe(14);
  });

  it('rounds the last partial day up, so a live trial never reads as zero', () => {
    const state = trialStateOf({ plan: 'TRIAL', trialEndsAt: new Date(Date.now() + 60 * 60 * 1000) });
    expect(state.expired).toBe(false);
    expect(state.daysLeft).toBe(1);
  });

  it('does not tick at all on a paid plan', () => {
    expect(trialStateOf({ plan: 'GROWTH', trialEndsAt: daysFromNow(-100) })).toEqual({
      endsAt: null,
      expired: false,
      daysLeft: null,
    });
  });
});

describe('an expired trial', () => {
  it('refuses a write, and says what ended and what lifts it', async () => {
    await setTrial(T.orgId, daysFromNow(-1));
    await expect(callerFor(T.principal).deals.create({ name: 'After the trial', address: '1 Test Street, Poole', assetType: 'RESIDENTIAL' } as never)).rejects.toThrow(
      /trial ended on .*choose a plan/is,
    );
  });

  it('still lets the firm read everything it owns', async () => {
    await setTrial(T.orgId, daysFromNow(-1));
    const deals = (await callerFor(T.principal).deals.list({} as never)) as { deals: unknown[] };
    expect(deals.deals.length).toBeGreaterThan(0);
    // the report a client is waiting on is a read, and stays available
    await expect(callerFor(T.principal).org.get()).resolves.toBeTruthy();
  });

  it('still lets the firm leave — export and deletion are not held to ransom', async () => {
    await setTrial(T.orgId, daysFromNow(-1));
    const file = (await callerFor(T.principal).org.exportData()) as { data: Record<string, unknown[]> };
    expect(Object.keys(file.data).length).toBeGreaterThan(15);
  });

  it('still lets them pay, which is the entire point', () => {
    /**
     * Asserted on the rule rather than by calling checkout: an earlier version of
     * this test DID call it, and — because the container has the sandbox key —
     * created a real Stripe Checkout session every run. A test that reaches a
     * third party is not testing this codebase.
     */
    expect(allowedWhileExpired('billing.checkout')).toBe(true);
    expect(allowedWhileExpired('auth.changePassword')).toBe(true);
    expect(allowedWhileExpired('org.exportData')).toBe(true);
    expect(allowedWhileExpired('org.deleteWorkspace')).toBe(true);
    // and everything else is not exempt, which is the half that matters
    for (const path of ['deals.create', 'appraisal.save', 'org.update', 'inspections.save']) {
      expect(allowedWhileExpired(path)).toBe(false);
    }
  });
});

describe('a live trial', () => {
  it('writes normally', async () => {
    await setTrial(T.orgId, daysFromNow(3));
    const deal = (await callerFor(T.principal).deals.create({ name: 'During the trial', address: '2 Test Street, Poole', assetType: 'RESIDENTIAL' } as never)) as { id: string };
    expect(deal.id).toBeTruthy();
  });

  it('is reported to the workspace before it bites', async () => {
    await setTrial(T.orgId, daysFromNow(3));
    const config = (await callerFor(T.principal).billing.config()) as { trial: { daysLeft: number | null; expired: boolean } };
    expect(config.trial.daysLeft).toBe(3);
    expect(config.trial.expired).toBe(false);
  });
});
