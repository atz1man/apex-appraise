import { describe, expect, it } from 'vitest';
import { monthsBetween, spendAgainstProgramme } from '../src/index.js';

const base = {
  constructionTotal: 1_000_000,
  periodMonths: 10,
  profile: 'even' as const,
  monthsElapsed: 5,
  actualToDate: 500_000,
  progressPct: 50,
};

describe('spendAgainstProgramme', () => {
  it('calls it on budget when the money matches the works', () => {
    const d = spendAgainstProgramme(base);
    expect(d.expectedByProgress).toBe(500_000);
    expect(d.varianceOnProgress).toBe(0);
    expect(d.status).toBe('on budget');
  });

  it('judges on WORKS, not on the calendar', () => {
    /**
     * The case the whole module exists for: dead on the spend curve, and badly
     * overspent. Half the money is gone and a quarter of the building is up.
     * A programme-only view reports this as perfectly healthy.
     */
    const d = spendAgainstProgramme({ ...base, progressPct: 25 });
    expect(d.varianceOnProgramme).toBe(0); // the calendar says nothing is wrong
    expect(d.varianceOnProgress).toBe(250_000);
    expect(d.status).toBe('overspending');
  });

  it('does not call a job overspent for running early', () => {
    // ahead of the curve, but every pound is matched by works in the ground
    const d = spendAgainstProgramme({ ...base, monthsElapsed: 3, actualToDate: 500_000, progressPct: 50 });
    // computed through the spend profile, so compare like a float, not with toBe
    expect(d.varianceOnProgramme).toBeCloseTo(200_000, 6); // 2 months ahead of the curve
    expect(d.varianceOnProgress).toBe(0);
    expect(d.status).toBe('on budget');
  });

  it('treats a small difference as measurement, not a finding', () => {
    const d = spendAgainstProgramme({ ...base, actualToDate: 530_000 });
    expect(d.status).toBe('on budget'); // 3% — inside tolerance
    const worse = spendAgainstProgramme({ ...base, actualToDate: 560_000 });
    expect(worse.status).toBe('overspending'); // 6% — outside it
  });

  it('reports underspending as its own state, not as good news', () => {
    // half the programme gone, a quarter of the money spent: either a saving or
    // a job that has not really started, and the panel must not decide which
    const d = spendAgainstProgramme({ ...base, actualToDate: 250_000, progressPct: 50 });
    expect(d.status).toBe('underspending');
  });

  it('says nothing when there is nothing to say', () => {
    expect(spendAgainstProgramme({ ...base, monthsElapsed: 0, actualToDate: 0 }).status).toBe('not started');
    // no budget to measure against — "on budget" would be a statement about nothing
    expect(spendAgainstProgramme({ ...base, constructionTotal: 0 }).status).toBe('not started');
  });

  it('never runs past the end of the build period', () => {
    const d = spendAgainstProgramme({ ...base, monthsElapsed: 99 });
    expect(d.monthsElapsed).toBe(10);
    expect(d.timeElapsedPct).toBe(1);
    expect(d.expectedByProgramme).toBeCloseTo(1_000_000, 6);
  });

  it('follows the scheme’s own spend profile, not a straight line', () => {
    // an s-curve spends less early than an even profile — comparing against the
    // wrong curve would manufacture a variance the job does not have
    const even = spendAgainstProgramme({ ...base, monthsElapsed: 2, profile: 'even' });
    const scurve = spendAgainstProgramme({ ...base, monthsElapsed: 2, profile: 'scurve' });
    expect(scurve.expectedByProgramme).toBeLessThan(even.expectedByProgramme);
  });
});

describe('monthsBetween', () => {
  it('counts whole months from a programme start', () => {
    expect(monthsBetween({ year: 2026, month: 1 }, new Date(Date.UTC(2026, 6, 15)))).toBe(6); // Jan → Jul
    expect(monthsBetween({ year: 2025, month: 11 }, new Date(Date.UTC(2026, 1, 1)))).toBe(3); // Nov → Feb
  });

  it('floors at zero for a programme that has not started', () => {
    // a negative would quietly invert every comparison downstream
    expect(monthsBetween({ year: 2027, month: 6 }, new Date(Date.UTC(2026, 0, 1)))).toBe(0);
  });
});
