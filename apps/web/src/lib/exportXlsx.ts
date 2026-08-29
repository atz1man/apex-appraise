import {
  capitaliseIncome,
  dcfSensitivity,
  discountedCashflow,
  monteCarlo,
  rollUpCashflow,
  sensitivityGrid,
} from '@apex/appraisal-engine';
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
  /** whose workbook this is — falls back to Apex when a firm has no branding */
  firm?: { name: string; logoUrl?: string | null };
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

/**
 * What a cell says when the engine could not compute the figure at all.
 *
 * `irr()` returns null when there is no sign change in its bracket — a scheme
 * that never returns its money has no internal rate of return to find, and the
 * engine says so rather than guessing. Every screen honours that: the appraisal
 * report, the deal overview and the development appraisal all print "N/A" or an
 * em dash. This workbook wrote `?? 0` into a cell formatted `0.0%`, so the one
 * artefact that leaves the firm — the file that goes to the lender, the LP, the
 * JV partner — turned "no IRR exists" into the specific, false claim that the
 * IRR is zero. Measured on a scheme losing £4,500,034: the JV sheet reported
 * the LP's return as 0.0%, directly beneath a Project IRR of -77.1% that WAS
 * computed correctly and so earned the column its credibility. That scheme is
 * the fixture in `exportXlsx.test.ts`, so the figures here are the ones the
 * committed tests actually produce.
 *
 * Text, not a number, and deliberately so. A spreadsheet is not a screen: a
 * numeric zero in an IRR column is charted, averaged, sorted and compared
 * against other deals, and a reader has no way to tell it from a real result.
 * Text cannot silently become the wrong answer to any of those. The wording
 * matches what the screens already say, so the same appraisal reads the same
 * either way.
 *
 * The percentage format is still applied to these cells unconditionally, which
 * looks odd and is deliberate: Excel ignores a number format on a text value,
 * so guarding it changes nothing a reader can see. A conditional whose only
 * defence would be a test asserting a cosmetic detail is worse than none — the
 * value is the whole fix.
 */
const NOT_COMPUTED = 'N/A';

const BRAND = 'FF14503B';
const BRAND_TINT = 'FFECF3EF';
const INK2 = 'FF5F665F';
const BORDER = 'FFE6E5DE';

type Ws = ExcelJSNS.Worksheet;

const thin = { style: 'thin' as const, color: { argb: BORDER } };

function titleBlock(ws: Ws, dealName: string, address: string, subtitle: string, span: number, firmName = 'Apex Appraise') {
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
  s.value = `${firmName} · exported ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · figures from the shared appraisal engine — projections, verify before reliance`;
  s.font = { name: 'Arial', size: 8, italic: true, color: { argb: 'FF9AA09A' } };
  ws.addRow([]);
}

/**
 * Which row holds each sheet's column headings, remembered as it is written so
 * the print setup can repeat it on every page without anyone maintaining a list
 * of row numbers alongside the code that produces them.
 */
const headerRowOf = new WeakMap<Ws, number>();

function headerRow(ws: Ws, cells: string[]) {
  const row = ws.addRow(cells);
  headerRowOf.set(ws, row.number);
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

/**
 * Print setup, applied to EVERY sheet by walking the finished workbook.
 *
 * Two of nine sheets had it and seven did not, which is what a per-sheet call
 * always converges on: the ones added later get forgotten, and nobody notices
 * until a valuer prints the residual appraisal for a client meeting and it
 * arrives as four pages of orphaned columns with no headings on any of them.
 * Walking the workbook means a sheet added tomorrow is covered by construction.
 *
 * A4, fit to one page wide and as many as it takes tall — never fit-to-height,
 * which silently shrinks a long cashflow to unreadable. Column headings repeat
 * on every page, and the footer carries the firm, the deal and "Page 1 of 3",
 * because a loose page from a printed appraisal is otherwise unattributable.
 */
function applyPrintSetup(ws: Ws, firmName: string, dealName: string) {
  const headerRow = headerRowOf.get(ws);
  /**
   * Orientation follows TOTAL WIDTH, not column count. The cashflow and the
   * summary both have six columns; the cashflow's are wide enough to need a
   * landscape page and the summary's are not, so counting columns put the one
   * genuinely wide sheet in portrait. A4 fits roughly 90 characters portrait at
   * this font, so anything past 70 gets the wider page rather than being scaled
   * down to fit one.
   */
  const declared = (ws.columns ?? []).reduce((n, c) => n + (typeof c?.width === 'number' ? c.width : 10), 0);
  const widest = declared || (ws.columnCount || 0) * 12;
  ws.pageSetup = {
    paperSize: 9, // A4
    // wide tables (cashflow, phases) are unreadable squeezed into portrait
    orientation: widest > 70 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    ...(headerRow ? { printTitlesRow: `${headerRow}:${headerRow}` } : {}),
  };
  ws.headerFooter = {
    oddFooter: `&L&"Arial,Regular"&8${firmName} · ${dealName}&R&"Arial,Regular"&8Page &P of &N`,
    evenFooter: `&L&"Arial,Regular"&8${firmName} · ${dealName}&R&"Arial,Regular"&8Page &P of &N`,
  };
}

export async function buildAppraisalWorkbook(opts: ExportOpts): Promise<ExcelJSNS.Workbook> {
  const { dealName, address, input, R, jv, monthLabel } = opts;
  const firmName = opts.firm?.name ?? 'Apex Appraise';
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = firmName;
  wb.created = new Date();

  const isResidual = input.site.mode === 'residual';

  // ---- Summary ----
  const s = wb.addWorksheet('Summary', { properties: { tabColor: { argb: BRAND } } });
  // exceljs embeds png/jpeg only — a WebP logo is skipped rather than corrupting
  // the workbook, and the firm name carries the branding on its own
  const logo = opts.firm?.logoUrl;
  if (logo) {
    const ext = logo.toLowerCase().endsWith('.png') ? 'png' : /\.jpe?g$/.test(logo.toLowerCase()) ? 'jpeg' : null;
    if (ext) {
      try {
        const res = await fetch(logo);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const id = wb.addImage({ buffer, extension: ext });
          s.addImage(id, { tl: { col: 1.6, row: 0.15 }, ext: { width: 132, height: 40 } });
        }
      } catch {
        // a missing logo must never fail an export
      }
    }
  }
  s.columns = [{ width: 34 }, { width: 18 }];
  titleBlock(s, dealName, address, 'Development appraisal summary', 2, firmName);
  headerRow(s, ['Measure', 'Value']);
  const kpis: Array<[string, number | string, string]> = [
    ['Gross development value (GDV)', Math.round(R.gdv), FMT_MONEY],
    [isResidual ? 'Residual land value (net)' : 'Land value (input)', Math.round(R.residualNet), FMT_MONEY],
    ['Developer profit', Math.round(R.profit), FMT_MONEY],
    ['Total development cost', Math.round(R.totalCost), FMT_MONEY],
    ['Return on cost', R.poc, FMT_PCT],
    ['Return on GDV', R.rogdv, FMT_PCT],
    ['Return on equity', R.roe, FMT_PCT],
    ['Project IRR (annualised)', R.cash?.projIrr ?? NOT_COMPUTED, FMT_PCT],
    ['Equity IRR (annualised)', R.cash?.eqIrr ?? NOT_COMPUTED, FMT_PCT],
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
  titleBlock(u, dealName, address, 'Accommodation schedule — edit counts/areas/rates, values recompute', 5, firmName);
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
  let lastUnit = u.rowCount;
  // a held element contributes its capitalised value, not a £/ft² sale price —
  // carry it as its own line so the sheet's GDV total still reconciles to the engine
  if (R.income && R.investmentValue > 0) {
    const ir = u.addRow(['Capitalised investment value (see Rent roll)', null, Math.round(R.income.totalArea), null, Math.round(R.investmentValue)]);
    ir.eachCell((c) => body(c));
    ir.getCell(3).numFmt = FMT_NUM;
    ir.getCell(5).numFmt = FMT_MONEY;
    for (let c = 2; c <= 5; c++) ir.getCell(c).alignment = { horizontal: 'right' };
    lastUnit = u.rowCount;
  }
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

  // ---- Phases — programme and per-phase value, only when the scheme is phased ----
  if (R.phases?.length) {
    const ph = wb.addWorksheet('Phases', { properties: { tabColor: { argb: 'FF3C7FB5' } } });
    ph.columns = [{ width: 26 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 13 }, { width: 11 }, { width: 15 }, { width: 14 }, { width: 16 }];
    titleBlock(ph, dealName, address, 'Phased programme — each phase draws, completes and sells on its own clock', 10, firmName);
    headerRow(ph, ['Phase', 'Starts', 'Build (mo)', 'Sales (mo)', 'Units', 'NIA (sq ft)', '£/sq ft', 'Construction', 'Phase costs', 'GDV']);
    const firstPhase = ph.rowCount + 1;
    R.phases.forEach((p) => {
      const r = ph.addRow([
        p.name,
        monthLabel(p.start),
        p.buildMonths,
        p.salesMonths,
        p.unitCount,
        Math.round(p.nia),
        p.buildRate,
        Math.round(p.cost),
        Math.round(p.otherTotal),
        Math.round(p.gdv),
      ]);
      r.eachCell((c) => body(c));
      r.getCell(6).numFmt = FMT_NUM;
      r.getCell(7).numFmt = FMT_MONEY_PSF;
      r.getCell(8).numFmt = FMT_MONEY;
      r.getCell(9).numFmt = FMT_MONEY;
      r.getCell(10).numFmt = FMT_MONEY;
      for (let c = 2; c <= 10; c++) r.getCell(c).alignment = { horizontal: 'right' };
    });
    const lastPhase = ph.rowCount;
    const pt = ph.addRow(['Total', null, null, null, null, null, null, null, null, null]);
    pt.getCell(8).value = { formula: `SUM(H${firstPhase}:H${lastPhase})` };
    pt.getCell(9).value = { formula: `SUM(I${firstPhase}:I${lastPhase})` };
    pt.getCell(10).value = { formula: `SUM(J${firstPhase}:J${lastPhase})` };
    for (const c of [8, 9, 10]) {
      pt.getCell(c).numFmt = FMT_MONEY;
      pt.getCell(c).alignment = { horizontal: 'right' };
    }
    totalRow(pt, 10);
    ph.addRow([]);

    /**
     * Trade breakdown for any phase that prices differently from the scheme —
     * a single blended rate hides WHY one phase costs what it does.
     * Deliberately BELOW the totals: these rows carry money in the same columns
     * the total row SUMs over, so inside the range they would silently double
     * every itemised trade into the construction total.
     */
    if (R.phases.some((p) => p.ownTrades)) {
      headerRow(ph, ['Trade breakdown (phases pricing off the scheme)', '', '', '', '', '', '£/sq ft', 'Cost', '', '']);
      R.phases.forEach((p) => {
        if (!p.ownTrades) return;
        const head = ph.addRow([p.name, null, null, null, null, null, p.buildRate, Math.round(p.build), null, null]);
        head.eachCell((c) => body(c));
        head.getCell(1).font = { name: 'Arial', size: 10, bold: true };
        head.getCell(7).numFmt = FMT_MONEY_PSF;
        head.getCell(8).numFmt = FMT_MONEY;
        for (let c = 7; c <= 8; c++) head.getCell(c).alignment = { horizontal: 'right' };
        p.trades.forEach((t) => {
          const r = ph.addRow([`    ${t.label}`, null, null, null, null, null, t.rate, Math.round(t.rate * p.gia), null, null]);
          r.getCell(1).font = { name: 'Arial', size: 9, color: { argb: INK2 } };
          r.getCell(7).numFmt = FMT_MONEY_PSF;
          r.getCell(8).numFmt = FMT_MONEY;
          for (let c = 7; c <= 8; c++) r.getCell(c).alignment = { horizontal: 'right' };
        });
      });
      ph.addRow([]);
    }

    const note = ph.addRow([
      `Phases share one facility: peak debt ${Math.round(R.facility).toLocaleString('en-GB')} against a ${R.period + R.salesMonths}-month programme. Receipts from a completed phase repay the facility while a later phase is still drawing.`,
    ]);
    note.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: INK2 } };
    ph.views = [{ state: 'frozen', ySplit: 5 }];
  }

  // ---- Rent roll & capitalisation (investment method) — only when the scheme holds space ----
  if (R.income && input.income) {
    const I = R.income;
    const rr = wb.addWorksheet('Rent roll', { properties: { tabColor: { argb: 'FF1E7A55' } } });
    rr.columns = [{ width: 34 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 9 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 15 }];
    titleBlock(rr, dealName, address, 'Investment method — net rent capitalised at the all-risks yield', 9, firmName);
    headerRow(rr, ['Tenancy / space', 'No.', 'Area (sq ft)', 'Rent £/sq ft', 'Void %', 'ERV £/sq ft', 'Review (yrs)', 'Yield %', 'Rent (£ pa)']);
    const firstRent = rr.rowCount + 1;
    input.income.lines.forEach((l, i) => {
      const calc = I.lines[i];
      const r = rr.addRow([
        l.label,
        l.count,
        l.area,
        l.rentPsf,
        (l.voidPct ?? 0) / 100,
        l.ervPsf ?? l.rentPsf,
        calc?.yearsToReview || null,
        (calc?.yieldUsed ?? input.income!.yieldPct) / 100,
        null,
      ]);
      r.eachCell((c) => body(c));
      const rowN = firstRent + i;
      r.getCell(9).value = { formula: `B${rowN}*C${rowN}*D${rowN}` };
      r.getCell(3).numFmt = FMT_NUM;
      r.getCell(4).numFmt = FMT_MONEY_PSF;
      r.getCell(5).numFmt = FMT_PCT;
      r.getCell(6).numFmt = FMT_MONEY_PSF;
      r.getCell(8).numFmt = FMT_PCT;
      r.getCell(9).numFmt = FMT_MONEY;
      for (let c = 2; c <= 9; c++) r.getCell(c).alignment = { horizontal: 'right' };
    });
    const lastRent = rr.rowCount;
    const grossRow = rr.addRow(['Gross rent (passing)', null, Math.round(I.totalArea), null, null, null, null, null, null]);
    grossRow.getCell(3).numFmt = FMT_NUM;
    grossRow.getCell(3).alignment = { horizontal: 'right' };
    grossRow.getCell(9).value = { formula: `SUM(I${firstRent}:I${lastRent})` };
    grossRow.getCell(9).numFmt = FMT_MONEY;
    grossRow.getCell(9).alignment = { horizontal: 'right' };
    totalRow(grossRow, 9);
    rr.addRow([]);

    // the valuation ladder, in the order the engine applies it
    headerRow(rr, ['Capitalisation', '', '', '', '', '', '', '', 'Amount']);
    const ladder: Array<[string, number, boolean?]> = [
      ['Void allowance', -Math.round(I.voidAllowance)],
      [`Non-recoverables (${input.income.nonRecoverablePct}% of rent after voids)`, -Math.round(I.nonRecoverable)],
      ['Fixed deductions (ground rent, service-charge shortfall)', -Math.round(I.deductions)],
      ['Net rent (NOI)', Math.round(I.netRent), true],
      ...(I.lines.some((l) => l.isReversionary)
        ? ([
            ['Term — passing rent capitalised', Math.round(I.lines.reduce((a, l) => a + l.termValue, 0))],
            [
              I.method === 'hardcore' ? 'Top slice — uplift deferred to review' : 'Reversion — ERV deferred to review',
              Math.round(I.lines.reduce((a, l) => a + l.reversionValue, 0)),
            ],
            ['Gross capital value', Math.round(I.grossCapitalValue), true],
          ] as Array<[string, number, boolean?]>)
        : ([[`Gross capital value — YP ${I.yearsPurchase.toFixed(2)} @ ${input.income.yieldPct}%`, Math.round(I.grossCapitalValue), true]] as Array<[string, number, boolean?]>)),
      [`Let-up void (${input.income.letUpMonths ?? 0} months)`, -Math.round(I.letUpDeduction)],
      [`Purchaser's costs (${input.income.purchaserCostsPct ?? 6.8}%)`, -Math.round(I.purchaserCosts)],
    ];
    ladder.forEach(([label, v, sub]) => {
      const r = rr.addRow([label, null, null, null, null, null, null, null, v]);
      body(r.getCell(1));
      const c = r.getCell(9);
      c.numFmt = FMT_MONEY;
      c.font = { name: 'Arial', size: 10, bold: !!sub };
      c.alignment = { horizontal: 'right' };
      c.border = { bottom: thin };
      if (sub) r.getCell(1).font = { name: 'Arial', size: 10, bold: true };
    });
    const ncv = rr.addRow(['Investment value in GDV (net of purchaser costs)', null, null, null, null, null, null, null, Math.round(I.netCapitalValue)]);
    ncv.getCell(9).numFmt = FMT_MONEY;
    ncv.getCell(9).alignment = { horizontal: 'right' };
    totalRow(ncv, 9);
    rr.addRow([]);
    const yieldRows: Array<[string, number, string]> = [
      ['Net initial yield', I.netInitialYield, FMT_PCT],
      ...(I.lines.some((l) => l.isReversionary)
        ? ([
            ['Reversionary yield', I.reversionaryYield, FMT_PCT],
            ['Equivalent yield', I.equivalentYield, FMT_PCT],
          ] as Array<[string, number, string]>)
        : []),
      ['Capital value £/sq ft', I.capitalValuePsf, FMT_MONEY_PSF],
    ];
    for (const [label, value, fmt] of yieldRows) {
      const row = rr.addRow([label, null, null, null, null, null, null, null, value]);
      row.getCell(9).numFmt = fmt;
      row.getCell(9).alignment = { horizontal: 'right' };
      body(row.getCell(1));
    }
    const rrNote = rr.addRow(['Net rent is capitalised in perpetuity at the all-risks yield. The let-up void is a capital deduction, so the net initial yield sits above the capitalisation yield. Lettable area is included in GIA and carries its share of build cost.']);
    rrNote.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: INK2 } };
    rrNote.getCell(1).alignment = { wrapText: true };
    /**
     * Growth-explicit DCF, when one is set. A CROSS-CHECK: the workbook's GDV
     * stays on the capitalisation above, exactly as the screen and report do.
     */
    if (input.dcf) {
      const d = discountedCashflow(input.income, input.dcf);
      rr.addRow([]);
      headerRow(rr, [
        `Growth-explicit DCF — ${input.dcf.rentalGrowthPct}% growth, discounted at ${input.dcf.discountRatePct}%`,
        '', '', '', '', '', 'Year', 'PV factor', 'Present value',
      ]);
      d.years.forEach((y) => {
        const r = rr.addRow([
          y.reviewed ? `    Year ${y.year} — review` : `    Year ${y.year}`,
          null, null, null, null, Math.round(y.rent), y.year, y.discountFactor, Math.round(y.presentValue),
        ]);
        r.getCell(1).font = { name: 'Arial', size: 9, color: { argb: INK2 } };
        r.getCell(6).numFmt = FMT_MONEY;
        r.getCell(8).numFmt = '0.0000';
        r.getCell(9).numFmt = FMT_MONEY;
        for (let c = 6; c <= 9; c++) r.getCell(c).alignment = { horizontal: 'right' };
      });
      const dcfRows: Array<[string, number, string]> = [
        ['PV of income over the hold', Math.round(d.incomePv), FMT_MONEY],
        [`Exit at ${input.dcf.exitYieldPct}% on ${Math.round(d.exitRent).toLocaleString('en-GB')} pa`, Math.round(d.exitValueGross), FMT_MONEY],
        ['Sale costs', -Math.round(d.exitCosts), FMT_MONEY],
        ['PV of the sale', Math.round(d.exitPv), FMT_MONEY],
        ['Net present value (cross-check only)', Math.round(d.netPresentValue), FMT_MONEY],
        ['Equated yield', d.equatedYield, FMT_PCT],
      ];
      for (const [label, value, fmt] of dcfRows) {
        const r = rr.addRow([label, null, null, null, null, null, null, null, value]);
        body(r.getCell(1));
        r.getCell(9).numFmt = fmt;
        r.getCell(9).alignment = { horizontal: 'right' };
        if (label.startsWith('Net present value')) totalRow(r, 9);
      }
      const dcfNote = rr.addRow(['The reported value remains the capitalisation above. A DCF states rental growth openly where the all-risks yield prices it implicitly; the equated yield is the discount rate at which the two agree.']);
      dcfNote.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: INK2 } };

      /**
       * Growth × exit-yield matrix. Written as VALUES, not formulas: every cell is
       * a full re-run of the discounted cashflow, which a spreadsheet formula
       * cannot reproduce — a formula here would be a different, weaker model
       * wearing the same label.
       */
      const grid = dcfSensitivity(input.income, input.dcf);
      rr.addRow([]);
      headerRow(rr, ['Sensitivity — NPV by growth (rows) and exit yield (columns)', '', '', '', ...grid[0].map((c) => `${c.exitYieldPct.toFixed(2)}%`)]);
      for (const row of grid) {
        const r = rr.addRow([
          `    ${row[0].rentalGrowthPct < 0 ? '−' : ''}${Math.abs(row[0].rentalGrowthPct)}% pa growth`,
          null, null, null,
          ...row.map((c) => Math.round(c.netPresentValue)),
        ]);
        body(r.getCell(1));
        row.forEach((c, ci) => {
          const cell = r.getCell(5 + ci);
          cell.numFmt = FMT_MONEY;
          cell.alignment = { horizontal: 'right' };
          if (c.isBase) cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: BRAND } };
          // a cell the capitalisation is NOT supported at is the one a reader must
          // not skim past, so it is marked in the workbook as it is in the report
          else if (c.vsCapitalisation < 1) cell.font = { name: 'Arial', size: 10, color: { argb: 'FFB23A2E' } };
        });
      }
      const gridNote = rr.addRow([
        `Bold is the stated case. Figures in red fall below the capitalised ${Math.round(capitaliseIncome(input.income).netCapitalValue).toLocaleString('en-GB')} this appraisal reports. Steps are percentage points on each rate, not proportions of it.`,
      ]);
      gridNote.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: INK2 } };
    }

    rr.views = [{ state: 'frozen', ySplit: 5 }];
    }

  // ---- Residual appraisal ----
  const ra = wb.addWorksheet('Residual appraisal', { properties: { tabColor: { argb: BRAND } } });
  ra.columns = [{ width: 42 }, { width: 18 }];
  titleBlock(ra, dealName, address, isResidual ? 'Residual land value at target profit' : 'Profit at fixed land price', 2, firmName);
  headerRow(ra, ['Line', 'Amount']);
  const gdvLabel =
    R.investmentValue > 0
      ? `Gross development value (£${Math.round(R.salesGdv).toLocaleString('en-GB')} sold + £${Math.round(R.investmentValue).toLocaleString('en-GB')} capitalised)`
      : 'Gross development value';
  const lines: Array<[string, number]> = [
    [gdvLabel, Math.round(R.gdv)],
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
  titleBlock(cf, dealName, address, `Monthly ledger — ${input.finance.spendProfile ?? 'scurve'} drawdown, interest compounds on drawn balance`, 6, firmName);
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

  // ---- period summaries — the same rows read quarterly and annually ----
  const periodOpts = { startYear: input.startYear, startMonth: input.startMonth };
  for (const [period, heading] of [['quarter', 'Quarterly summary'], ['year', 'Annual summary']] as const) {
    const rolled = rollUpCashflow(R.cash?.rows ?? [], period, periodOpts);
    if (rolled.length < 2) continue; // a single bucket says nothing the ledger doesn't
    cf.addRow([]);
    headerRow(cf, [heading, 'Cost', 'Interest', 'Revenue', 'Net', 'Closing']);
    rolled.forEach((row) => {
      const r = cf.addRow([
        row.label,
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
  }

  cf.views = [{ state: 'frozen', ySplit: 5 }];

  // ---- JV returns ----
  const jvs = wb.addWorksheet('JV returns', { properties: { tabColor: { argb: 'FF9B79C0' } } });
  jvs.columns = [{ width: 34 }, { width: 16 }, { width: 16 }];
  titleBlock(jvs, dealName, address, `Equity waterfall — ${input.jv?.prefPct ?? 8}% pref, ${input.jv?.promotePct ?? 20}% promote over ${jv.holdYears.toFixed(1)} yrs`, 3, firmName);
  headerRow(jvs, ['Measure', 'LP (investors)', 'GP (developer)']);
  const jvRows: Array<[string, number | string, number | string, string]> = [
    ['Equity in', Math.round(jv.lp.equity), Math.round(jv.gp.equity), FMT_MONEY],
    ['Profit share', Math.round(jv.lp.profit), Math.round(jv.gp.profit), FMT_MONEY],
    ['Total back', Math.round(jv.lp.total), Math.round(jv.gp.total), FMT_MONEY],
    ['MOIC', jv.lp.moic, jv.gp.moic, FMT_X],
    ['IRR (annualised MOIC basis)', jv.lp.irr ?? NOT_COMPUTED, jv.gp.irr ?? NOT_COMPUTED, FMT_PCT],
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
  titleBlock(rs, dealName, address, 'Sensitivity matrix & Monte Carlo risk — engine-computed', 6, firmName);
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
  titleBlock(a, dealName, address, 'Key assumptions', 2, firmName);
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

  // every sheet, including any added after this was written
  for (const ws of wb.worksheets) applyPrintSetup(ws, firmName, dealName);

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
