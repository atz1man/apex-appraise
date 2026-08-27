import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The mezzanine tranche, which the appraisal page could not save.
 *
 * The Capital stack panel offers three editable terms — "Mezzanine to",
 * "Mezzanine rate" and "Avg drawn factor". They were component state. Measured
 * in a browser: after changing the mezzanine rate from 12 to 18 the Save button
 * still read "Saved" and was still disabled, so the appraisal never registered
 * the change and a reload restored the default.
 *
 * `Appraisal.mezzToPct`, `mezzRatePct` and `drawFactorPct` had columns the whole
 * time — written by the seed and read by nothing.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const input = (mezz?: { toPct: number; ratePct: number; drawFactorPct: number }) => ({
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate: 110 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve', ...(mezz ? { mezz } : {}) },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

const MEZZ = { toPct: 75, ratePct: 18, drawFactorPct: 40 };
const loaded = async () =>
  (await caller().appraisal.getCurrent(T.dealId)) as {
    input: { finance: { mezz?: { toPct: number; ratePct: number; drawFactorPct: number } } };
    result: { profit: number; interest: number; poc: number };
  };

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Mezzanine');
}, 120_000);

describe('the terms survive a save', () => {
  it('comes back exactly as it was typed', async () => {
    await caller().appraisal.save({ dealId: T.dealId, input: input(MEZZ), label: 'Geared' } as never);
    expect((await loaded()).input.finance.mezz, 'the mezzanine terms were discarded on save').toEqual(MEZZ);
  });

  it('reaches the columns that were always there', async () => {
    const row = await prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });
    expect(row.mezzToPct).toBe(75);
    expect(row.mezzRatePct).toBe(18);
    expect(row.drawFactorPct).toBe(40);
  });

  it('can be changed and changed back', async () => {
    const held = await prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });
    await caller().appraisal.save({
      dealId: T.dealId,
      input: input({ ...MEZZ, ratePct: 14 }),
      expectedUpdatedAt: held.updatedAt,
    } as never);
    expect((await loaded()).input.finance.mezz!.ratePct).toBe(14);
  });
});

describe('an appraisal with no tranche', () => {
  it('carries none rather than a default one', async () => {
    // three columns with a default of 55 on drawFactorPct meant an appraisal
    // that never had a mezzanine could come back looking as though it did
    const other = await makeTenant('Ungeared');
    await callerFor(other.principal).appraisal.save({ dealId: other.dealId, input: input(), label: 'Base' } as never);
    const cur = (await callerFor(other.principal).appraisal.getCurrent(other.dealId)) as {
      input: { finance: { mezz?: unknown } };
    };
    expect(cur.input.finance.mezz).toBeUndefined();
  });

  it('computes exactly what it did before the tranche existed', async () => {
    /**
     * The point of the tranche being optional: every appraisal saved before this
     * has no mezzanine, and not one of its figures may move. The engine's
     * finance cost is senior-only either way — see FinanceInput.mezz.
     */
    const a = await makeTenant('Ungeared A');
    const b = await makeTenant('Ungeared B');
    const withNone = (await callerFor(a.principal).appraisal.save({ dealId: a.dealId, input: input() } as never)) as {
      result: { profit: number; interest: number; poc: number; residualNet: number };
    };
    const withMezz = (await callerFor(b.principal).appraisal.save({ dealId: b.dealId, input: input(MEZZ) } as never)) as {
      result: { profit: number; interest: number; poc: number; residualNet: number };
    };
    for (const k of ['profit', 'interest', 'poc', 'residualNet'] as const) {
      expect(withMezz.result[k], `${k} moved because a mezzanine was declared`).toBeCloseTo(withNone.result[k], 6);
    }
  });
});
