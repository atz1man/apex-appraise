import { describe, expect, it } from 'vitest';
import { compareAppraisals, type AppraisalInput } from '../src/index.js';

/**
 * The diff exists to answer "what changed, and what did it do to the answer?".
 * These tests hold it to that: the things a reviewer would ask about must appear,
 * and the things nobody changed must not.
 */

const base: AppraisalInput = {
  units: [
    { label: '2-bed apartments', count: 10, area: 750, cap: 420 },
    { label: '3-bed houses', count: 4, area: 1150, cap: 380 },
  ],
  efficiency: 85,
  trades: [
    { label: 'Substructure', rate: 40 },
    { label: 'Superstructure', rate: 110 },
  ],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [{ label: 'Planning', amount: 120_000 }],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

const clone = (i: AppraisalInput): AppraisalInput => JSON.parse(JSON.stringify(i));
const find = (d: ReturnType<typeof compareAppraisals>, path: string) => d.changes.find((c) => c.path === path);

describe('compareAppraisals', () => {
  it('reports nothing when nothing changed', () => {
    const d = compareAppraisals(base, clone(base));
    expect(d.changes).toEqual([]);
    expect(d.identical).toBe(true);
  });

  it('names the trade that moved, and leaves the others alone', () => {
    const after = clone(base);
    after.trades[1]!.rate = 120;
    const d = compareAppraisals(base, after);
    // the review question — "who changed the build rate from 110 to 120" — is
    // answerable from this single row
    expect(find(d, 'trades.Superstructure')).toMatchObject({ kind: 'changed', before: 110, after: 120, unit: 'psf' });
    expect(find(d, 'trades.Substructure')).toBeUndefined();
    expect(d.changes).toHaveLength(1);
  });

  it('separates a unit re-pricing from a unit re-count', () => {
    const after = clone(base);
    after.units[0]!.cap = 450; // re-priced
    after.units[1]!.count = 6; // re-counted
    const d = compareAppraisals(base, after);
    // one derived "value" figure would have hidden which of the two moved
    expect(find(d, 'units.cap.2-bed apartments')).toMatchObject({ before: 420, after: 450 });
    expect(find(d, 'units.count.3-bed houses')).toMatchObject({ before: 4, after: 6 });
  });

  it('reports added and removed lines, not just edited ones', () => {
    const after = clone(base);
    after.trades.push({ label: 'External works', rate: 15 });
    after.otherCosts = [];
    const d = compareAppraisals(base, after);
    expect(find(d, 'trades.External works')).toMatchObject({ kind: 'added', before: null, after: 15 });
    expect(find(d, 'otherCosts.Planning')).toMatchObject({ kind: 'removed', before: 120_000, after: null });
  });

  it('does not invent a change from floating-point noise', () => {
    const after = clone(base);
    after.finance.ratePct = 7.5 + 1e-12;
    expect(compareAppraisals(base, after).changes).toEqual([]);
  });

  it('reports a rephasing as a fact without burying the scalars', () => {
    const after = clone(base);
    after.phases = [
      { name: 'Phase 1', start: 1, buildMonths: 9, salesMonths: 4, units: base.units },
      { name: 'Phase 2', start: 10, buildMonths: 9, salesMonths: 4, units: [] },
    ];
    after.finance.ratePct = 8;
    const d = compareAppraisals(base, after);
    expect(find(d, 'phases')).toMatchObject({ before: 0, after: 2 });
    // the rate change is still visible and not drowned by per-phase detail
    expect(find(d, 'finance.ratePct')).toMatchObject({ before: 7.5, after: 8 });
    expect(d.changes.length).toBeLessThan(5);
  });

  it('notices a yield move on a held element', () => {
    const withIncome = clone(base);
    withIncome.income = { lines: [{ label: 'Shops', count: 2, area: 1000, rentPsf: 18 }], nonRecoverablePct: 3, yieldPct: 6 };
    const after = clone(withIncome);
    after.income!.yieldPct = 6.5;
    const d = compareAppraisals(withIncome, after);
    expect(find(d, 'income.yieldPct')).toMatchObject({ before: 6, after: 6.5, unit: 'pct' });
  });

  it('reads in the order a reviewer scans: what we build before how it is funded', () => {
    const after = clone(base);
    after.finance.ratePct = 8;
    after.efficiency = 88;
    const d = compareAppraisals(base, after);
    expect(d.changes.map((c) => c.path)).toEqual(['efficiency', 'finance.ratePct']);
  });
});
