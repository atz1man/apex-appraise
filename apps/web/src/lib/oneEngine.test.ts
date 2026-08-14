import { describe, expect, it } from 'vitest';
import { autoAppraise, computeAppraisal, jvWaterfall, type AppraisalInput } from '@apex/appraisal-engine';
import { buildAppraisalWorkbook } from './exportXlsx';

/**
 * One engine behind every surface.
 *
 * The product claims this publicly, so it should be enforced rather than
 * asserted. The failure it guards against is not a crash: it is a screen and an
 * export quoting different profits for the same scheme, both looking equally
 * authoritative, with no way for a reader to tell which is wrong.
 *
 * Surfaces re-deriving engine arithmetic in their own code is how that starts —
 * the scenario table used to re-add the cost lines and regross the land with its
 * own copy of the acquisition-cost rule, and the valuation workbench seeded its
 * "cost" and "income" approaches at 97% and 99% of the sales figure.
 */

const scheme: AppraisalInput = {
  units: [{ label: 'Apartments', count: 24, area: 820, cap: 385 }],
  efficiency: 85,
  trades: [{ label: 'Build', rate: 168 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [{ label: 'Planning & S106', amount: 240_000 }],
  finance: { ltcPct: 62, ratePct: 8.25, periodMonths: 20, salesMonths: 5, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
  jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
};

/** Read a numeric cell from a built worksheet, by the label in the column beside it. */
function figureFromSheet(sheet: { getRow: (n: number) => { getCell: (n: number) => { value: unknown } }; rowCount: number }, label: string) {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (String(row.getCell(1).value ?? '').trim().toLowerCase() === label.toLowerCase()) {
      for (let c = 2; c <= 6; c++) {
        const v = row.getCell(c).value;
        if (typeof v === 'number') return v;
      }
    }
  }
  return null;
}

describe('the screen and the export quote the same figures', () => {
  it('agrees on GDV, total cost, profit and profit on cost', async () => {
    const R = computeAppraisal(scheme, { withCash: true });
    /**
     * No `as never` here. The first version of this test cast the argument and
     * the cast hid a wrong property name — the builder takes `R`, not `result` —
     * so the call compiled and failed at runtime instead. A cast that silences
     * the checker on the exact call being tested defeats the test.
     */
    const wb = await buildAppraisalWorkbook({
      dealName: 'One Engine Test',
      address: '1 Consistency Road',
      input: scheme,
      R,
      jv: jvWaterfall(R.equity, R.profit, R.holdYears, scheme.jv!),
      monthLabel: (idx: number) => `M${idx}`,
    });

    const summary = wb.worksheets[0]!;
    const cell = (label: string) => figureFromSheet(summary as never, label);

    /**
     * Exact equality, not a tolerance. The workbook is built FROM the engine
     * result, so a near-miss would mean somebody had started recomputing —
     * which is the drift this exists to catch, and a tolerance would hide it.
     */
    expect(cell('Gross development value (GDV)'), 'GDV missing from the summary sheet').toBe(Math.round(R.gdv));
    expect(cell('Developer profit')).toBe(Math.round(R.profit));
    expect(cell('Total development cost')).toBe(Math.round(R.totalCost));
    expect(cell('Return on cost')).toBe(R.poc);
    expect(cell('Residual land value (net)')).toBe(Math.round(R.residualNet));

    // the identity the whole appraisal rests on, carried intact into the export
    expect(cell('Developer profit')! + cell('Total development cost')!).toBeCloseTo(Math.round(R.gdv), 0);
  });
});

describe('autoAppraise and computeAppraisal describe the same scheme', () => {
  /**
   * Two entry points exist because the quick appraisal takes flat inputs and the
   * full one takes structured ones. They must not become two different opinions
   * about the same development.
   */
  it('produces the same GDV and build cost from equivalent inputs', () => {
    const full = computeAppraisal(scheme);
    const quick = autoAppraise({
      units: [{ label: 'Apartments', count: 24, area: 820, cap: 385 }],
      efficiency: 85,
      buildPerSqft: 168,
      profFeePct: 11,
      contingencyPct: 5,
      cilPerSqm: 0,
      s106: 240_000,
      agentPct: 1.5,
      legalPct: 0.5,
      ltcPct: 62,
      ratePct: 8.25,
      periodMonths: 20,
      salesMonths: 5,
      arrangementFeePct: 1.5,
      targetProfitPct: 20,
      acqPct: 6.8,
      asking: 0,
    });

    expect(quick.gdv).toBeCloseTo(full.gdv, 6);
    expect(quick.gia).toBeCloseTo(full.gia, 6);
    expect(quick.build).toBeCloseTo(full.build, 6);
    expect(quick.fees).toBeCloseTo(full.fees, 6);
    expect(quick.saleCosts).toBeCloseTo(full.saleCosts, 6);
  });

  it('exposes cost and return at the residual, so no caller has to re-derive them', () => {
    const quick = autoAppraise({
      units: [{ label: 'Apartments', count: 24, area: 820, cap: 385 }],
      efficiency: 85,
      buildPerSqft: 168,
      profFeePct: 11,
      contingencyPct: 5,
      cilPerSqm: 0,
      s106: 240_000,
      agentPct: 1.5,
      legalPct: 0.5,
      ltcPct: 62,
      ratePct: 8.25,
      periodMonths: 20,
      salesMonths: 5,
      arrangementFeePct: 1.5,
      targetProfitPct: 20,
      acqPct: 6.8,
      asking: 0,
    });
    // the scenario screen used to compute these three itself
    expect(quick.totalCost).toBeGreaterThan(0);
    expect(quick.profit).toBeCloseTo(quick.targetProfit, 6);
    expect(quick.poc).toBeCloseTo(quick.profit / quick.totalCost, 10);
  });
});
