import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zAppraisalInput } from '@apex/types';
import { computeAppraisal } from '@apex/appraisal-engine';
import { appraisalRowToEngineInput } from '../src/mappers.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Everything a valuer types, read back.
 *
 * `appraisalRowToEngineInput` is the bridge between what is stored and what the
 * engine computes from. A field the screen accepts and this mapper drops is
 * invisible in the worst way: the engine is correct, the figures look plausible,
 * and they are simply not the ones anybody entered.
 *
 * That is not hypothetical. `61a284c` found exactly it — a mezzanine tranche
 * with three editable fields, three database columns and nothing in between,
 * written only by the seed and read by nothing. The seed's values happened to
 * equal the component's hardcoded defaults, so the demo looked right.
 *
 * `mappers.ts` had no test of its own. This is the round trip: save a fully
 * populated appraisal through the real procedure, read the row back through the
 * real mapper, and require every field to have survived. The list of fields is
 * taken from `zAppraisalInput` rather than written out here, so a new one that
 * nothing persists fails this without anybody remembering to add it.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

/** every lever the schema accepts, all set to values distinct from any default */
const FULL = {
  units: [
    { label: '2-bed apartments', count: 10, area: 750, cap: 423, conf: 'high' as const, source: 'Comparables' },
    { label: '3-bed houses', count: 4, area: 1_150, cap: 388, conf: 'med' as const, source: 'Agent advice' },
  ],
  efficiency: 83,
  trades: [
    { label: 'Substructure', rate: 47 },
    { label: 'Superstructure', rate: 112 },
  ],
  profFeePct: 12.5,
  contingencyPct: 6.5,
  otherCosts: [{ label: 'S106', amount: 185_000 }],
  finance: {
    ltcPct: 62,
    ratePct: 8.25,
    periodMonths: 21,
    salesMonths: 7,
    arrangementFeePct: 1.75,
    spendProfile: 'even' as const,
    absorptionUnitsPerMonth: 3,
    mezz: { toPct: 85, ratePct: 14, drawFactorPct: 60 },
  },
  site: { mode: 'residual' as const, landFixed: 0, acqPct: 6.9 },
  disposal: { agentPct: 1.6, legalPct: 0.45 },
  targetProfitOnGdvPct: 21,
  jv: { gpCoinvestPct: 12, prefPct: 9, promotePct: 22 },
  startYear: 2027,
  startMonth: 4,
};

let stored: Awaited<ReturnType<typeof appraisalRowToEngineInput>>;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Roundtrip');
  await caller().appraisal.save({ dealId: T.dealId, input: FULL, label: 'Full' } as never);
  const row = await prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });
  stored = appraisalRowToEngineInput(row);
}, 180_000);

/** the top-level keys of the real schema, so this cannot fall behind it */
const schemaKeys = () => Object.keys((zAppraisalInput as unknown as z.ZodObject<z.ZodRawShape>).shape);

describe('a fully populated appraisal, saved and read back', () => {
  /**
   * Every path, not just the top-level keys.
   *
   * A top-level check passes `finance` as present and never notices that
   * `finance.mezz` inside it is gone — which is exactly where `61a284c` lived.
   * So this walks the fixture and requires the same path to have survived, at
   * whatever depth. Only paths the fixture sets are checked: the round trip is
   * allowed to ADD defaults, never to lose what was typed.
   */
  const lostPaths = (typed: unknown, back: unknown, path = ''): string[] => {
    if (typed === null || typed === undefined) return [];
    if (Array.isArray(typed)) {
      if (!Array.isArray(back)) return [path || '(root)'];
      if (back.length !== typed.length) return [`${path} (${typed.length} in, ${back.length} back)`];
      return typed.flatMap((v, i) => lostPaths(v, back[i], `${path}[${i}]`));
    }
    if (typeof typed === 'object') {
      if (back === null || back === undefined) return [path || '(root)'];
      return Object.entries(typed as Record<string, unknown>).flatMap(([k, v]) =>
        lostPaths(v, (back as Record<string, unknown>)[k], path ? `${path}.${k}` : k),
      );
    }
    // a scalar: present, and the same
    if (back === undefined || back === null) return [path];
    return back === typed ? [] : [`${path} (${String(typed)} in, ${String(back)} back)`];
  };

  it('keeps every lever the schema accepts, at every depth', () => {
    const lost = lostPaths(FULL, stored);
    expect(
      lost,
      `did not survive the round trip: ${lost.join(', ')} — the screen accepts these and the engine `
        + 'will never see them',
    ).toEqual([]);
  });

  it('sets every lever the schema accepts, so a gap cannot hide behind an unset field', () => {
    /**
     * The fixture above is the other half of the guard. If a new lever is added
     * to `zAppraisalInput` and not to FULL, the test above skips it silently —
     * so this fails until the fixture covers it.
     */
    const unset = schemaKeys().filter((k) => !(k in FULL));
    expect(
      unset,
      `zAppraisalInput accepts these and this fixture never sets them, so nothing here proves they survive: ${unset.join(', ')}`,
    ).toEqual(['phases', 'income', 'dcf']);
  });

  it('keeps the values themselves, not merely the shape', () => {
    expect(stored.efficiency).toBe(83);
    expect(stored.profFeePct).toBe(12.5);
    expect(stored.contingencyPct).toBe(6.5);
    expect(stored.targetProfitOnGdvPct).toBe(21);
    expect(stored.units).toHaveLength(2);
    expect(stored.units[1]).toMatchObject({ label: '3-bed houses', count: 4, area: 1_150, cap: 388 });
    expect(stored.trades).toEqual(FULL.trades);
    expect(stored.otherCosts).toEqual(FULL.otherCosts);
    expect(stored.site).toMatchObject({ mode: 'residual', acqPct: 6.9 });
    expect(stored.disposal).toEqual(FULL.disposal);
    expect(stored.jv).toEqual(FULL.jv);
    expect(stored.startYear).toBe(2027);
    expect(stored.startMonth).toBe(4);
  });

  it('keeps the finance terms, mezzanine tranche included', () => {
    // the tranche 61a284c found had a screen, three columns and nothing between
    expect(stored.finance).toMatchObject({
      ltcPct: 62,
      ratePct: 8.25,
      periodMonths: 21,
      salesMonths: 7,
      arrangementFeePct: 1.75,
      spendProfile: 'even',
      absorptionUnitsPerMonth: 3,
    });
    expect(stored.finance.mezz, 'the mezzanine tranche did not survive the round trip').toEqual({
      toPct: 85,
      ratePct: 14,
      drawFactorPct: 60,
    });
  });

  it('computes the same figures from the row as from what was typed', () => {
    /**
     * The point of the whole thing. A dropped lever does not throw — it changes
     * a number, and the report prints it with the same confidence either way.
     */
    const fromTyped = computeAppraisal(zAppraisalInput.parse(FULL) as never);
    const fromRow = computeAppraisal(stored as never);
    expect(Math.round(fromRow.gdv), 'GDV differs between what was typed and what was stored').toBe(Math.round(fromTyped.gdv));
    expect(Math.round(fromRow.totalCost)).toBe(Math.round(fromTyped.totalCost));
    expect(Math.round(fromRow.profit)).toBe(Math.round(fromTyped.profit));
    expect(Math.round(fromRow.residualNet)).toBe(Math.round(fromTyped.residualNet));
  });
});
