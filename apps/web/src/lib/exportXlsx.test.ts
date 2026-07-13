import { describe, expect, it } from 'vitest';
import { computeAppraisal, jvWaterfall, cilCharge, type AppraisalInput } from '@apex/appraisal-engine';
import { buildAppraisalWorkbook } from './exportXlsx';

/**
 * Workbook regression — built from the engine's Bournemouth golden fixture so
 * any drift in sheets, formats or figures fails loudly. Node-side: no browser.
 */

const CIL_REF = cilCharge(20888.888888888887, 4);
const referenceCase: AppraisalInput = {
  units: [
    { label: 'Trade counter units', count: 6, area: 2600, cap: 225 },
    { label: 'Mezzanine offices', count: 1, area: 3200, cap: 240 },
  ],
  efficiency: 90,
  trades: [{ label: 'Build', rate: 105 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [
    { label: 'Planning & S106', amount: 150000 },
    { label: 'CIL', amount: CIL_REF },
  ],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 3, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 350000, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
  jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
};

const monthLabel = (idx: number) => `M${idx}`;

describe('buildAppraisalWorkbook', async () => {
  const R = computeAppraisal(referenceCase, { withCash: true });
  const jv = jvWaterfall(R.equity, R.profit, R.holdYears, referenceCase.jv!);
  const wb = await buildAppraisalWorkbook({
    dealName: 'Golden Fixture Works',
    address: 'Bournemouth',
    input: referenceCase,
    R,
    jv,
    monthLabel,
  });

  it('carries all seven sheets in order', () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Unit schedule',
      'Residual appraisal',
      'Cashflow',
      'JV returns',
      'Risk & sensitivity',
      'Assumptions',
    ]);
  });

  it('summary GDV matches the golden figure with the £ format', () => {
    const s = wb.getWorksheet('Summary')!;
    let found = false;
    s.eachRow((row) => {
      if (String(row.getCell(1).value).startsWith('Gross development value')) {
        expect(row.getCell(2).value).toBe(4278000);
        expect(row.getCell(2).numFmt).toBe('"£"#,##0;[Red]-"£"#,##0');
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('sensitivity matrix: 5×5, base cell bold and equal to base return on cost', () => {
    const rs = wb.getWorksheet('Risk & sensitivity')!;
    const matrixRows: number[][] = [];
    let baseCell: { value: number; bold: boolean } | null = null;
    rs.eachRow((row) => {
      const label = String(row.getCell(1).value ?? '');
      if (label.startsWith('Build ')) {
        const vals = [2, 3, 4, 5, 6].map((c) => Number(row.getCell(c).value));
        matrixRows.push(vals);
        if (label === 'Build base') {
          const c = row.getCell(4);
          baseCell = { value: Number(c.value), bold: Boolean(c.font?.bold) };
        }
      }
    });
    expect(matrixRows).toHaveLength(5);
    expect(matrixRows.every((r) => r.length === 5 && r.every(Number.isFinite))).toBe(true);
    expect(baseCell).not.toBeNull();
    expect(baseCell!.bold).toBe(true);
    expect(baseCell!.value).toBeCloseTo(R.poc, 6);
  });

  it('Monte Carlo block: percentile ordering and % formats', () => {
    const rs = wb.getWorksheet('Risk & sensitivity')!;
    const byLabel: Record<string, { value: number; fmt: string }> = {};
    rs.eachRow((row) => {
      const label = String(row.getCell(1).value ?? '');
      if (label.startsWith('Profit P') || label.startsWith('Probability') || label.startsWith('Return on cost P')) {
        byLabel[label] = { value: Number(row.getCell(2).value), fmt: String(row.getCell(2).numFmt) };
      }
    });
    expect(byLabel['Profit P10 (downside)'].value).toBeLessThanOrEqual(byLabel['Profit P50 (median)'].value);
    expect(byLabel['Profit P50 (median)'].value).toBeLessThanOrEqual(byLabel['Profit P90 (upside)'].value);
    expect(byLabel['Profit P50 (median)'].fmt).toBe('"£"#,##0;[Red]-"£"#,##0');
    expect(byLabel['Probability profit ≥ target'].fmt).toBe('0.0%');
    expect(byLabel['Probability of loss'].value).toBeGreaterThanOrEqual(0);
    expect(byLabel['Probability of loss'].value).toBeLessThanOrEqual(1);
  });
});
