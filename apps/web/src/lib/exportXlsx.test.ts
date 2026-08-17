import { describe, expect, it } from 'vitest';
import { computeAppraisal, dcfSensitivity, jvWaterfall, cilCharge, type AppraisalInput } from '@apex/appraisal-engine';
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

/**
 * Phased schemes: the Phases sheet totals with SUM over a range, so anything
 * else written into those columns inside the range is added to the totals.
 */
describe('buildAppraisalWorkbook — phased with per-phase trades', async () => {
  const phased: AppraisalInput = {
    ...referenceCase,
    units: [],
    phases: [
      {
        name: 'Phase 1 — podium',
        start: 1,
        buildMonths: 10,
        salesMonths: 3,
        units: [{ label: 'Trade counter units', count: 6, area: 2600, cap: 225 }],
        trades: [
          { label: 'Piling & basement', rate: 44 },
          { label: 'Frame', rate: 61 },
        ],
      },
      {
        name: 'Phase 2 — terrace',
        start: 12,
        buildMonths: 10,
        salesMonths: 3,
        units: [{ label: 'Mezzanine offices', count: 1, area: 3200, cap: 240 }],
      },
    ],
  };
  const R3 = computeAppraisal(phased, { withCash: true });
  const jv3 = jvWaterfall(R3.equity, R3.profit, R3.holdYears, phased.jv!);
  const wb3 = await buildAppraisalWorkbook({
    dealName: 'Golden Fixture Works',
    address: 'Bournemouth',
    input: phased,
    R: R3,
    jv: jv3,
    monthLabel,
  });

  it('itemises the trades of a phase that prices off the scheme', () => {
    const ph = wb3.getWorksheet('Phases')!;
    const labels: string[] = [];
    ph.eachRow((row) => labels.push(String(row.getCell(1).value ?? '')));
    expect(labels).toContain('    Piling & basement');
    expect(labels).toContain('    Frame');
    // phase 2 inherits, so it gets no breakdown block
    expect(labels.filter((l) => l.startsWith('Phase 2'))).toHaveLength(1);
  });

  it('keeps the breakdown OUT of the summed range', () => {
    const ph = wb3.getWorksheet('Phases')!;
    let totalFormula = '';
    let firstBreakdownRow = Infinity;
    let totalRowNumber = 0;
    ph.eachRow((row, n) => {
      const label = String(row.getCell(1).value ?? '');
      if (label === 'Total') {
        totalFormula = String((row.getCell(8).value as { formula?: string })?.formula ?? '');
        totalRowNumber = n;
      }
      if (label.startsWith('    ') && n < firstBreakdownRow) firstBreakdownRow = n;
    });
    expect(totalFormula).toMatch(/^SUM\(H\d+:H\d+\)$/);
    // every itemised trade row sits after the total, so none is summed into it
    expect(firstBreakdownRow).toBeGreaterThan(totalRowNumber);
    const [, from, to] = totalFormula.match(/SUM\(H(\d+):H(\d+)\)/)!.map(Number);
    expect(to).toBeLessThan(firstBreakdownRow);
    // and the range covers exactly the two phase rows
    expect(to - from + 1).toBe(2);
  });
});

/** The DCF is a cross-check: it must never alter the workbook's GDV. */
describe('buildAppraisalWorkbook — with a growth-explicit DCF', async () => {
  const dcfCase: AppraisalInput = {
    ...referenceCase,
    income: {
      lines: [{ label: 'Retail parade', count: 4, area: 1500, rentPsf: 18 }],
      nonRecoverablePct: 0,
      yieldPct: 7,
      purchaserCostsPct: 6.8,
    },
    dcf: { holdYears: 5, rentalGrowthPct: 2, discountRatePct: 8, exitYieldPct: 7.25, exitCostsPct: 1.75 },
  };
  const R4 = computeAppraisal(dcfCase, { withCash: true });
  const wb4 = await buildAppraisalWorkbook({
    dealName: 'Golden Fixture Works',
    address: 'Bournemouth',
    input: dcfCase,
    R: R4,
    jv: jvWaterfall(R4.equity, R4.profit, R4.holdYears, dcfCase.jv!),
    monthLabel,
  });

  it('adds the DCF under the rent roll with a year per row', () => {
    const rr = wb4.getWorksheet('Rent roll')!;
    const labels: string[] = [];
    rr.eachRow((row) => labels.push(String(row.getCell(1).value ?? '')));
    expect(labels.some((l) => l.startsWith('Growth-explicit DCF'))).toBe(true);
    expect(labels.filter((l) => /^ {4}Year \d+/.test(l))).toHaveLength(5);
    expect(labels).toContain('Equated yield');
  });

  it('writes the sensitivity matrix as re-run values, agreeing cell for cell with the engine', () => {
    const rr = wb4.getWorksheet('Rent roll')!;
    const rows: Array<{ label: string; cells: number[] }> = [];
    let inGrid = false;
    rr.eachRow((row) => {
      const label = String(row.getCell(1).value ?? '');
      if (label.startsWith('Sensitivity — NPV by growth')) {
        inGrid = true;
        return;
      }
      if (inGrid && /% pa growth/.test(label)) {
        rows.push({ label, cells: [5, 6, 7, 8, 9].map((c) => row.getCell(c).value as number) });
      }
    });
    const grid = dcfSensitivity(dcfCase.income!, dcfCase.dcf!);
    expect(rows).toHaveLength(grid.length);
    rows.forEach((r, ri) => {
      // no formula stands in for the model: each cell is the engine's own figure
      expect(r.cells).toEqual(grid[ri].map((c) => Math.round(c.netPresentValue)));
    });
    // and the axis reads the way it is labelled — growth descending
    expect(rows[0].label).toContain(`${grid[0][0].rentalGrowthPct}% pa growth`);
    expect(grid[0][0].rentalGrowthPct).toBeGreaterThan(grid[grid.length - 1][0].rentalGrowthPct);
  });

  it('does not touch GDV — the capitalisation remains the reported value', () => {
    const u = wb4.getWorksheet('Unit schedule')!;
    let capitalised: number | null = null;
    u.eachRow((row) => {
      if (String(row.getCell(1).value ?? '').startsWith('Capitalised investment value')) {
        capitalised = row.getCell(5).value as number;
      }
    });
    expect(capitalised).toBe(Math.round(R4.investmentValue));
    // and the engine's GDV ignores the DCF entirely
    const withoutDcf = computeAppraisal({ ...dcfCase, dcf: undefined }, { withCash: true });
    expect(withoutDcf.gdv).toBeCloseTo(R4.gdv, 6);
    expect(withoutDcf.investmentValue).toBeCloseTo(R4.investmentValue, 6);
  });
});

describe('buildAppraisalWorkbook — fit to print', async () => {
  const R5 = computeAppraisal(referenceCase, { withCash: true });
  const jv5 = jvWaterfall(R5.equity, R5.profit, R5.holdYears, referenceCase.jv!);
  const wb5 = await buildAppraisalWorkbook({
    dealName: 'Golden Fixture Works',
    address: 'Bournemouth',
    firm: { name: 'Marchmont & Co' },
    input: referenceCase,
    R: R5,
    jv: jv5,
    monthLabel,
  });

  /**
   * Asserted over EVERY sheet rather than a chosen one. Two of the nine had
   * print setup and seven did not, which is the failure mode of per-sheet
   * configuration: whatever is added next is the thing that gets forgotten, and
   * nobody finds out until a valuer prints the residual appraisal for a client
   * meeting and it arrives as orphaned columns with no headings.
   */
  it('sets every sheet to one page wide, however many sheets there are', () => {
    expect(wb5.worksheets.length).toBeGreaterThan(5);
    for (const ws of wb5.worksheets) {
      expect(ws.pageSetup.fitToPage, `${ws.name} is not fit-to-page`).toBe(true);
      expect(ws.pageSetup.fitToWidth, `${ws.name} spills sideways`).toBe(1);
      // never fit-to-height: it silently shrinks a long cashflow to unreadable
      expect(ws.pageSetup.fitToHeight, `${ws.name} would be squashed vertically`).toBe(0);
      expect(ws.pageSetup.paperSize, `${ws.name} is not A4`).toBe(9);
    }
  });

  it('repeats the column headings on every page of a table that runs on', () => {
    // the cashflow is the sheet that actually spans pages
    const cf = wb5.getWorksheet('Cashflow')!;
    expect(cf.pageSetup.printTitlesRow, 'a page-two cashflow with no headings is unreadable').toMatch(/^\d+:\d+$/);

    // and the repeated row is the real heading row, not a guess
    const [from] = cf.pageSetup.printTitlesRow!.split(':').map(Number);
    expect(String(cf.getRow(from).getCell(1).value ?? '')).toBeTruthy();
    expect(cf.getRow(from).getCell(1).font?.bold).toBe(true);
  });

  it('puts the firm, the deal and the page number on every printed page', () => {
    /**
     * A loose page from a printed appraisal is otherwise unattributable — and
     * these are documents that get put in front of lenders.
     */
    for (const ws of wb5.worksheets) {
      expect(ws.headerFooter?.oddFooter, `${ws.name} has no footer`).toContain('Marchmont & Co');
      expect(ws.headerFooter?.oddFooter).toContain('Golden Fixture Works');
      expect(ws.headerFooter?.oddFooter).toContain('Page &P of &N');
    }
  });

  it('turns wide tables landscape and keeps narrow ones portrait', () => {
    expect(wb5.getWorksheet('Cashflow')!.pageSetup.orientation).toBe('landscape');
    expect(wb5.getWorksheet('Summary')!.pageSetup.orientation).toBe('portrait');
  });
});

describe('buildAppraisalWorkbook — the file a client actually opens', async () => {
  const R6 = computeAppraisal(referenceCase, { withCash: true });
  const jv6 = jvWaterfall(R6.equity, R6.profit, R6.holdYears, referenceCase.jv!);

  /**
   * Written to a real .xlsx and read back, because setting a property on an
   * in-memory workbook and shipping a file that carries it are different claims.
   * exceljs serialises page setup into the sheet XML; if that ever silently
   * stopped, every assertion above would still pass while every printed
   * appraisal came out sprawling.
   */
  it('carries its print setup through a round trip to disk', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const built = await buildAppraisalWorkbook({
      dealName: 'Golden Fixture Works',
      address: 'Bournemouth',
      firm: { name: 'Marchmont & Co' },
      input: referenceCase,
      R: R6,
      jv: jv6,
      monthLabel,
    });
    const buf = await built.xlsx.writeBuffer();
    expect(buf.byteLength, 'an empty workbook would pass every other assertion').toBeGreaterThan(5_000);

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buf as ArrayBuffer);

    expect(reopened.worksheets.length).toBe(built.worksheets.length);
    for (const ws of reopened.worksheets) {
      expect(ws.pageSetup.fitToWidth, `${ws.name} lost its fit-to-width in the file`).toBe(1);
      expect(ws.pageSetup.paperSize, `${ws.name} lost A4 in the file`).toBe(9);
      expect(ws.headerFooter?.oddFooter, `${ws.name} lost its footer in the file`).toContain('Page &P of &N');
    }
    // and the sheet that spans pages still repeats its headings
    expect(reopened.getWorksheet('Cashflow')!.pageSetup.printTitlesRow).toMatch(/^\d+:\d+$/);
  });
});
