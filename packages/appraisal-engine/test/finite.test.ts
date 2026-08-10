import { describe, expect, it } from 'vitest';
import { computeAppraisal, type AppraisalInput } from '../src/index.js';

/**
 * Nothing non-finite may escape the engine.
 *
 * A NaN or an Infinity that reaches a report is not a display bug — it is a
 * figure in a signed valuation carried by professional indemnity. The inputs
 * below are all ones a user can actually save (the zod schema permits them), so
 * this is the real surface rather than a theoretical one: zero units, zero area,
 * a nil yield, a hundred-percent loan, a one-month programme.
 */

const base: AppraisalInput = {
  units: [{ label: 'Units', count: 10, area: 800, cap: 400 }],
  efficiency: 85,
  trades: [{ label: 'Build', rate: 150 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

/** Every number anywhere in the result, with the path that produced it. */
function numbers(value: unknown, path = ''): Array<[string, number]> {
  if (typeof value === 'number') return [[path || 'root', value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbers(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => numbers(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const CASES: Array<[string, AppraisalInput]> = [
  ['no units at all', { ...base, units: [] }],
  ['a unit with zero count', { ...base, units: [{ label: 'U', count: 0, area: 800, cap: 400 }] }],
  ['a unit with zero area', { ...base, units: [{ label: 'U', count: 5, area: 0, cap: 400 }] }],
  ['a unit worth nothing per foot', { ...base, units: [{ label: 'U', count: 5, area: 800, cap: 0 }] }],
  ['everything zero', { ...base, units: [{ label: 'U', count: 0, area: 0, cap: 0 }] }],
  ['no trades', { ...base, trades: [] }],
  ['a free build', { ...base, trades: [{ label: 'Build', rate: 0 }] }],
  ['efficiency at its floor', { ...base, efficiency: 0.0001 }],
  ['efficiency above 100', { ...base, efficiency: 120 }],
  ['a one-month programme', { ...base, finance: { ...base.finance, periodMonths: 1, salesMonths: 1 } }],
  ['a fully debt-funded scheme', { ...base, finance: { ...base.finance, ltcPct: 100 } }],
  ['no debt at all', { ...base, finance: { ...base.finance, ltcPct: 0 } }],
  ['a nil interest rate', { ...base, finance: { ...base.finance, ratePct: 0 } }],
  ['a punitive interest rate', { ...base, finance: { ...base.finance, ratePct: 40 } }],
  ['land priced above the scheme', { ...base, site: { mode: 'profit', landFixed: 999_000_000, acqPct: 6.8 } }],
  ['a target profit of 100% of GDV', { ...base, targetProfitOnGdvPct: 100 }],
  ['absorption of a fraction of a unit', { ...base, finance: { ...base.finance, absorptionUnitsPerMonth: 0.01 } }],
  ['a rent roll with no rent', {
    ...base,
    income: { lines: [{ label: 'Shop', count: 1, area: 1000, rentPsf: 0 }], nonRecoverablePct: 0, yieldPct: 5 },
  }],
  ['a nil yield', {
    ...base,
    income: { lines: [{ label: 'Shop', count: 1, area: 1000, rentPsf: 20 }], nonRecoverablePct: 0, yieldPct: 0 },
  }],
  ['every deduction at once', {
    ...base,
    income: { lines: [{ label: 'Shop', count: 1, area: 1000, rentPsf: 20, voidPct: 100 }], nonRecoverablePct: 100, yieldPct: 5 },
  }],
  ['a phase with no units', {
    ...base,
    units: [],
    phases: [{ name: 'P1', start: 1, buildMonths: 6, salesMonths: 3, units: [] }],
  }],
];

describe('the engine never emits a figure that is not a number', () => {
  for (const [label, input] of CASES) {
    it(`survives ${label}`, () => {
      const result = computeAppraisal(input, { withCash: true });
      const bad = numbers(result).filter(([, v]) => !Number.isFinite(v));
      expect(bad.map(([p, v]) => `${p}=${v}`), `non-finite figures would print into a signed valuation`).toEqual([]);
    });
  }
});
