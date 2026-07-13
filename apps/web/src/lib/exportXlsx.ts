import { monteCarlo, sensitivityGrid } from '@apex/appraisal-engine';
import type { AppraisalInput, AppraisalResult, JvResult } from '@apex/appraisal-engine';
import type ExcelJSNS from 'exceljs';

/**
 * Surveyor-grade .xlsx export of the current appraisal. Values come from the
 * shared engine; the unit schedule and residual table carry live Excel formulas
 * so figures stay consistent when tweaked in Excel. The workbook builder is
 * separated from the download wrapper so node-side tests can assert the exact
 * formats. exceljs is loaded lazily — it never weighs down the main bundle.
 */

export interface ExportOpts {
  dealName: string;
  address: string;
  input: AppraisalInput;
  R: AppraisalResult;
  jv: JvResult;
  monthLabel: (idx: number) => string;
}

// en-GB money/percent formats — £ with thousands, true reds for negatives
const FMT_MONEY = '"£"#,##0;[Red]-"£"#,##0';
const FMT_MONEY_PSF = '"£"#,##0.00';
const FMT_NUM = '#,##0';
const FMT_PCT = '0.0%';
const FMT_X = '0.00"×"';

const BRAND = 'FF14503B';
const BRAND_TINT = 'FFECF3EF';
const INK2 = 'FF5F665F';
const BORDER = 'FFE6E5DE';

type Ws = ExcelJSNS.Worksheet;

const thin = { style: 'thin' as const, color: { argb: BORDER } };

function titleBlock(ws: Ws, dealName: string, address: string, subtitle: string, span: number) {
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = dealName;
  t.font = { name: 'Arial', bold: true, size: 15, color: { argb: 'FF16201B' } };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, span);
  const a = ws.getCell(2, 1);
  a.value = `${address} · ${subtitle}`;
  a.font = { name: 'Arial', size: 10, color: { argb: INK2 } };
  ws.mergeCells(3, 1, 3, span);
  const s = ws.getCell(3, 1);
  s.value = `Apex Appraise · exported ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · figures from the shared appraisal engine — projections, verify before reliance`;
  s.font = { name: 'Arial', size: 8, italic: true, color: { argb: 'FF9AA09A' } };
  ws.addRow([]);
}

function headerRow(ws: Ws, cells: string[]) {
  const row = ws.addRow(cells);
  row.eachCell({ includeEmpty: true }, (c, col) => {
    if (col > cells.length) return;
    c.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    c.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right' };
    c.border = { bottom: thin };
  });
  row.height = 18;
  return row;
}

function totalRow(row: ExcelJSNS.Row, cols: number) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: BRAND } };
    cell.border = { top: { style: 'double', color: { argb: BRAND } } };
  }
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_TINT } };
}

const body = (c: ExcelJSNS.Cell) => {
  c.font = { name: 'Arial', size: 10 };
  c.border = { bottom: thin };
};

export async function buildAppraisalWorkbook(opts: ExportOpts): Promise<ExcelJSNS.Workbook> {
  const { dealName, address, input, R, jv, monthLabel } = opts;
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex Appraise';
  wb.created = new Date();

  const isResidual = input.site.mode === 'residual';

  // ---- Summary ----
  const s = wb.addWorksheet('Summary', { properties: { tabColor: { argb: BRAND } } });
  s.columns = [{ width: 34 }, { width: 18 }];
  titleBlock(s, dealName, address, 'Development appraisal summary', 2);
  headerRow(s, ['Measure', 'Value']);
  const kpis: Array<[string, number, string]> = [
    ['Gross development value (GDV)', Math.round(R.gdv), FMT_MONEY],
    [isResidual ? 'Residual land value (net)' : 'Land value (input)', Math.round(R.residualNet), FMT_MONEY],
    ['Developer profit', Math.round(R.profit), FMT_MONEY],
    ['Total development cost', Math.round(R.totalCost), FMT_MONEY],
    ['Return on cost', R.poc, FMT_PCT],
    ['Return on GDV', R.rogdv, FMT_PCT],
    ['Return on equity', R.roe, FMT_PCT],
    ['Project IRR (annualised)', R.cash?.projIrr ?? 0, FMT_PCT],
    ['Equity IRR (annualised)', R.cash?.eqIrr ?? 0, FMT_PCT],
    ['Peak debt / facility', Math.round(R.facility), FMT_MONEY],
    ['Equity required', Math.round(R.equity), FMT_MONEY],
    ['NIA (sq ft)', Math.round(R.nia), FMT_NUM],
    ['GIA (sq ft)', Math.round(R.gia), FMT_NUM],
    ['Programme (months, build + sales)', R.period + R.salesMonths, FMT_NUM],
  ];
  for (const [label, value, fmt] of kpis) {
    const r = s.addRow([label, value]);
    body(r.getCell(1));
    const v = r.getCell(2);
    v.numFmt = fmt;
    v.font = { name: 'Arial', bold: true, size: 10 };
    v.alignment = { horizontal: 'right' };
    v.border = { bottom: thin };
  }
  s.views = [{ state: 'frozen', ySplit: 5 }];

  // ---- Unit schedule (live formulas) ----
  const u = wb.addWorksheet('Unit schedule', { properties: { tabColor: { argb: BRAND } } });
  u.columns = [{ width: 36 }, { width: 9 }, { width: 13 }, { width: 11 }, { width: 16 }];
  titleBlock(u, dealName, address, 'Accommodation schedule — edit counts/areas/rates, values recompute', 5);
  headerRow(u, ['Unit type', 'No.', 'Area (sq ft)', '£/sq ft', 'Value']);
  const firstUnit = u.rowCount + 1;
  input.units.forEach((unit, i) => {
    const r = u.addRow([unit.label, unit.count, unit.area, unit.cap, null]);
    r.eachCell((c) => body(c));
    const rowN = firstUnit + i;
    r.getCell(5).value = { formula: `B${rowN}*C${rowN}*D${rowN}` };
    r.getCell(5).numFmt = FMT_MONEY;
    r.getCell(3).numFmt = FMT_NUM;
    r.getCell(4).numFmt = FMT_MONEY_PSF;
    for (let c = 2; c <= 5; c++) r.getCell(c).alignment = { horizontal: 'right' };
  });
  const lastUnit = u.rowCount;
  const tr = u.addRow(['Gross development value', null, null, null, null]);
  tr.getCell(5).value = { formula: `SUM(E${firstUnit}:E${lastUnit})` };
  tr.getCell(5).numFmt = FMT_MONEY;
  tr.getCell(5).alignment = { horizontal: 'right' };
  totalRow(tr, 5);
  u.addRow([]);
  const eff = u.addRow(['NIA / GIA efficiency', input.efficiency / 100]);
  eff.getCell(2).numFmt = FMT_PCT;
  eff.getCell(2).alignment = { horizontal: 'right' };
  u.views = [{ state: 'frozen', ySplit: 5 }];

  // ---- Residual appraisal ----
  const ra = wb.addWorksheet('Residual appraisal', { properties: { tabColor: { argb: BRAND } } });
  ra.columns = [{ width: 42 }, { width: 18 }];
  titleBlock(ra, dealName, address, isResidual ? 'Residual land value at target profit' : 'Profit at fixed land price', 2);
  headerRow(ra, ['Line', 'Amount']);
  const lines: Array<[string, number]> = [
    ['Gross development value', Math.round(R.gdv)],
    ['Disposal costs (agent + legal)', -Math.round(R.saleCosts)],
    [`Construction (£${Math.round(R.buildRate)}/sq ft on GIA)`, -Math.round(R.build)],
    [`Professional fees (${input.profFeePct}%)`, -Math.round(R.fees)],
    [`Contingency (${input.contingencyPct}%)`, -Math.round(R.cont)],
    ['Other costs (S106, CIL, PM, surveys)', -Math.round(R.otherTotal)],
    ['Finance (rolled-up interest + arrangement)', -Math.round(R.finance)],
    ...(isResidual
      ? ([[`Developer profit (${input.targetProfitOnGdvPct}% of GDV)`, -Math.round(R.profit)]] as Array<[string, number]>)
      : ([['Land including acquisition costs', -Math.round(R.landGross)]] as Array<[string, number]>)),
  ];
  const firstLine = ra.rowCount + 1;
  lines.forEach(([label, v]) => {
    const r = ra.addRow([label, v]);
    body(r.getCell(1));
    const c = r.getCell(2);
    c.numFmt = FMT_MONEY;
    c.font = { name: 'Arial', size: 10 };
    c.alignment = { horizontal: 'right' };
    c.border = { bottom: thin };
  });
  const lastLine = ra.rowCount;
  const resRow = ra.addRow([isResidual ? 'Residual land value (net of acquisition costs)' : 'Developer profit', null]);
  resRow.getCell(2).value = {
    formula: `SUM(B${firstLine}:B${lastLine})${isResidual ? `/(1+${input.site.acqPct / 100})` : ''}`,
  };
  resRow.getCell(2).numFmt = FMT_MONEY;
  resRow.getCell(2).alignment = { horizontal: 'right' };
  totalRow(resRow, 2);
  ra.views = [{ state: 'frozen', ySplit: 5 }];

  // ---- Cashflow ----
  const cf = wb.addWorksheet('Cashflow', { properties: { tabColor: { argb: 'FFC7A95B' } } });
  cf.columns = [{ width: 11 }, { width: 14 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 15 }];
  titleBlock(cf, dealName, address, `Monthly ledger — ${input.finance.spendProfile ?? 'scurve'} drawdown, interest compounds on drawn balance`, 6);
  headerRow(cf, ['Month', 'Cost', 'Interest', 'Revenue', 'Net', 'Cumulative']);
  (R.cash?.rows ?? []).forEach((row) => {
    const r = cf.addRow([
      monthLabel(row.m),
      Math.round(row.cost),
      Math.round(row.intr),
      Math.round(row.rev),
      Math.round(row.net),
      Math.round(row.cum),
    ]);
    r.eachCell((c, col) => {
      body(c);
      if (col >= 2) {
        c.numFmt = FMT_MONEY;
        c.alignment = { horizontal: 'right' };
      }
    });
  });
  const cfTot = cf.addRow(['Peak debt', Math.round(R.facility), null, null, null, null]);
  cfTot.getCell(2).numFmt = FMT_MONEY;
  cfTot.getCell(2).alignment = { horizontal: 'right' };
  totalRow(cfTot, 2);
  cf.views = [{ state: 'frozen', ySplit: 5 }];
  cf.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ---- JV returns ----
  const jvs = wb.addWorksheet('JV returns', { properties: { tabColor: { argb: 'FF9B79C0' } } });
  jvs.columns = [{ width: 34 }, { width: 16 }, { width: 16 }];
  titleBlock(jvs, dealName, address, `Equity waterfall — ${input.jv?.prefPct ?? 8}% pref, ${input.jv?.promotePct ?? 20}% promote over ${jv.holdYears.toFixed(1)} yrs`, 3);
  headerRow(jvs, ['Measure', 'LP (investors)', 'GP (developer)']);
  const jvRows: Array<[string, number, number, string]> = [
    ['Equity in', Math.round(jv.lp.equity), Math.round(jv.gp.equity), FMT_MONEY],
    ['Profit share', Math.round(jv.lp.profit), Math.round(jv.gp.profit), FMT_MONEY],
    ['Total back', Math.round(jv.lp.total), Math.round(jv.gp.total), FMT_MONEY],
    ['MOIC', jv.lp.moic, jv.gp.moic, FMT_X],
    ['IRR (annualised MOIC basis)', jv.lp.irr ?? 0, jv.gp.irr ?? 0, FMT_PCT],
  ];
  for (const [label, lp, gp, fmt] of jvRows) {
    const r = jvs.addRow([label, lp, gp]);
    body(r.getCell(1));
    [2, 3].forEach((c) => {
      const cell = r.getCell(c);
      cell.numFmt = fmt;
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { horizontal: 'right' };
      cell.border = { bottom: thin };
    });
  }
  jvs.addRow([]);
  const tiers = jvs.addRow(['Tiers: 1 return of capital → 2 preferred → 3 residual split → 4 promote']);
  tiers.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: INK2 } };

  // ---- Risk & sensitivity ----
  const rs = wb.addWorksheet('Risk & sensitivity', { properties: { tabColor: { argb: 'FF9A6212' } } });
  rs.columns = [{ width: 30 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }];
  titleBlock(rs, dealName, address, 'Sensitivity matrix & Monte Carlo risk — engine-computed', 6);
  headerRow(rs, ['Return on cost — build ↓ / GDV →', '−10%', '−5%', 'Base', '+5%', '+10%']);
  const grid = sensitivityGrid(input, 'roc');
  const baseRoC = R.poc;
  const GRID_TINTS = { good: 'FFE4F1EA', warn: 'FFF8F0DE', bad: 'FFF9EAE7' };
  const rowLabels = ['Build +10%', 'Build +5%', 'Build base', 'Build −5%', 'Build −10%'];
  grid.forEach((cells, ri) => {
    const r = rs.addRow([rowLabels[ri], ...cells.map((c) => c.value)]);
    body(r.getCell(1));
    cells.forEach((c, ci) => {
      const cell = r.getCell(ci + 2);
      cell.numFmt = FMT_PCT;
      cell.alignment = { horizontal: 'right' };
      cell.font = { name: 'Arial', size: 10, bold: c.isBase };
      const tint = c.value < 0 ? GRID_TINTS.bad : c.value >= baseRoC - 0.001 ? GRID_TINTS.good : GRID_TINTS.warn;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
      if (c.isBase) cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    });
  });
  rs.addRow([]);
  headerRow(rs, ['Monte Carlo — 400 seeded iterations, land held at base', 'Value']);
  const mc = monteCarlo(input, { iterations: 400, seed: 42 });
  const mcRows: Array<[string, number, string]> = [
    ['Profit P10 (downside)', Math.round(mc.profit.p10), FMT_MONEY],
    ['Profit P50 (median)', Math.round(mc.profit.p50), FMT_MONEY],
    ['Profit P90 (upside)', Math.round(mc.profit.p90), FMT_MONEY],
    ['Return on cost P10', mc.poc.p10, FMT_PCT],
    ['Return on cost P50', mc.poc.p50, FMT_PCT],
    ['Return on cost P90', mc.poc.p90, FMT_PCT],
    ['Probability profit ≥ target', mc.probAtTarget, FMT_PCT],
    ['Probability of loss', mc.probLoss, FMT_PCT],
    ['Land held constant at', Math.round(mc.landFixed), FMT_MONEY],
  ];
  for (const [label, value, fmt] of mcRows) {
    const r = rs.addRow([label, value]);
    body(r.getCell(1));
    const v = r.getCell(2);
    v.numFmt = fmt;
    v.font = { name: 'Arial', bold: true, size: 10 };
    v.alignment = { horizontal: 'right' };
    v.border = { bottom: thin };
  }
  rs.addRow([]);
  const rsNote = rs.addRow(['Each sensitivity cell re-runs the full appraisal (incl. monthly finance) at the stated movements; Monte Carlo draws GDV and build multipliers from seeded normal distributions.']);
  rsNote.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: INK2 } };
  rs.views = [{ state: 'frozen', ySplit: 5 }];

  // ---- Assumptions ----
  const a = wb.addWorksheet('Assumptions', { properties: { tabColor: { argb: 'FF9AA09A' } } });
  a.columns = [{ width: 36 }, { width: 40 }];
  titleBlock(a, dealName, address, 'Key assumptions', 2);
  headerRow(a, ['Assumption', 'Value']);
  const rows: Array<[string, string]> = [
    ['Site mode', isResidual ? 'Residual — solve land at target profit' : 'Profit — fixed land price'],
    ['Target profit on GDV', `${input.targetProfitOnGdvPct}%`],
    ['Acquisition costs', `${input.site.acqPct}% (SDLT, legal, agent bundled)`],
    ['Professional fees / contingency', `${input.profFeePct}% / ${input.contingencyPct}%`],
    ['Disposal — agent / legal', `${input.disposal.agentPct}% / ${input.disposal.legalPct}%`],
    ['Debt', `${input.finance.ltcPct}% LTC at ${input.finance.ratePct}% pa, compounded monthly on drawn balance`],
    ['Arrangement fee', `${input.finance.arrangementFeePct}% of peak facility`],
    ['Programme', `${input.finance.periodMonths} months build + ${input.finance.salesMonths} months sales`],
    ['Spend profile', String(input.finance.spendProfile ?? 'scurve')],
    ['JV structure', `GP co-invest ${input.jv?.gpCoinvestPct ?? 10}% · pref ${input.jv?.prefPct ?? 8}% · promote ${input.jv?.promotePct ?? 20}%`],
  ];
  rows.forEach(([k, v]) => {
    const r = a.addRow([k, v]);
    r.eachCell((c) => body(c));
  });

  return wb;
}

/** Browser wrapper: build + trigger download. */
export async function exportAppraisalXlsx(opts: ExportOpts) {
  const wb = await buildAppraisalWorkbook(opts);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const aTag = document.createElement('a');
  aTag.href = url;
  aTag.download = `${opts.dealName.replace(/[^\w ]/g, '').trim()} - Appraisal.xlsx`;
  aTag.click();
  URL.revokeObjectURL(url);
}
