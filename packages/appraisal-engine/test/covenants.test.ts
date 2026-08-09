import { describe, expect, it } from 'vitest';
import { COVENANT_SUGGESTIONS, testCovenants } from '../src/index.js';

const m = { facility: 6_500_000, totalCost: 9_000_000, gdv: 10_000_000, profit: 1_800_000 };

describe('testCovenants', () => {
  it('tests nothing, and says so, when the firm has set no limits', () => {
    /**
     * The point of the module. A breach measured against a threshold nobody
     * agreed to is an accusation, not a finding — and the first time a panel
     * cries wolf about an invented limit is the last time anyone reads it.
     */
    const r = testCovenants(m, {});
    expect(r.tests).toEqual([]);
    expect(r.breaches).toEqual([]);
    expect(r.untested).toBe(true);
  });

  it('tests only the limits that were actually set', () => {
    const r = testCovenants(m, { ltgdvMaxPct: 65 });
    expect(r.tests.map((t) => t.key)).toEqual(['ltgdv']);
    expect(r.untested).toBe(false);
  });

  it('measures headroom in the direction the covenant runs', () => {
    const r = testCovenants(m, { ltgdvMaxPct: 70, minProfitOnCostPct: 15 });
    const ltgdv = r.tests.find((t) => t.key === 'ltgdv')!;
    // a maximum: room is what is left below the limit
    expect(ltgdv.actualPct).toBeCloseTo(65, 6);
    expect(ltgdv.headroomPts).toBeCloseTo(5, 6);
    expect(ltgdv.breached).toBe(false);

    const poc = r.tests.find((t) => t.key === 'profitOnCost')!;
    // a minimum: room is what is left ABOVE it, so the sign does not flip
    expect(poc.actualPct).toBeCloseTo(20, 6);
    expect(poc.headroomPts).toBeCloseTo(5, 6);
    expect(poc.breached).toBe(false);
  });

  it('breaches a maximum from above and a minimum from below', () => {
    const r = testCovenants(m, { ltgdvMaxPct: 60, minProfitOnCostPct: 25 });
    expect(r.breaches.map((b) => b.key).sort()).toEqual(['ltgdv', 'profitOnCost']);
    expect(r.tests.find((t) => t.key === 'ltgdv')!.headroomPts).toBeCloseTo(-5, 6);
    expect(r.tests.find((t) => t.key === 'profitOnCost')!.headroomPts).toBeCloseTo(-5, 6);
  });

  it('does not report a ratio it cannot compute', () => {
    // 0% loan to GDV on a deal with no GDV would read as an exceptionally safe
    // loan, which is the opposite of what it means
    const r = testCovenants({ facility: 500_000, totalCost: 0, gdv: 0, profit: 0 }, COVENANT_SUGGESTIONS);
    expect(r.tests).toEqual([]);
    expect(r.untested).toBe(true);
  });

  it('offers suggestions without applying them', () => {
    // they exist so a firm has somewhere sensible to start, not so the software
    // can assume the terms of someone else's loan
    expect(COVENANT_SUGGESTIONS.ltgdvMaxPct).toBe(65);
    expect(testCovenants(m, {}).untested).toBe(true);
  });
});
