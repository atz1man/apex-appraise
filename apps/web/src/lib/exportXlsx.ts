import type { AppraisalInput, AppraisalResult, JvResult } from '@apex/appraisal-engine';

/**
 * Surveyor-grade .xlsx export of the current appraisal. Values come from the
 * shared engine; the unit schedule and residual table carry live Excel formulas
 * so figures stay consistent when tweaked in Excel. exceljs is loaded lazily —
 * it never weighs down the main bundle.
 */
export async function exportAppraisalXlsx(opts: {
  dealName: string;
  address: string;
  input: AppraisalInput;
  R: AppraisalResult;
  jv: JvResult;
  monthLabel: (idx: number) => string;
}) {
  const { dealName, address, input, R, jv, monthLabel } = opts;
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex Appraise';
  wb.created = new Date();

  const BRAND = 'FF14503B';
  const MUTED = 'FF5F665F';
  const money = '#,##0';
  const pct = '0.0%';

  const head = (ws: import('exceljs').Worksheet, cells: string[]) => {
    const row = ws.addRow(cells);
    row.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    });
    return row;
  };

  // ---- Summary ----
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 30 }, { width: 20 }, { width: 42 }];
  s.addRow([dealName]).font = { bold: true, size: 16 };
  s.addRow([address]).font = { color: { argb: MUTED }, size: 11 };
  s.addRow([`Exported ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Apex Appraise · figures from the shared appraisal engine`]).font = { color: { argb: MUTED }, size: 9 };
  s.addRow([]);
  const kpis: Array<[string, number, string]> = [
    ['Gross development value (GDV)', Math.round(R.gdv), money],
    ['Residual land value (net)', Math.round(R.residualNet), money],
    ['Developer profit', Math.round(R.profit), money],
    ['Total cost', Math.round(R.totalCost), money],
    ['Return on cost', R.poc, pct],
    ['Return on GDV', R.rogdv, pct],
    ['Return on equity', R.roe, pct],
    ['Project IRR (annualised)', R.cash?.projIrr ?? 0, pct],
    ['Equity IRR (annualised)', R.cash?.eqIrr ?? 0, pct],
    ['Peak debt / facility', Math.round(R.facility), money],
    ['Equity required', Math.round(R.equity), money],
    ['NIA (sq ft)', Math.round(R.nia), money],
    ['GIA (sq ft)', Math.round(R.gia), money],
  ];
  for (const [label, value, fmt] of kpis) {
    const r = s.addRow([label, value]);
    r.getCell(2).numFmt = fmt;
    r.getCell(2).font = { bold: true };
  }

  // ---- Unit schedule (live formulas) ----
  const u = wb.addWorksheet('Unit schedule');
  u.columns = [{ width: 34 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 16 }];
  head(u, ['Unit type', 'No.', 'Area (sq ft)', '£/sq ft', 'Value (£)']);
  input.units.forEach((unit, i) => {
    const r = u.addRow([unit.label, unit.count, unit.area, unit.cap, null]);
    r.getCell(5).value = { formula: `B${i + 2}*C${i + 2}*D${i + 2}` };
    r.getCell(5).numFmt = money;
    r.getCell(3).numFmt = money;
  });
  const totalRow = u.addRow(['GDV', null, null, null, null]);
  totalRow.getCell(5).value = { formula: `SUM(E2:E${input.units.length + 1})` };
  totalRow.font = { bold: true };
  totalRow.getCell(5).numFmt = money;
  u.addRow([]);
  u.addRow(['NIA / GIA efficiency', input.efficiency / 100]).getCell(2).numFmt = pct;

  // ---- Residual appraisal ----
  const ra = wb.addWorksheet('Residual appraisal');
  ra.columns = [{ width: 36 }, { width: 18 }];
  head(ra, ['Line', '£']);
  const isResidual = input.site.mode === 'residual';
  const lines: Array<[string, number]> = [
    ['Gross development value', Math.round(R.gdv)],
    ['Disposal costs', -Math.round(R.saleCosts)],
    ['Construction', -Math.round(R.build)],
    ['Professional fees', -Math.round(R.fees)],
    ['Contingency', -Math.round(R.cont)],
    ['Other costs (S106, CIL, PM…)', -Math.round(R.otherTotal)],
    ['Finance (rolled-up interest + arrangement)', -Math.round(R.finance)],
    ...(isResidual
      ? ([['Developer profit (target)', -Math.round(R.profit)]] as Array<[string, number]>)
      : ([['Land (incl. acquisition)', -Math.round(R.landGross)]] as Array<[string, number]>)),
  ];
  lines.forEach(([label, v]) => {
    const r = ra.addRow([label, v]);
    r.getCell(2).numFmt = money;
  });
  const resRow = ra.addRow([isResidual ? 'Residual land value (net)' : 'Developer profit', null]);
  resRow.getCell(2).value = { formula: `SUM(B2:B${lines.length + 1})${isResidual ? `/(1+${input.site.acqPct / 100})` : ''}` };
  resRow.font = { bold: true, color: { argb: BRAND } };
  resRow.getCell(2).numFmt = money;

  // ---- Cashflow ----
  const cf = wb.addWorksheet('Cashflow');
  cf.columns = [{ width: 12 }, { width: 15 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 16 }];
  head(cf, ['Month', 'Cost (£)', 'Interest (£)', 'Revenue (£)', 'Net (£)', 'Cumulative (£)']);
  (R.cash?.rows ?? []).forEach((row) => {
    const r = cf.addRow([monthLabel(row.m), Math.round(row.cost), Math.round(row.intr), Math.round(row.rev), Math.round(row.net), Math.round(row.cum)]);
    for (let c = 2; c <= 6; c++) r.getCell(c).numFmt = money;
  });

  // ---- Assumptions ----
  const a = wb.addWorksheet('Assumptions');
  a.columns = [{ width: 34 }, { width: 20 }];
  head(a, ['Assumption', 'Value']);
  const rows: Array<[string, string | number]> = [
    ['Site mode', input.site.mode === 'residual' ? 'Residual (solve land)' : 'Profit (fixed land)'],
    ['Target profit on GDV', `${input.targetProfitOnGdvPct}%`],
    ['Acquisition costs', `${input.site.acqPct}%`],
    ['Professional fees', `${input.profFeePct}%`],
    ['Contingency', `${input.contingencyPct}%`],
    ['Sales agent / legal', `${input.disposal.agentPct}% / ${input.disposal.legalPct}%`],
    ['Loan to cost', `${input.finance.ltcPct}%`],
    ['Interest rate', `${input.finance.ratePct}% pa (compounded monthly on drawn balance)`],
    ['Arrangement fee', `${input.finance.arrangementFeePct}% of facility`],
    ['Build period / sales period', `${input.finance.periodMonths} + ${input.finance.salesMonths} months`],
    ['Spend profile', input.finance.spendProfile ?? 'scurve'],
    ['JV — GP co-invest / pref / promote', `${input.jv?.gpCoinvestPct ?? 10}% / ${input.jv?.prefPct ?? 8}% / ${input.jv?.promotePct ?? 20}%`],
    ['LP total / MOIC', `£${Math.round(jv.lp.total).toLocaleString('en-GB')} · ${jv.lp.moic.toFixed(2)}×`],
    ['GP total / MOIC', `£${Math.round(jv.gp.total).toLocaleString('en-GB')} · ${jv.gp.moic.toFixed(2)}×`],
  ];
  rows.forEach(([k, v]) => a.addRow([k, v]));
  a.addRow([]);
  a.addRow(['Figures are projections generated by the Apex Appraise engine; verify before reliance.']).font = { color: { argb: MUTED }, size: 9, italic: true };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const aTag = document.createElement('a');
  aTag.href = url;
  aTag.download = `${dealName.replace(/[^\w ]/g, '').trim()} - Appraisal.xlsx`;
  aTag.click();
  URL.revokeObjectURL(url);
}
