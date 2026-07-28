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

/**
 * Investment method — a rent roll adds a 'Rent roll' sheet and the unit-schedule
 * GDV total has to keep reconciling to the engine once part of the value is
 * capitalised rather than sold.
 */
describe('buildAppraisalWorkbook — with a held element', async () => {
  const holdCase: AppraisalInput = {
    ...referenceCase,
    income: {
      lines: [{ label: 'Retail parade', count: 4, area: 1500, rentPsf: 18, voidPct: 4 }],
      nonRecoverablePct: 5,
      annualDeductions: 1200,
      yieldPct: 7.25,
      purchaserCostsPct: 6.8,
      letUpMonths: 6,
    },
  };
  const R2 = computeAppraisal(holdCase, { withCash: true });
  const jv2 = jvWaterfall(R2.equity, R2.profit, R2.holdYears, holdCase.jv!);
  const wb2 = await buildAppraisalWorkbook({
    dealName: 'Golden Fixture Works',
    address: 'Bournemouth',
    input: holdCase,
    R: R2,
    jv: jv2,
    monthLabel,
  });

  it('inserts the Rent roll sheet after the unit schedule', () => {
    expect(wb2.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Unit schedule',
      'Rent roll',
      'Residual appraisal',
      'Cashflow',
      'JV returns',
      'Risk & sensitivity',
      'Assumptions',
    ]);
  });

  it('carries the capitalised value into the unit schedule so GDV still reconciles', () => {
    const u = wb2.getWorksheet('Unit schedule')!;
    let capitalised: number | null = null;
    u.eachRow((row) => {
      if (String(row.getCell(1).value ?? '').startsWith('Capitalised investment value')) {
        capitalised = row.getCell(5).value as number;
      }
    });
    expect(capitalised).not.toBeNull();
    expect(capitalised).toBe(Math.round(R2.investmentValue));
    // units sold + capitalised = the engine's GDV
    const unitsTotal = holdCase.units.reduce((a, x) => a + x.count * x.area * x.cap, 0);
    expect(unitsTotal + (capitalised as unknown as number)).toBeCloseTo(Math.round(R2.gdv), 0);
  });

  it('states the capitalisation ladder with £ formats and the net initial yield', () => {
    const rr = wb2.getWorksheet('Rent roll')!;
    const labels: string[] = [];
    let ncv: number | null = null;
    let niyFmt = '';
    rr.eachRow((row) => {
      const label = String(row.getCell(1).value ?? '');
      labels.push(label);
      // the rent roll gained ERV/review/yield columns, so amounts sit in column 9
      if (label.startsWith('Investment value in GDV')) {
        ncv = row.getCell(9).value as number;
        expect(row.getCell(9).numFmt).toBe('"£"#,##0;[Red]-"£"#,##0');
      }
      if (label === 'Net initial yield') niyFmt = row.getCell(9).numFmt ?? '';
    });
    expect(labels.some((l) => l.startsWith('Gross capital value — YP'))).toBe(true);
    expect(labels.some((l) => l.startsWith("Purchaser's costs"))).toBe(true);
    expect(labels.some((l) => l.startsWith('Let-up void'))).toBe(true);
    expect(ncv).toBe(Math.round(R2.investmentValue));
    expect(niyFmt).toBe('0.0%');
  });

  it('omits the Rent roll sheet when there is no held element', async () => {
    const plain = await buildAppraisalWorkbook({
      dealName: 'Golden Fixture Works',
      address: 'Bournemouth',
      input: referenceCase,
      R: computeAppraisal(referenceCase, { withCash: true }),
      jv: jv2,
      monthLabel,
    });
    expect(plain.worksheets.map((w) => w.name)).not.toContain('Rent roll');
  });
});

/**
 * Period summaries — the workbook has to read the same ledger quarterly and
 * annually, and the buckets must reconcile to the monthly rows.
 */
describe('buildAppraisalWorkbook — cashflow period summaries', async () => {
  const R3 = computeAppraisal(referenceCase, { withCash: true });
  const wb3 = await buildAppraisalWorkbook({
    dealName: 'Golden Fixture Works',
    address: 'Bournemouth',
    input: { ...referenceCase, startYear: 2026, startMonth: 6 },
    R: R3,
    jv: jvWaterfall(R3.equity, R3.profit, R3.holdYears, referenceCase.jv!),
    monthLabel,
  });

  it('adds quarterly and annual blocks under the monthly ledger', () => {
    const cf = wb3.getWorksheet('Cashflow')!;
    const labels: string[] = [];
    cf.eachRow((row) => labels.push(String(row.getCell(1).value ?? '')));
    expect(labels).toContain('Quarterly summary');
    expect(labels).toContain('Annual summary');
    expect(labels.some((l) => l.startsWith('Q1 · Jul–Sep'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Year 1 · Jul'))).toBe(true);
  });

  it('annual costs add back to the monthly ledger', () => {
    const cf = wb3.getWorksheet('Cashflow')!;
    let inAnnual = false;
    let annualCost = 0;
    cf.eachRow((row) => {
      const label = String(row.getCell(1).value ?? '');
      if (label === 'Annual summary') {
        inAnnual = true;
        return;
      }
      if (inAnnual && label.startsWith('Year ')) annualCost += Number(row.getCell(2).value ?? 0);
    });
    const monthly = (R3.cash?.rows ?? []).reduce((a, r) => a + Math.round(r.cost), 0);
    // rounding is per row on both sides, so allow a pound or two of drift
    expect(Math.abs(annualCost - monthly)).toBeLessThan(25);
  });
});

/** Branding: a firm's workbook carries its name, not the product's. */
describe('buildAppraisalWorkbook — firm branding', async () => {
  const R4 = computeAppraisal(referenceCase, { withCash: true });
  const jv4 = jvWaterfall(R4.equity, R4.profit, R4.holdYears, referenceCase.jv!);
  const opts = { dealName: 'Golden Fixture Works', address: 'Bournemouth', input: referenceCase, R: R4, jv: jv4, monthLabel };

  it('stamps the firm on every sheet and on the file itself', async () => {
    const wb = await buildAppraisalWorkbook({ ...opts, firm: { name: 'Marchmont & Co' } });
    expect(wb.creator).toBe('Marchmont & Co');
    for (const ws of wb.worksheets) {
      const strap = String(ws.getCell(3, 1).value ?? '');
      expect(strap.startsWith('Marchmont & Co ·')).toBe(true);
      expect(strap).not.toContain('Apex Appraise');
    }
  });

  it('falls back to Apex when the firm has no branding', async () => {
    const wb = await buildAppraisalWorkbook(opts);
    expect(wb.creator).toBe('Apex Appraise');
    expect(String(wb.getWorksheet('Summary')!.getCell(3, 1).value)).toContain('Apex Appraise');
  });

  it('skips an unembeddable logo rather than corrupting the workbook', async () => {
    // exceljs handles png/jpeg only; a WebP must be ignored, not written
    const wb = await buildAppraisalWorkbook({ ...opts, firm: { name: 'Marchmont & Co', logoUrl: '/uploads/files/logo.webp' } });
    expect(wb.model.media ?? []).toHaveLength(0);
    expect(wb.creator).toBe('Marchmont & Co');
  });
});
