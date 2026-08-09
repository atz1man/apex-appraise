import { Fragment, useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  computeAppraisal,
  dcfSensitivity,
  discountedCashflow,
  sensitivityGrid,
  formatMoneyFull,
  formatPct,
} from '@apex/appraisal-engine';
import { accent, brand, neutral } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { fM, n0 } from '../lib/format';
import { Button, FirmMark, Spinner } from '../components/ui';
import { ShareLinks } from '../components/ShareLinks';
import { CashflowChart, ProfitBridge } from '../components/charts';

/* ------------------------------------------------------------------ */
/*  Print treatment — fixed A4 pages (794×1123) stacked on the canvas  */
/* ------------------------------------------------------------------ */

const PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  body { background: #fff !important; }
  .no-print { display: none !important; }
  .a4-canvas { padding: 0 !important; gap: 0 !important; background: #fff !important; }
  .a4-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; page-break-after: always; break-after: page; }
  /* without this the final break emits a trailing blank sheet — every PDF printed one page more than its footers claimed */
  .a4-page:last-child { page-break-after: auto !important; break-after: auto !important; }
}
`;

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Evergreen gradient placeholders for photo cards (photo-log pattern — no real images). */
const PHOTO_GRADS = [
  'linear-gradient(150deg,#1E7A55 0%,#14503B 60%,#0F3528 100%)',
  'linear-gradient(150deg,#5E9C80 0%,#1B6048 55%,#0C2A20 100%)',
  'linear-gradient(150deg,#7FB99E 0%,#1E7A55 50%,#13402F 100%)',
];

/** Contractor avatar gradients — per the design handoff prototype. */
const GRADS = [
  'linear-gradient(135deg,#1E7A55,#14503B)',
  'linear-gradient(135deg,#3C7FB5,#1F4E73)',
  'linear-gradient(135deg,#C79A4B,#8A6420)',
  'linear-gradient(135deg,#9B79C0,#5E3F86)',
];
const GRAD_NONE = 'linear-gradient(135deg,#9AA09A,#6E7269)';

const DISCLAIMER =
  'This appraisal has been prepared for the named client for the stated purpose and may not be relied upon by any third party. Values are estimates based on the stated assumptions, comparable evidence and prevailing market conditions as at the effective date, and are not a guarantee of price achievable. The appraisal is sensitive to changes in build cost, sales value, finance and programme as illustrated. This document does not constitute a RICS Red Book valuation unless explicitly stated and signed as such.';

const fmtLong = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/* ---------------------------- page chrome ---------------------------- */

function A4Page({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return (
    <div
      className="a4-page bg-surface flex flex-col overflow-hidden"
      style={{
        width: 794,
        // 1122, not 1123: chromium prints A4 at 1122.5px, so a page sized to the
        // rounded-up height spills a blank sheet and desyncs the "page n of N" footers
        minHeight: 1122,
        borderRadius: 3,
        boxShadow: '0 4px 24px rgba(20,30,25,0.12)',
        padding: pad ? '56px 60px' : 0,
      }}
    >
      {children}
    </div>
  );
}

function PageHead({ title, scheme }: { title: string; scheme: string }) {
  return (
    <div className="flex items-center justify-between pb-3" style={{ borderBottom: `2px solid ${brand[700]}` }}>
      <span className="text-[15px] font-bold">{title}</span>
      <span className="fig text-[10px] font-medium text-ink-3">{scheme}</span>
    </div>
  );
}

function PageFoot({ no, total, refCode, firmName }: { no: number; total: number; refCode: string; firmName: string }) {
  return (
    <div className="mt-auto pt-6">
      <div className="flex items-center justify-between pt-2.5 text-[9.5px] text-ink-3" style={{ borderTop: '1px solid #ECEBE5' }}>
        <span>
          <span className="font-semibold" style={{ color: brand[700] }}>{firmName}</span> · development appraisal
        </span>
        <span className="fig">{refCode} · {fmtLong(new Date())}</span>
        <span className="fig font-medium">Page {no} of {total}</span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mt-7 text-[13px] font-bold">{children}</div>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border-std rounded-[12px] px-4 py-3.5">
      <div className="fig text-[10px] uppercase text-ink-3">{label}</div>
      <div className="fig mt-1 text-[18px] font-semibold tracking-[-0.5px]" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

function KvRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-[9px] border-b border-border-faint">
      <span className="text-[12.5px] text-ink-2b">{k}</span>
      <span className="fig text-[12.5px] font-medium text-right">{v}</span>
    </div>
  );
}

/* ------------------------------ screen ------------------------------ */

export default function AppraisalReport() {
  const { dealId = '' } = useParams();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: appr, isLoading } = trpc.appraisal.getCurrent.useQuery(dealId, { enabled: !!dealId });
  const { data: photos } = trpc.photos.list.useQuery(dealId, { enabled: !!dealId });
  // client-facing documents carry the firm's identity, not the product's
  const { data: org } = trpc.org.get.useQuery();
  // AI-use disclosure — derived from the deal's audit trail, printed with the report
  const { data: ai } = trpc.appraisal.aiDisclosure.useQuery(dealId, { enabled: !!dealId });

  const input = appr?.input;

  // All figures from the shared engine — never hand-rolled.
  const R = useMemo(() => (input ? computeAppraisal(input, { withCash: true }) : null), [input]);
  const sens = useMemo(() => (input ? sensitivityGrid(input, 'roc') : null), [input]);
  // the growth-explicit cross-check, when the appraisal carries one
  const dcf = useMemo(
    () => (input?.income && input.dcf ? discountedCashflow(input.income, input.dcf) : null),
    [input],
  );
  // growth × exit yield over the held element — its own sheet, because the
  // investment page has about 46px spare and a grid is not 46px
  const dcfGrid = useMemo(
    () => (input?.income && input.dcf ? dcfSensitivity(input.income, input.dcf) : null),
    [input],
  );

  // Latest photo per week-commencing, most-recent week first (photos arrive takenAt desc).
  const monitoring = useMemo(() => {
    const byWeek = new Map<number, NonNullable<typeof photos>[number]>();
    for (const ph of photos ?? []) {
      const t = ph.weekCommencing.getTime();
      if (!byWeek.has(t)) byWeek.set(t, ph);
    }
    return [...byWeek.entries()].sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, ph]) => ph);
  }, [photos]);

  const gradOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const ph of photos ?? []) {
      if (ph.contractorId && !m.has(ph.contractorId)) m.set(ph.contractorId, GRADS[m.size % GRADS.length]);
    }
    return (id: string | null) => (id ? (m.get(id) ?? GRAD_NONE) : GRAD_NONE);
  }, [photos]);

  // Cashflow section: first page is the visuals (J-curve + profit bridge),
  // then the ledger in print-safe chunks (≤21 rows per page).
  const cashChunks = useMemo(() => {
    const rows = R?.cash?.rows ?? [];
    const out: (typeof rows)[] = [[]];
    for (let i = 0; i < rows.length; i += 21) out.push(rows.slice(i, i + 21));
    return out;
  }, [R]);

  /**
   * Trade breakdown for phases that price off the scheme. The workbook prints
   * every line; this page has a fixed height, so the budget is explicit and any
   * remainder is STATED rather than silently dropped.
   *
   * Sized by MEASUREMENT, not arithmetic: four cards of twenty rows rendered at
   * 1140px against A4's 1122, so the sheet holds eighteen trade rows (1088px
   * measured) with the "not printed here" note already placed.
   *
   * The reconciliation below the cards is not optional — a sheet that shows some
   * phases priced their own way has to tie back to the scheme's construction
   * total — so its height is RESERVED out of that budget rather than hoped for.
   */
  const PAGE_TRADE_ROWS = 18;
  const ROW_PX = 26;
  const MAX_PHASE_CARDS = 4;
  const PHASE_TRADE_ROWS = Math.max(
    4,
    // heading, caption, total row and a possible unphased-balance row, plus a
    // row per phase — measured at 118px of fixed height before the phase rows
    PAGE_TRADE_ROWS - Math.ceil((118 + ROW_PX * (R?.phases?.length ?? 0)) / ROW_PX),
  );
  const phaseOverrides = useMemo(() => {
    const over = (R?.phases ?? []).filter((ph) => ph.ownTrades);
    const shown: Array<{ phase: (typeof over)[number]; trades: (typeof over)[number]['trades']; hidden: number }> = [];
    let budget = PHASE_TRADE_ROWS;
    let hiddenPhases = 0;
    for (const ph of over) {
      const take = shown.length >= MAX_PHASE_CARDS ? 0 : Math.min(ph.trades.length, budget);
      // a card with no room left for a single trade line is not a breakdown —
      // count the whole phase as unprinted rather than printing an empty box
      if (take === 0) {
        hiddenPhases += 1;
        continue;
      }
      budget -= take;
      shown.push({ phase: ph, trades: ph.trades.slice(0, take), hidden: ph.trades.length - take });
    }
    const hiddenTotal =
      // part-printed cards plus every line of the phases that got no card at all
      shown.reduce((a, x) => a + x.hidden, 0) +
      over.filter((ph) => !shown.some((s) => s.phase === ph)).reduce((a, ph) => a + ph.trades.length, 0);
    return { shown, hiddenTotal, hiddenPhases };
  }, [R]);

  /**
   * The phases' construction against the scheme's. `build`/`fees`/`cont` sum the
   * phases PLUS any GIA priced outside them, so the difference is a real line,
   * not a rounding fudge — print it rather than let the column fail to add up.
   */
  const unphasedConstruction = R
    ? R.build + R.fees + R.cont - (R.phases ?? []).reduce((a, ph) => a + ph.cost, 0)
    : 0;

  const firmName = org?.name ?? 'Apex Appraise';
  const refCode = `AP-${dealId.slice(0, 4).toUpperCase()}`;
  const today = fmtLong(new Date());
  const scheme = deal?.name ?? 'Development appraisal';

  const toolbar = (
    // relative: the share panel hangs beneath this bar
    <div className="no-print sticky top-0 z-40 h-[54px] bg-surface border-b border-border-strong flex items-center gap-3.5 px-5 relative">
      <Link to={`/deal/${dealId}/appraisal`} className="flex items-center gap-2 text-[13px] font-medium text-inactive hover:text-brand-700">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        Back to appraisal
      </Link>
      <span className="text-[13.5px] font-semibold ml-1.5">Investment appraisal report</span>
      <span className="text-[13px] text-ink-3">·</span>
      <span className="text-[13px] text-ink-2 truncate">{scheme}</span>
      <span className="fig text-[11px] font-medium text-ink-3">{refCode}</span>
      <div className="ml-auto flex gap-2">
        <Button
          variant="secondary"
          onClick={() => window.open(`/reports/${dealId}/appraisal.pdf?t=${encodeURIComponent(getToken() ?? '')}`, '_blank')}
        >
          Download PDF
        </Button>
        <ShareLinks dealId={dealId} kind="appraisal" />
        <Button onClick={() => window.print()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z" /></svg>
          Print / Save PDF
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="light min-h-screen bg-frame">
        <style>{PRINT_CSS}</style>
        {toolbar}
        <div className="mt-16 flex justify-center"><Spinner /></div>
      </div>
    );
  }

  if (!appr || !R || !input || !sens) {
    return (
      <div className="light min-h-screen bg-frame">
        <style>{PRINT_CSS}</style>
        {toolbar}
        <div className="mt-20 flex justify-center px-6">
          <div className="bg-surface border border-border-strong rounded-panel shadow-rest px-10 py-12 max-w-[480px] text-center">
            <div className="eyebrow">Appraisal report</div>
            <h1 className="mt-2 text-[22px] font-bold tracking-[-0.6px]">No appraisal saved yet</h1>
            <p className="mt-2.5 text-[13px] text-ink-2 leading-relaxed">
              This report is generated from the deal's current development appraisal. Build and save an appraisal first — the report will assemble itself from those figures.
            </p>
            <Button to={`/deal/${dealId}/appraisal`} className="mt-5">
              Open development appraisal
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isResidual = input.site.mode === 'residual';
  const viability = R.poc >= 0.17 ? 'viable' : R.poc >= 0.1 ? 'marginal' : 'unviable';
  const disposalPct = input.disposal.agentPct + input.disposal.legalPct;
  const jv = input.jv;
  const cash = R.cash!;

  const startY = input.startYear ?? 2026;
  const startM = input.startMonth ?? 0;
  const monthLabel = (idx: number) => {
    const tot = startM + (idx - 1);
    const y = startY + Math.floor(tot / 12);
    return `${MO[((tot % 12) + 12) % 12]} '${String(y % 100).padStart(2, '0')}`;
  };

  // Residual appraisal breakdown — GDV → disposal → construction → fees → contingency → other → finance → profit → land.
  type BreakRow = { label: string; note?: string; val: string; kind?: 'head' | 'sub' | 'final' };
  const breakRows: BreakRow[] = [
    { label: 'Gross development value', val: formatMoneyFull(R.gdv), kind: 'head' },
    // a held element is valued by the investment method — show the composition, never a bare total
    ...(R.investmentValue > 0 && R.income
      ? ([
          { label: 'Units sold', val: formatMoneyFull(R.salesGdv) },
          {
            label: 'Capitalised investment value',
            note: `${formatMoneyFull(R.income.netRent)} pa @ ${input.income?.yieldPct}%`,
            val: formatMoneyFull(R.investmentValue),
          },
        ] as BreakRow[])
      : []),
    { label: 'Less: sale & letting costs', note: formatPct(disposalPct / 100), val: `(${formatMoneyFull(R.saleCosts)})` },
    { label: 'Net development value', val: formatMoneyFull(R.gdv - R.saleCosts), kind: 'sub' },
    { label: 'Construction cost', note: `£${Math.round(R.buildRate)}/ft²`, val: `(${formatMoneyFull(R.build)})` },
    { label: 'Professional fees', note: formatPct(input.profFeePct / 100), val: `(${formatMoneyFull(R.fees)})` },
    { label: 'Contingency', note: formatPct(input.contingencyPct / 100), val: `(${formatMoneyFull(R.cont)})` },
    ...input.otherCosts
      .filter((o) => o.amount !== 0)
      .map((o) => ({ label: o.label, val: `(${formatMoneyFull(o.amount)})` })),
    { label: 'Finance (interest + fees)', note: `${input.finance.ratePct}% pa`, val: `(${formatMoneyFull(R.finance)})` },
    ...(isResidual
      ? ([
          { label: 'Developer profit', note: `${Math.round(R.poc * 100)}% on cost`, val: `(${formatMoneyFull(R.profit)})`, kind: 'sub' },
          { label: 'Residual land value', val: formatMoneyFull(R.residualNet), kind: 'final' },
        ] as BreakRow[])
      : ([
          { label: 'Land (incl. acquisition)', note: `${input.site.acqPct}% acq.`, val: `(${formatMoneyFull(R.landGross)})`, kind: 'sub' },
          { label: 'Developer profit', note: `${Math.round(R.poc * 100)}% on cost`, val: formatMoneyFull(R.profit), kind: 'final' },
        ] as BreakRow[])),
  ];

  // Sensitivity colour bands — same thresholds as DevelopmentAppraisal.tsx.
  const cellStyle = (v: number, ratio: number) => {
    if (v <= 0) return { color: '#B23A2E', background: '#F9EAE7' };
    if (ratio >= 1.12) return { color: '#14503B', background: 'rgb(var(--tint-green-deep, 223 239 231))' };
    if (ratio >= 1.02) return { color: '#1E7A55', background: '#ECF3EF' };
    if (ratio > 0.98) return { color: '#5F665F', background: '#F4F4F0' };
    // #9A6212 on this tint is 4.48:1 — under AA. It went unseen because no
    // seeded scheme put a cell in the amber band until the DCF grid did.
    if (ratio > 0.85) return { color: '#85520E', background: '#F8F0DE' };
    return { color: '#B23A2E', background: '#F9EAE7' };
  };
  const steps = [-0.1, -0.05, 0, 0.05, 0.1];
  const deltaLabel = (d: number) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d * 100) + '%';

  const assumptions: Array<[string, string]> = [
    ['Build cost', `£${Math.round(R.buildRate)} / ft² GIA`],
    ['Efficiency (NIA:GIA)', `${input.efficiency}%`],
    ['Professional fees', `${input.profFeePct}% of build`],
    ['Contingency', `${input.contingencyPct}% of build`],
    ...(isResidual
      ? ([['Developer profit target', `${input.targetProfitOnGdvPct}% of GDV`]] as Array<[string, string]>)
      : ([['Fixed land price', formatMoneyFull(input.site.landFixed)]] as Array<[string, string]>)),
    ['Finance rate', `${input.finance.ratePct}% pa`],
    ['Loan to cost', `${input.finance.ltcPct}%`],
    ['Arrangement fee', `${input.finance.arrangementFeePct}%`],
    ['Build programme', `${R.period} months`],
    ['Sales / void period', `${R.salesMonths} months`],
    ['Spend profile', (input.finance.spendProfile ?? 'scurve') === 'scurve' ? 'S-curve' : (input.finance.spendProfile ?? 'scurve')],
    ['Disposal costs', `${disposalPct.toFixed(1)}% of GDV`],
    ['Acquisition costs', `${input.site.acqPct}% of land`],
    ...(jv
      ? ([
          ['JV — GP co-invest', `${jv.gpCoinvestPct}% of equity`],
          ['JV — preferred return', `${jv.prefPct}% pa compounded`],
          ['JV — promote', `${jv.promotePct}% of residual`],
        ] as Array<[string, string]>)
      : []),
  ];

  // A phased scheme's accommodation lives on the phases — reading input.units
  // here would print an empty schedule for exactly the schemes that need one.
  const toRow = (u: { label: string; count: number; area: number; cap: number }) => ({
    label: u.label,
    count: u.count,
    area: u.count * u.area,
    rate: u.cap,
    value: u.count * u.area * u.cap,
  });
  const phaseGroups =
    R.phases?.length && input.phases?.length
      ? R.phases.map((p, i) => ({ phase: p, rows: (input.phases![i]?.units ?? []).map(toRow) }))
      : null;
  const unitRows = phaseGroups ? phaseGroups.flatMap((g) => g.rows) : input.units.map(toRow);

  /**
   * Accommodation schedule pagination — MEASURED, not guessed. An A4 page holds
   * 924px of content (1122 less 112 padding, 37 head, 49 foot). The table repeats
   * its header on every page (37px after an 18px margin); a phase group header
   * costs 34, a unit row 40, the closing GDV row 43 and the KPI strip 96. The
   * phasing block is a heading and caption (30), its own header (33), 42 a phase
   * and the closing narrative (110).
   *
   * A twelve-phase scheme has more schedule than one sheet holds. It used to run
   * silently past the page — and because the box grows rather than clips, nothing
   * on screen said so; it simply printed an extra sheet the footers denied.
   */
  const PAGE_PX = 924;
  const TABLE_HEAD_PX = 55;
  const GROUP_PX = 34;
  const UNIT_PX = 40;
  const TOTAL_PX = 43;
  const KPI_PX = 96;
  const phasingPx = R?.phases?.length ? 173 + 42 * R.phases.length : 0;

  type SchedRow = ReturnType<typeof toRow>;
  type SchedItem =
    | { kind: 'group'; phase: NonNullable<typeof R.phases>[number]; continued?: boolean }
    | { kind: 'unit'; row: SchedRow };

  // NOT a hook: this sits below the loading/empty guards, and a useMemo here
  // renders a different number of hooks on the first pass than on later ones
  const schedule = (() => {
    const items: SchedItem[] = phaseGroups
      ? phaseGroups.flatMap((g) => [
          ...(g.phase ? [{ kind: 'group' as const, phase: g.phase }] : []),
          ...g.rows.map((row) => ({ kind: 'unit' as const, row })),
        ])
      : unitRows.map((row) => ({ kind: 'unit' as const, row }));

    const cap = PAGE_PX - TABLE_HEAD_PX;
    const pages: SchedItem[][] = [[]];
    let used = 0;
    let group: NonNullable<typeof R.phases>[number] | null = null;
    for (const it of items) {
      if (it.kind === 'group') group = it.phase;
      const px = it.kind === 'group' ? GROUP_PX : UNIT_PX;
      // a group header stranded at the foot of a page is a widow: it needs room
      // for at least one of its own rows or it breaks to the next page with them
      const need = it.kind === 'group' ? px + UNIT_PX : px;
      if (used + need > cap && pages[pages.length - 1].length > 0) {
        pages.push([]);
        used = 0;
        // a phase split across sheets repeats its header, marked as carried over:
        // otherwise the rows opening the next sheet belong to no visible phase
        if (it.kind === 'unit' && group) {
          pages[pages.length - 1].push({ kind: 'group', phase: group, continued: true });
          used += GROUP_PX;
        }
      }
      pages[pages.length - 1].push(it);
      used += px;
    }
    // the closing row and the KPI strip live under the last page's table
    if (used + TOTAL_PX + KPI_PX > cap) {
      pages.push([]);
      used = 0;
    }
    const phasingShares = phasingPx > 0 && used + TOTAL_PX + KPI_PX + phasingPx <= cap;
    return { pages, phasingShares };
  })();

  /**
   * Phasing on its own sheet when it cannot share: 924 less the heading block
   * (30), the table header (33) and the narrative (110) leaves 751px — seventeen
   * phase rows. Past that the phasing table paginates too, rather than running
   * off a sheet no one measured.
   */
  const phasingChunks = (() => {
    const phases = R?.phases ?? [];
    if (!phases.length || schedule.phasingShares) return [];
    const perPage = Math.max(1, Math.floor((PAGE_PX - 30 - 33 - 110) / 42));
    const out: (typeof phases)[] = [];
    for (let i = 0; i < phases.length; i += perPage) out.push(phases.slice(i, i + perPage));
    return out;
  })();

  /** every sheet section 2 occupies: the schedule, plus any phasing overflow */
  const schedulePageCount = schedule.pages.length + phasingChunks.length;

  /**
   * Page and section numbering, DERIVED. A scheme that holds space gains an
   * investment section after the residual appraisal, and everything downstream
   * shifts by one. Hand-written numbers would have desynced the moment the
   * section became conditional — the footers say "Page n of N" and the PDF is
   * printed from exactly these pages.
   */
  const hasInvestment = !!R.income;
  const inv = hasInvestment ? 1 : 0;
  // a phase that prices its own trades earns a continuation sheet after the
  // accommodation schedule — it stays inside section 2, so only pages shift
  const ovr = phaseOverrides.shown.length > 0 ? 1 : 0;
  // section 2 is no longer one sheet: the schedule paginates, and the phasing
  // block takes its own sheets when it cannot share the schedule's last one
  const sched = schedulePageCount - 1;
  const secInvestment = 4;
  const secSensitivity = 4 + inv;
  const secCashflow = 5 + inv;
  const secAssumptions = 6 + inv;
  const secAi = 7 + inv;
  // the notice was hardcoded "8": it collided with monitoring on every scheme
  // and with the AI subsection as soon as an investment section appeared
  const secNotice = 8 + inv;
  const secMonitoring = 9 + inv;
  const scheduleStartPageNo = 3;
  // the DCF matrix earns a continuation sheet of section 4 when there is a DCF
  const dsn = dcfGrid ? 1 : 0;
  const dcfBase = dcfGrid?.flat().find((c) => c.isBase) ?? null;
  const dcfSubCap = dcfGrid?.flat().filter((c) => c.vsCapitalisation < 1).length ?? 0;
  const overridesPageNo = 4 + sched;
  const residualPageNo = 4 + sched + ovr;
  const investmentPageNo = 5 + sched + ovr;
  const dcfGridPageNo = 6 + sched + ovr;
  const sensitivityPageNo = 5 + sched + inv + dsn + ovr;
  const cashStartPageNo = 6 + sched + inv + dsn + ovr;
  const assumptionsPageNo = cashStartPageNo + cashChunks.length;
  const monitoringPageNo = assumptionsPageNo + 1;
  const pageTotal = monitoring.length > 0 ? monitoringPageNo : assumptionsPageNo;

  /**
   * The phasing table, wherever it lands. `first` prints the heading (a
   * continuation sheet already says "Phasing" in its page head) and `last` prints
   * the closing narrative, so a split table does not repeat either.
   */
  const PhasingBlock = ({
    phases,
    first = false,
    last = true,
  }: {
    phases: NonNullable<typeof R.phases>;
    first?: boolean;
    last?: boolean;
  }) => (
    <>
      {first && <SectionTitle>Phasing</SectionTitle>}
      <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: first ? 10 : 18 }}>
        <div className="flex text-white fig text-[10px] font-semibold uppercase" style={{ background: brand[700], letterSpacing: '0.4px' }}>
          <div style={{ flex: 2.2, padding: '9px 14px' }}>Phase</div>
          <div className="text-right" style={{ flex: 1.3, padding: '9px 10px' }}>On site</div>
          <div className="text-right" style={{ flex: 0.8, padding: '9px 10px' }}>Units</div>
          <div className="text-right" style={{ flex: 1, padding: '9px 10px' }}>£/ft²</div>
          <div className="text-right" style={{ flex: 1.3, padding: '9px 10px' }}>Construction</div>
          <div className="text-right" style={{ flex: 1.3, padding: '9px 14px' }}>GDV</div>
        </div>
        {phases.map((p, i) => (
          <div key={i} className="flex border-t border-border-faint fig text-[11.5px] font-medium">
            <div className="font-ui text-[12px]" style={{ flex: 2.2, padding: '9px 14px' }}>{p.name}</div>
            <div className="text-right" style={{ flex: 1.3, padding: '9px 10px' }}>{p.buildMonths} mo</div>
            <div className="text-right" style={{ flex: 0.8, padding: '9px 10px' }}>{p.unitCount}</div>
            <div className="text-right" style={{ flex: 1, padding: '9px 10px' }}>£{n0(p.buildRate)}</div>
            <div className="text-right" style={{ flex: 1.3, padding: '9px 10px' }}>{formatMoneyFull(p.cost + p.otherTotal)}</div>
            <div className="text-right font-semibold" style={{ flex: 1.3, padding: '9px 14px', color: brand[700] }}>{formatMoneyFull(p.gdv)}</div>
          </div>
        ))}
      </div>
      {last && (
        <p className="mt-2.5 text-[12px] text-ink-2b leading-[1.6]">
          The scheme is delivered in {R.phases!.length} phases over {R.period + R.salesMonths} months, sharing one facility;
          receipts from a completed phase repay it while a later phase is still drawing, holding peak debt to{' '}
          {formatMoneyFull(R.facility)}. Construction is stated at each phase's own rate — a blended £{n0(R.buildRate)}/ft² of GIA
          across the scheme — and includes fees, contingency and any costs booked to that phase. Areas are net internal (NIA);
          gross internal area is derived at the stated {input.efficiency}% efficiency.
        </p>
      )}
    </>
  );

  return (
    <div className="light min-h-screen bg-frame">
      <style>{PRINT_CSS}</style>
      {toolbar}

      <div className="a4-canvas flex flex-col items-center gap-6 px-5 pt-7 pb-14">
        {/* ===== PAGE 1 — COVER ===== */}
        <A4Page pad={false}>
          <div className="relative overflow-hidden text-white" style={{ background: `linear-gradient(155deg,${brand[600]},${brand[900]})`, padding: '64px 60px 56px' }}>
            <div className="absolute rounded-full" style={{ top: -60, right: -60, width: 280, height: 280, background: 'rgba(127,227,180,0.08)' }} />
            <div className="relative flex items-center gap-3">
              <FirmMark logoUrl={org?.logoUrl} size={38} alt={`${org?.name ?? 'Firm'} logo`} />
              <span className="text-[19px] font-bold tracking-[-0.3px]">{org?.name ?? 'Apex Appraise'}</span>
            </div>
            <div className="relative mt-20 fig text-[13px] font-medium uppercase" style={{ letterSpacing: '2.5px', color: accent.muted2 }}>
              Development appraisal &amp; investment summary
            </div>
            <h1 className="relative mt-4 text-[44px] font-bold leading-[1.04]" style={{ letterSpacing: '-1.8px' }}>{scheme}</h1>
            <div className="relative mt-3.5 text-[17px]" style={{ color: accent.muted4 }}>{deal?.address}</div>
            {deal && (
              <span className="relative label-mono inline-flex mt-6 px-2.5 py-1 rounded-[7px]" style={{ background: 'rgba(255,255,255,0.14)', color: accent.muted4 }}>
                Figures {deal.figureStatus.toLowerCase()}
              </span>
            )}
          </div>
          <div className="flex-1 flex flex-col" style={{ padding: '46px 60px' }}>
            <div className="grid grid-cols-2" style={{ gap: '26px 40px' }}>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Prepared for</div>
                <div className="mt-1.5 text-[16px] font-semibold">Brookfield Developments Ltd</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Prepared by</div>
                <div className="mt-1.5 text-[16px] font-semibold">{deal?.owner?.name ?? 'D. Whitlock'} MRICS</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>File reference</div>
                <div className="fig mt-1.5 text-[16px] font-semibold">{refCode}</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Effective date</div>
                <div className="mt-1.5 text-[16px] font-semibold">{today}</div>
              </div>
            </div>
            <div className="mt-10 rounded-card bg-canvas border border-border-std" style={{ padding: '28px 30px' }}>
              <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Headline result</div>
              <div className="mt-3.5 flex gap-10">
                <div>
                  <div className="text-[12px] text-ink-2b">{isResidual ? 'Residual land value' : 'Developer profit'}</div>
                  <div className="fig mt-1 text-[30px] font-semibold" style={{ letterSpacing: '-1.4px', color: brand[700] }}>{fM(isResidual ? R.residualNet : R.profit)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-ink-2b">Profit on cost</div>
                  <div className="fig mt-1 text-[30px] font-semibold" style={{ letterSpacing: '-1.4px' }}>{Math.round(R.poc * 100)}%</div>
                </div>
                <div>
                  <div className="text-[12px] text-ink-2b">GDV</div>
                  <div className="fig mt-1 text-[30px] font-semibold" style={{ letterSpacing: '-1.4px' }}>{fM(R.gdv)}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-ink-3 border-t border-border-std" style={{ padding: '22px 60px' }}>
            <span>Strictly private &amp; confidential</span>
            <span>{org?.name ?? 'Apex Appraise'} · {today}</span>
          </div>
        </A4Page>

        {/* ===== PAGE 2 — EXECUTIVE SUMMARY ===== */}
        <A4Page>
          <PageHead title="1 · Executive summary" scheme={scheme} />
          <p className="text-[13.5px] leading-[1.65]" style={{ marginTop: 18, color: '#3F463F' }}>
            This report sets out a development appraisal and investment summary of {scheme}, {deal?.address}, comprising {n0(R.nia)} ft² NIA
            ({n0(R.gia)} ft² GIA) across {n0(unitRows.reduce((a, u) => a + u.count, 0))} units. On the assumptions set out herein, the scheme
            {isResidual
              ? ` supports a residual land value of ${formatMoneyFull(R.residualNet)} at a target developer profit of ${input.targetProfitOnGdvPct}% of GDV`
              : ` returns a developer profit of ${formatMoneyFull(R.profit)} against a fixed land price of ${formatMoneyFull(input.site.landFixed)}`}
            , equivalent to {formatPct(R.poc, 0)} on cost and {formatPct(R.rogdv, 0)} on GDV. Peak debt is {fM(R.facility)} against total
            development costs of {fM(R.totalCost)}. On the evidence available, the scheme is assessed as <b className="font-semibold">{viability}</b>
            {viability === 'viable' ? ' and represents an actionable opportunity.' : viability === 'marginal' ? ' — returns sit below target and warrant further value engineering.' : ' on the current assumptions.'}
          </p>

          <div className="mt-6 grid grid-cols-4 gap-3">
            <Kpi label="GDV" value={fM(R.gdv)} />
            <Kpi label="Residual land" value={fM(R.residualNet)} tone={brand[700]} />
            <Kpi label="Profit" value={fM(R.profit)} tone={brand[500]} />
            <Kpi label="Return on cost" value={formatPct(R.poc, 0)} />
            <Kpi label="Return on GDV" value={formatPct(R.rogdv, 0)} />
            <Kpi label="Project IRR" value={cash.projIrr == null ? 'N/A' : formatPct(cash.projIrr, 0)} />
            <Kpi label="Equity IRR" value={cash.eqIrr == null ? 'N/A' : formatPct(cash.eqIrr, 0)} />
            <Kpi label="Peak debt" value={fM(cash.peak)} />
          </div>

          <SectionTitle>Scheme facts</SectionTitle>
          <div className="mt-3 grid grid-cols-2" style={{ gap: '0 40px' }}>
            <KvRow k="Asset type" v={(deal?.assetType ?? '—').replace('_', ' / ')} />
            <KvRow k="Pipeline stage" v={(deal?.stage ?? '—').replace('_', ' / ')} />
            <KvRow k="Figure status" v={deal?.figureStatus ?? '—'} />
            <KvRow k="Probability" v={deal ? `${deal.probability}%` : '—'} />
            <KvRow k="Planning status" v={appr.planningStatus ?? 'Not assessed'} />
            <KvRow k="Site purchase basis" v={isResidual ? 'Residual — solve land at target profit' : 'Fixed land — read profit'} />
            <KvRow k="Total development cost" v={formatMoneyFull(R.totalCost)} />
            <KvRow k="Equity requirement" v={formatMoneyFull(R.equity)} />
          </div>
          <PageFoot no={2} total={pageTotal} refCode={refCode} firmName={firmName} />
        </A4Page>

        {/* ===== SECTION 2 — ACCOMMODATION SCHEDULE, paginated ===== */}
        {schedule.pages.map((items, pi) => {
          const isLast = pi === schedule.pages.length - 1;
          return (
            <A4Page key={`sched-${pi}`}>
              <PageHead
                title={pi === 0 ? '2 · Accommodation schedule' : `2 · Accommodation schedule (${pi + 1} of ${schedule.pages.length})`}
                scheme={scheme}
              />
              <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: 18 }}>
                <div className="flex text-white fig text-[10px] font-semibold uppercase" style={{ background: brand[700], letterSpacing: '0.4px' }}>
                  <div style={{ flex: 2.4, padding: '11px 14px' }}>Use / unit</div>
                  <div className="text-right" style={{ flex: 0.8, padding: '11px 14px' }}>No.</div>
                  <div className="text-right" style={{ flex: 1.1, padding: '11px 14px' }}>Area ft²</div>
                  <div className="text-right" style={{ flex: 1, padding: '11px 14px' }}>£/ft²</div>
                  <div className="text-right" style={{ flex: 1.3, padding: '11px 14px' }}>Value</div>
                </div>
                {items.map((it, ii) =>
                  it.kind === 'group' ? (
                    <div
                      key={ii}
                      className="flex border-t border-border-faint fig text-[11px] font-semibold uppercase"
                      style={{ background: 'rgb(243 248 245)', letterSpacing: '0.4px', color: brand[700] }}
                    >
                      <div className="font-ui text-[11.5px]" style={{ flex: 2.4, padding: '8px 14px' }}>
                        {it.phase.name}
                        {it.continued && <span className="normal-case font-normal text-ink-3"> (continued)</span>}
                      </div>
                      <div className="text-right normal-case" style={{ flex: 4.2, padding: '8px 14px', color: neutral.ink2 }}>
                        on site {monthLabel(it.phase.start)}–{monthLabel(it.phase.practicalCompletion)} · sells to{' '}
                        {monthLabel(it.phase.end)}
                      </div>
                    </div>
                  ) : (
                    <div key={ii} className="flex border-t border-border-faint fig text-[12px] font-medium">
                      <div className="font-ui text-[12.5px]" style={{ flex: 2.4, padding: '10px 14px' }}>{it.row.label}</div>
                      <div className="text-right" style={{ flex: 0.8, padding: '10px 14px' }}>{it.row.count}</div>
                      <div className="text-right" style={{ flex: 1.1, padding: '10px 14px' }}>{n0(it.row.area)}</div>
                      <div className="text-right" style={{ flex: 1, padding: '10px 14px' }}>£{n0(it.row.rate)}</div>
                      <div className="text-right font-semibold" style={{ flex: 1.3, padding: '10px 14px', color: brand[700] }}>
                        {formatMoneyFull(it.row.value)}
                      </div>
                    </div>
                  ),
                )}
                {/* the schedule totals ONCE, on its last sheet — a running total on
                    every sheet would read as the scheme's and be wrong on all but one */}
                {isLast && (
                  <div className="flex bg-sunken fig text-[12.5px] font-semibold" style={{ borderTop: `2px solid ${neutral.border}` }}>
                    <div className="font-ui" style={{ flex: 2.4, padding: '11px 14px' }}>Gross development value</div>
                    <div style={{ flex: 0.8 }} />
                    <div className="text-right" style={{ flex: 1.1, padding: '11px 14px' }}>{n0(R.nia)}</div>
                    <div style={{ flex: 1 }} />
                    <div className="text-right" style={{ flex: 1.3, padding: '11px 14px', color: brand[700] }}>{formatMoneyFull(R.gdv)}</div>
                  </div>
                )}
              </div>

              {!isLast && (
                <p className="mt-2 text-[11px] text-ink-3">
                  Schedule continues on page {scheduleStartPageNo + pi + 1}; the scheme totals on its last sheet.
                </p>
              )}

              {isLast && (
                <>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <Kpi label="Net internal area" value={`${n0(R.nia)} ft²`} />
                    <Kpi label="Gross internal area" value={`${n0(R.gia)} ft²`} />
                    <Kpi label="Efficiency (NIA:GIA)" value={`${input.efficiency}%`} />
                  </div>
                  {R.phases?.length ? (
                    schedule.phasingShares && <PhasingBlock phases={R.phases} first />
                  ) : (
                    <>
                      <SectionTitle>Basis of areas</SectionTitle>
                      <p className="mt-2.5 text-[12px] text-ink-2b leading-[1.6]">
                        Unit areas are net internal areas (NIA) in square feet as scheduled in the current appraisal. Gross internal
                        area is derived at the stated NIA:GIA efficiency of {input.efficiency}%. Capital values are applied per square
                        foot of NIA; construction costs are applied per square foot of GIA.
                      </p>
                    </>
                  )}
                </>
              )}
              <PageFoot no={scheduleStartPageNo + pi} total={pageTotal} refCode={refCode} firmName={firmName} />
            </A4Page>
          );
        })}

        {/* ===== PHASING — its own sheets when the schedule's last page cannot hold it ===== */}
        {phasingChunks.map((chunk, ci) => (
          <A4Page key={`phasing-${ci}`}>
            <PageHead
              title={phasingChunks.length > 1 ? `2 · Phasing (${ci + 1} of ${phasingChunks.length})` : '2 · Phasing'}
              scheme={scheme}
            />
            <PhasingBlock phases={chunk} first={ci === 0} last={ci === phasingChunks.length - 1} />
            <PageFoot
              no={scheduleStartPageNo + schedule.pages.length + ci}
              total={pageTotal}
              refCode={refCode}
              firmName={firmName}
            />
          </A4Page>
        ))}

        {/* ===== PHASE COST OVERRIDES — continuation of section 2, only when a phase prices its own trades ===== */}
        {phaseOverrides.shown.length > 0 && (
          <A4Page>
            <PageHead title="2 · Phase cost overrides" scheme={scheme} />
            <p className="mt-4 text-[12px] text-ink-2b leading-[1.6]">
              These phases are priced on their own trades rather than the scheme's — a podium block is not a terrace, and the
              appraisal treats them separately.{' '}
              {(R.phases ?? []).some((p) => !p.ownTrades)
                ? // only claim there is an inheriting phase when there is one
                  `Every other phase inherits the scheme's ${input.profFeePct}% fees and ${input.contingencyPct}% contingency at £${n0(input.trades.reduce((a, t) => a + t.rate, 0))}/ft².`
                : 'Every phase in this scheme prices its own trades, so no phase carries the scheme rate.'}
            </p>
            {phaseOverrides.shown.map(({ phase, trades }, pi) => {
              const feePct = phase.build > 0 ? (phase.fees / phase.build) * 100 : input.profFeePct;
              const contPct = phase.build > 0 ? (phase.cont / phase.build) * 100 : input.contingencyPct;
              const differs = Math.abs(feePct - input.profFeePct) > 0.05 || Math.abs(contPct - input.contingencyPct) > 0.05;
              return (
                <div key={pi} className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: 14 }}>
                  <div className="flex text-[11.5px] font-semibold" style={{ background: '#F4F6F4', padding: '8px 14px' }}>
                    <div style={{ flex: 3 }}>{phase.name}</div>
                    <div className="fig text-right" style={{ flex: 1 }}>£{n0(phase.buildRate)}/ft²</div>
                    <div className="fig text-right" style={{ flex: 1.4 }}>{formatMoneyFull(phase.build)}</div>
                  </div>
                  {trades.map((t, ti) => (
                    <div key={ti} className="flex text-[11.5px]" style={{ borderTop: '1px solid #ECEBE5' }}>
                      <div className="text-ink-2b" style={{ flex: 3, padding: '6px 14px 6px 24px' }}>{t.label}</div>
                      <div className="fig text-right" style={{ flex: 1, padding: '6px 0' }}>£{t.rate}</div>
                      <div className="fig text-right" style={{ flex: 1.4, padding: '6px 14px' }}>{formatMoneyFull(t.rate * phase.gia)}</div>
                    </div>
                  ))}
                  {differs && (
                    <div className="flex text-[11px] text-ink-2b" style={{ borderTop: '1px solid #ECEBE5', padding: '6px 14px 6px 24px' }}>
                      {/* name only what actually differs — calling an inherited
                          rate "this phase's own" would be misleading */}
                      {[
                        Math.abs(feePct - input.profFeePct) > 0.05
                          ? `professional fees ${feePct.toFixed(1)}% (scheme ${input.profFeePct}%)`
                          : null,
                        Math.abs(contPct - input.contingencyPct) > 0.05
                          ? `contingency ${contPct.toFixed(1)}% (scheme ${input.contingencyPct}%)`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {' '}— set on this phase
                    </div>
                  )}
                </div>
              );
            })}
            {/* the point of the sheet: overriding and inheriting phases still add
                up to the construction line carried into the residual appraisal */}
            <SectionTitle>Construction reconciliation</SectionTitle>
            <p className="mt-1.5 text-[11px] text-ink-3 leading-snug">
              Phase costs below include professional fees and contingency; the trade cards above are construction only.
            </p>
            <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: 8 }}>
              {(R.phases ?? []).map((p, pi) => (
                <div
                  key={pi}
                  className="flex fig text-[11.5px]"
                  style={{ borderTop: pi === 0 ? 'none' : '1px solid #ECEBE5', padding: '7px 14px' }}
                >
                  <div className="font-ui" style={{ flex: 2.6 }}>{p.name}</div>
                  <div className="font-ui text-ink-3 text-[11px]" style={{ flex: 1.6 }}>
                    {p.ownTrades ? 'own trades' : 'scheme rate'}
                  </div>
                  <div className="text-right" style={{ flex: 1 }}>£{n0(p.buildRate)}/ft²</div>
                  <div className="text-right" style={{ flex: 1.4 }}>{formatMoneyFull(p.cost)}</div>
                </div>
              ))}
              {/* phase GIA need not exhaust the scheme's — anything priced outside
                  the phase schedule is named, so the column genuinely adds up */}
              {Math.abs(unphasedConstruction) >= 1 && (
                <div className="flex fig text-[11.5px]" style={{ borderTop: '1px solid #ECEBE5', padding: '7px 14px' }}>
                  <div className="font-ui" style={{ flex: 2.6 }}>Outside the phase schedule</div>
                  <div className="font-ui text-ink-3 text-[11px]" style={{ flex: 1.6 }}>scheme rate</div>
                  <div className="text-right" style={{ flex: 1 }} />
                  <div className="text-right" style={{ flex: 1.4 }}>{formatMoneyFull(unphasedConstruction)}</div>
                </div>
              )}
              <div
                className="flex fig text-[11.5px] font-semibold bg-sunken"
                style={{ borderTop: `2px solid ${neutral.border}`, padding: '8px 14px' }}
              >
                {/* no comma: the figure face spaces punctuation oddly at this size */}
                <div className="font-ui" style={{ flex: 4.2 }}>Construction with fees and contingency</div>
                <div className="text-right" style={{ flex: 1 }}>£{n0(R.buildRate)}/ft²</div>
                <div className="text-right" style={{ flex: 1.4, color: brand[700] }}>
                  {formatMoneyFull(R.build + R.fees + R.cont)}
                </div>
              </div>
            </div>
            {phaseOverrides.hiddenTotal > 0 && (
              <p className="mt-3 text-[11px] text-ink-3 leading-snug">
                {phaseOverrides.hiddenTotal} further trade line{phaseOverrides.hiddenTotal === 1 ? '' : 's'}
                {phaseOverrides.hiddenPhases > 0
                  ? ` across ${phaseOverrides.hiddenPhases} further phase${phaseOverrides.hiddenPhases === 1 ? '' : 's'}`
                  : ''}{' '}
                are not printed here for space; the complete breakdown is in the .xlsx export.
              </p>
            )}
            <PageFoot no={overridesPageNo} total={pageTotal} refCode={refCode} firmName={firmName} />
          </A4Page>
        )}

        {/* ===== RESIDUAL APPRAISAL ===== */}
        <A4Page>
          <PageHead title="3 · Residual appraisal" scheme={scheme} />
          <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: 18 }}>
            {breakRows.map((r, i) => {
              const isHead = r.kind === 'head';
              const isSub = r.kind === 'sub';
              const isFinal = r.kind === 'final';
              return (
                <div
                  key={i}
                  className="flex items-center"
                  style={{
                    borderTop: i === 0 ? 'none' : `1px solid ${isFinal ? neutral.tintSuccess2 : neutral.borderFaint}`,
                    background: isFinal ? neutral.tintSuccess : isHead || isSub ? neutral.sunken : neutral.surface,
                  }}
                >
                  <div
                    className="flex-1"
                    style={{
                      padding: `${isFinal ? 13 : 10}px 16px`,
                      font: isFinal ? "700 13px 'Schibsted Grotesk'" : isHead ? "600 13px 'Schibsted Grotesk'" : isSub ? "600 12.5px 'Schibsted Grotesk'" : "400 12.5px 'Schibsted Grotesk'",
                      color: isFinal || isHead ? brand[700] : neutral.ink,
                    }}
                  >
                    {r.label}
                  </div>
                  <div className="fig text-right text-[11px] text-ink-3" style={{ width: 100, padding: `${isFinal ? 13 : 10}px 16px` }}>{r.note ?? ''}</div>
                  <div
                    className="fig text-right"
                    style={{
                      width: 150,
                      padding: `${isFinal ? 13 : 10}px 16px`,
                      fontSize: isFinal ? 14 : isHead ? 13 : 12.5,
                      fontWeight: isFinal ? 700 : isHead || isSub ? 600 : 500,
                      color: isFinal || isHead ? brand[700] : neutral.ink,
                    }}
                  >
                    {r.val}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 grid grid-cols-4 gap-3">
            <Kpi label="Project IRR" value={cash.projIrr == null ? 'N/A' : formatPct(cash.projIrr, 0)} />
            <Kpi label="Equity IRR" value={cash.eqIrr == null ? 'N/A' : formatPct(cash.eqIrr, 0)} />
            <Kpi label="RoGDV" value={formatPct(R.rogdv, 0)} />
            <Kpi label="Peak debt" value={fM(R.facility)} />
          </div>

          <SectionTitle>Notes</SectionTitle>
          <p className="mt-2.5 text-[12px] text-ink-2b leading-[1.6]">
            Finance interest compounds monthly on the drawn balance; only the {input.finance.ltcPct}% loan-to-cost share of each month's
            spend is drawn, with equity funding the remainder. {isResidual
              ? `The residual land value is solved so that developer profit equals ${input.targetProfitOnGdvPct}% of GDV after acquisition costs of ${input.site.acqPct}%.`
              : `Developer profit is the amount remaining after all costs including the fixed land price plus ${input.site.acqPct}% acquisition costs.`}
          </p>
          <PageFoot no={residualPageNo} total={pageTotal} refCode={refCode} firmName={firmName} />
        </A4Page>

        {/* ===== INVESTMENT — only when the scheme holds and lets space ===== */}
        {hasInvestment && R.income && input.income && (
          <A4Page>
            <PageHead title={`${secInvestment} · Investment valuation`} scheme={scheme} />

            <p className="mt-4 text-[12px] text-ink-2b leading-[1.6]">
              Part of the scheme is retained and let rather than sold on. Its value is the net rent capitalised at the
              all-risks yield, net of purchaser's costs, and that figure is the one carried into gross development value
              on the preceding page.
            </p>

            <SectionTitle>Rent roll</SectionTitle>
            <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: 10 }}>
              <div className="flex text-[10px] font-semibold uppercase" style={{ background: brand[700], color: '#fff' }}>
                <div style={{ flex: 2.4, padding: '9px 14px' }}>Tenancy</div>
                <div className="text-right" style={{ flex: 1, padding: '9px 10px' }}>Area ft²</div>
                <div className="text-right" style={{ flex: 1, padding: '9px 10px' }}>Rent £/ft²</div>
                <div className="text-right" style={{ flex: 1, padding: '9px 10px' }}>ERV £/ft²</div>
                <div className="text-right" style={{ flex: 1.3, padding: '9px 14px' }}>Net rent</div>
              </div>
              {R.income.lines.map((l, i) => (
                <div key={i} className="flex text-[12px]" style={{ borderTop: '1px solid #ECEBE5' }}>
                  <div style={{ flex: 2.4, padding: '9px 14px' }}>{l.label}</div>
                  <div className="fig text-right" style={{ flex: 1, padding: '9px 10px' }}>{n0(l.totalArea)}</div>
                  <div className="fig text-right" style={{ flex: 1, padding: '9px 10px' }}>
                    £{(l.totalArea > 0 ? l.grossRent / l.totalArea : 0).toFixed(2)}
                  </div>
                  <div className="fig text-right" style={{ flex: 1, padding: '9px 10px' }}>
                    £{(l.totalArea > 0 ? l.grossErv / l.totalArea : 0).toFixed(2)}
                  </div>
                  <div className="fig text-right font-semibold" style={{ flex: 1.3, padding: '9px 14px' }}>
                    {formatMoneyFull(l.netPassing)}
                  </div>
                </div>
              ))}
            </div>

            <SectionTitle>Capitalisation</SectionTitle>
            <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: 10 }}>
              {([
                ['Gross rent', formatMoneyFull(R.income.grossRent)],
                ['Less: voids and non-recoverables', `(${formatMoneyFull(R.income.voidAllowance + R.income.nonRecoverable + R.income.deductions)})`],
                ['Net rent (NOI)', formatMoneyFull(R.income.netRent), 'sub'],
                ...(R.income.lines.some((l) => l.isReversionary)
                  ? ([
                      ['Term — passing rent capitalised', formatMoneyFull(R.income.lines.reduce((a, l) => a + l.termValue, 0))],
                      [
                        R.income.method === 'hardcore' ? 'Top slice — uplift deferred' : 'Reversion — ERV deferred to review',
                        formatMoneyFull(R.income.lines.reduce((a, l) => a + l.reversionValue, 0)),
                      ],
                    ] as Array<[string, string, string?]>)
                  : ([[`Years purchase @ ${input.income.yieldPct}% — YP ${R.income.yearsPurchase.toFixed(2)}`, formatMoneyFull(R.income.grossCapitalValue)]] as Array<[string, string, string?]>)),
                [`Let-up void — ${input.income.letUpMonths ?? 0} months`, `(${formatMoneyFull(R.income.letUpDeduction)})`],
                [`Purchaser's costs (${input.income.purchaserCostsPct ?? 6.8}%)`, `(${formatMoneyFull(R.income.purchaserCosts)})`],
                ['Investment value in GDV', formatMoneyFull(R.income.netCapitalValue), 'final'],
              ] as Array<[string, string, string?]>).map(([label, value, kind]) => (
                <div
                  key={label}
                  className="flex justify-between text-[12.5px]"
                  style={{
                    borderTop: '1px solid #ECEBE5',
                    background: kind === 'final' ? '#ECF3EF' : undefined,
                    fontWeight: kind ? 700 : 400,
                  }}
                >
                  <div style={{ padding: '9px 14px', color: kind === 'final' ? brand[700] : undefined }}>{label}</div>
                  <div className="fig text-right" style={{ padding: '9px 14px', color: kind === 'final' ? brand[700] : undefined }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-4 gap-3">
              <Kpi label="Net initial yield" value={formatPct(R.income.netInitialYield, 2)} tone={brand[700]} />
              <Kpi label="Reversionary" value={formatPct(R.income.reversionaryYield, 2)} />
              <Kpi label="Equivalent yield" value={formatPct(R.income.equivalentYield, 2)} />
              <Kpi label="Capital value" value={`£${n0(R.income.capitalValuePsf)}/ft²`} />
            </div>

            {dcf && input.dcf && (
              <>
                <SectionTitle>Growth-explicit cross-check</SectionTitle>
                <p className="mt-2 text-[12px] text-ink-2b leading-[1.6]">
                  The capitalisation above prices rental growth implicitly, within the yield. Stating it explicitly —{' '}
                  {input.dcf.rentalGrowthPct}% per annum over a {input.dcf.holdYears}-year hold, rent reviewed every{' '}
                  {input.dcf.reviewCycleYears ?? 5} years, sold at {input.dcf.exitYieldPct}% and discounted at{' '}
                  {input.dcf.discountRatePct}% — gives the figures below. This is a cross-check: the reported value remains
                  the capitalisation.
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-x-8">
                  {([
                    ['PV of income over the hold', formatMoneyFull(dcf.incomePv)],
                    [`Rent at exit (year ${input.dcf.holdYears + 1})`, `${formatMoneyFull(dcf.exitRent)} pa`],
                    ['PV of the sale', formatMoneyFull(dcf.exitPv)],
                    ['Value arising from the sale', formatPct(dcf.pvFromExit, 0)],
                    ['Net present value', formatMoneyFull(dcf.netPresentValue)],
                    ['Equated yield', formatPct(dcf.equatedYield, 2)],
                  ] as Array<[string, string]>).map(([k, v]) => (
                    <KvRow key={k} k={k} v={v} />
                  ))}
                </div>
              </>
            )}

            <PageFoot no={investmentPageNo} total={pageTotal} refCode={refCode} firmName={firmName} />
          </A4Page>
        )}

        {/* ===== DCF SENSITIVITY — continuation of section 4, only when a DCF exists ===== */}
        {dcfGrid && dcfBase && input.dcf && dcf && (
          <A4Page>
            <PageHead title={`${secInvestment} · DCF sensitivity`} scheme={scheme} />
            <p className="text-[13px] leading-[1.6]" style={{ marginTop: 18, color: '#3F463F' }}>
              Net present value re-computed across the two assumptions the DCF is least certain about: rental growth (rows)
              and the yield the investment is sold at (columns). Steps are percentage points — the units a yield is argued in
              — not proportions of the rate. The base case is outlined.
            </p>
            <div className="mt-5 border border-border-std rounded-[12px] overflow-hidden">
              <div className="flex bg-canvas fig text-[10px] font-semibold text-ink-2b">
                <div style={{ flex: 1.6, padding: '10px 14px' }}>Growth ↓ / exit yield →</div>
                {dcfGrid[0].map((c, ci) => (
                  <div key={ci} className="text-center" style={{ flex: 1, padding: '10px 6px' }}>
                    {c.exitYieldPct.toFixed(2)}%
                  </div>
                ))}
              </div>
              {dcfGrid.map((row, ri) => (
                <div key={ri} className="flex border-t border-border-faint">
                  {/* the rate itself, not a delta: a "+" here would read as
                      "4.5 points more growth" rather than "growth of 4.5%" */}
                  <div className="fig bg-sunken text-[11px] font-semibold text-ink-2b" style={{ flex: 1.6, padding: '12px 14px' }}>
                    {row[0].rentalGrowthPct < 0 ? '−' : ''}
                    {Math.abs(row[0].rentalGrowthPct)}% pa
                  </div>
                  {row.map((cell, ci) => (
                    <div
                      key={ci}
                      className="fig text-center text-[11px] font-semibold"
                      style={{
                        flex: 1,
                        padding: '12px 6px',
                        // shaded against the CENTRE cell, so the grid shows movement.
                        // Shading against the capitalisation instead made every cell
                        // identical on any scheme where the DCF clears it throughout —
                        // true, and useless to look at.
                        ...cellStyle(cell.netPresentValue, cell.ratio),
                        outline: cell.isBase ? `2px solid ${brand[700]}` : 'none',
                        outlineOffset: -2,
                        ...(cell.vsCapitalisation < 1 ? { color: '#B23A2E' } : null),
                      }}
                    >
                      {formatMoneyFull(cell.netPresentValue)}
                      {/* not colour alone: the dagger carries the same fact */}
                      {cell.vsCapitalisation < 1 && <span> †</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <SectionTitle>Reading the grid</SectionTitle>
            <p className="mt-2.5 text-[12px] text-ink-2b leading-[1.6]">
              Shading is relative to the base case, so the grid shows how far the value moves. At the stated{' '}
              {input.dcf.rentalGrowthPct}% growth and a {input.dcf.exitYieldPct}% exit the DCF returns{' '}
              {formatMoneyFull(dcf.netPresentValue)} — {formatPct(Math.abs(dcfBase.vsCapitalisation - 1), 1)}{' '}
              {dcfBase.vsCapitalisation >= 1 ? 'above' : 'below'} the capitalised {formatMoneyFull(R.investmentValue)} this
              appraisal reports. Softening the exit by {Math.abs(dcfGrid[0][dcfGrid[0].length - 1].yieldDelta)}{' '}
              {Math.abs(dcfGrid[0][dcfGrid[0].length - 1].yieldDelta) === 1 ? 'point' : 'points'} costs{' '}
              {formatMoneyFull(dcfBase.netPresentValue - dcfGrid[2][dcfGrid[2].length - 1].netPresentValue)}; losing{' '}
              {Math.abs(dcfGrid[dcfGrid.length - 1][0].growthDelta)}{' '}
              {Math.abs(dcfGrid[dcfGrid.length - 1][0].growthDelta) === 1 ? 'point' : 'points'} of growth costs{' '}
              {formatMoneyFull(dcfBase.netPresentValue - dcfGrid[dcfGrid.length - 1][2].netPresentValue)}.{' '}
              {dcfSubCap > 0
                ? `† marks the ${dcfSubCap} cell${dcfSubCap === 1 ? '' : 's'} where the growth-explicit view does not support the reported value.`
                : 'No cell in this range falls below the reported value.'}
            </p>
            <p className="mt-2 text-[11px] text-ink-3 leading-snug">
              Every cell runs the same discounted cashflow as the valuation itself, at the stated hold of{' '}
              {input.dcf.holdYears} years, {input.dcf.reviewCycleYears ?? 5}-yearly reviews and a{' '}
              {input.dcf.discountRatePct}% discount rate; only growth and the exit yield move.
            </p>
            <PageFoot no={dcfGridPageNo} total={pageTotal} refCode={refCode} firmName={firmName} />
          </A4Page>
        )}

        {/* ===== PAGE 5 — SENSITIVITY ===== */}
        <A4Page>
          <PageHead title={`${secSensitivity} · Sensitivity — profit on cost`} scheme={scheme} />
          <p className="text-[13px] leading-[1.6]" style={{ marginTop: 18, color: '#3F463F' }}>
            Return on cost re-computed across simultaneous movements in gross development value (columns) and construction cost (rows).
            The base case is outlined.
          </p>
          <div className="mt-5 border border-border-std rounded-[12px] overflow-hidden">
            <div className="flex bg-canvas fig text-[10px] font-semibold text-ink-2b">
              <div style={{ flex: 1.4, padding: '10px 14px' }}>Build ↓ / GDV →</div>
              {steps.map((s) => (
                <div key={s} className="text-center" style={{ flex: 1, padding: '10px 8px' }}>{deltaLabel(s)}</div>
              ))}
            </div>
            {sens.map((row, ri) => (
              <div key={ri} className="flex border-t border-border-faint">
                <div className="fig bg-sunken text-[11px] font-semibold text-ink-2b" style={{ flex: 1.4, padding: '12px 14px' }}>
                  {deltaLabel(steps.slice().reverse()[ri])}
                </div>
                {row.map((cell, ci) => (
                  <div
                    key={ci}
                    className="fig text-center text-[11.5px] font-semibold"
                    style={{ flex: 1, padding: '12px 8px', ...cellStyle(cell.value, cell.ratio), outline: cell.isBase ? `2px solid ${brand[700]}` : 'none', outlineOffset: -2 }}
                  >
                    {Math.round(cell.value * 100)}%
                  </div>
                ))}
              </div>
            ))}
          </div>

          <SectionTitle>Reading the grid</SectionTitle>
          <p className="mt-2.5 text-[12px] text-ink-2b leading-[1.6]">
            Each cell re-runs the full appraisal — including monthly finance — at the stated GDV and build-cost movements, holding the land
            price at the base-case figure. Green cells exceed the base return; amber cells fall materially below it; red cells are loss-making.
            A {deltaLabel(0.1)} build-cost overrun combined with a {deltaLabel(-0.1)} fall in GDV moves the return on cost from {Math.round(R.poc * 100)}% to {Math.round(sens[0][0].value * 100)}%.
          </p>
          <PageFoot no={sensitivityPageNo} total={pageTotal} refCode={refCode} firmName={firmName} />
        </A4Page>

        {/* ===== PAGES 6.. — CASHFLOW & RETURNS PROFILE ===== */}
        {cashChunks.map((chunk, pi) => (
          <A4Page key={pi}>
            <PageHead
              title={pi === 0 ? `${secCashflow} · Cashflow & returns profile` : `${secCashflow} · Cashflow ledger (${pi} of ${cashChunks.length - 1})`}
              scheme={scheme}
            />
            {pi === 0 && (
              <>
                <div style={{ marginTop: 18 }}>
                  <CashflowChart rows={cash.rows} peak={cash.peak} pcMonth={R.period} monthLabel={monthLabel} />
                </div>
                <SectionTitle>Profit bridge — GDV to developer profit</SectionTitle>
                <div style={{ marginTop: 8 }}>
                  <ProfitBridge
                    steps={[
                      ['Build', R.build],
                      ['Fees & cont.', R.fees + R.cont],
                      ['CIL · S106', R.otherTotal],
                      ['Finance', R.finance],
                      ['Sale costs', R.saleCosts],
                      ['Land', R.landGross],
                    ]}
                    profit={R.profit}
                  />
                </div>
                <div className="mt-2 flex items-center gap-5 text-[11px] text-ink-2">
                  <span className="ml-auto rounded-[9px] px-3 py-1.5 bg-tint-success text-[11.5px] font-semibold" style={{ color: brand[700] }}>
                    Peak debt <span className="fig">{formatMoneyFull(cash.peak)}</span> · month {cash.rows.reduce((best, r, i, arr) => (Math.abs(r.cum) > Math.abs(arr[best].cum) ? i : best), 0) + 1}
                  </span>
                </div>
              </>
            )}
            {chunk.length > 0 && (
            <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: pi === 0 ? 20 : 18 }}>
              <div className="flex bg-canvas fig text-[10px] font-semibold uppercase text-ink-2b" style={{ letterSpacing: '0.4px' }}>
                <div style={{ flex: 1.2, padding: '10px 14px' }}>Month</div>
                {['Cost', 'Interest', 'Revenue', 'Net', 'Cumulative'].map((h) => (
                  <div key={h} className="text-right" style={{ flex: 1, padding: '10px 14px' }}>{h}</div>
                ))}
              </div>
              {chunk.map((r) => (
                <div key={r.m} className="flex border-t border-border-faint fig text-[11.5px]" style={{ background: r.m % 2 === 0 ? neutral.sunken : neutral.surface }}>
                  <div style={{ flex: 1.2, padding: '8px 14px' }}>{monthLabel(r.m)}</div>
                  <div className="text-right" style={{ flex: 1, padding: '8px 14px' }}>{r.cost ? fM(r.cost) : '—'}</div>
                  <div className="text-right" style={{ flex: 1, padding: '8px 14px' }}>{r.intr ? fM(r.intr) : '—'}</div>
                  <div className="text-right" style={{ flex: 1, padding: '8px 14px' }}>{r.rev ? fM(r.rev) : '—'}</div>
                  <div className="text-right" style={{ flex: 1, padding: '8px 14px', color: r.net < 0 ? '#B23A2E' : brand[500] }}>{fM(r.net)}</div>
                  <div className="text-right font-medium" style={{ flex: 1, padding: '8px 14px', color: r.cum < 0 ? '#B23A2E' : neutral.ink }}>{fM(r.cum)}</div>
                </div>
              ))}
            </div>
            )}
            <PageFoot no={cashStartPageNo + pi} total={pageTotal} refCode={refCode} firmName={firmName} />
          </A4Page>
        ))}

        {/* ===== PAGE — KEY ASSUMPTIONS, NOTICE & SIGNATURE ===== */}
        <A4Page>
          <PageHead title={`${secAssumptions} · Key assumptions`} scheme={scheme} />
          <div className="grid grid-cols-2" style={{ marginTop: 18, gap: '0 40px' }}>
            {assumptions.map(([k, v]) => (
              <KvRow key={k} k={k} v={v} />
            ))}
          </div>

          {/* AI-use disclosure — RICS professional standards require transparency
              about whether and how AI was used; the register comes from the audit trail. */}
          <SectionTitle>{secAi} · Use of artificial intelligence</SectionTitle>
          {ai?.used ? (
            <>
              <p className="mt-3 text-[11px] text-ink-2b leading-[1.6]">
                Artificial intelligence was used in preparing this appraisal
                {ai.model && ai.model !== 'demo' ? ` (model: ${ai.model})` : ''}:{' '}
                {ai.items.map((t, i) => (
                  <span key={t.key}>
                    {i > 0 ? ' ' : ''}
                    <b className="font-semibold">{t.label}</b> — {t.purpose}
                  </span>
                ))}
              </p>
              <p className="mt-2 text-[11px] text-ink-2b leading-[1.6]">{ai.statement}</p>
              {ai.firmPolicy && <p className="mt-2 text-[11px] text-ink-2b leading-[1.6]">{ai.firmPolicy}</p>}
            </>
          ) : (
            <>
              <p className="mt-3 text-[11px] text-ink-2b leading-[1.6]">
                {ai?.statement ?? 'No artificial intelligence was used in the preparation of this appraisal.'}
              </p>
              {ai?.firmPolicy && <p className="mt-2 text-[11px] text-ink-2b leading-[1.6]">{ai.firmPolicy}</p>}
            </>
          )}

          <SectionTitle>{secNotice} · Important notice</SectionTitle>
          <p className="mt-3 text-[11px] text-ink-2b leading-[1.6]">{DISCLAIMER}</p>

          <div className="mt-8 flex gap-10">
            <div className="flex-1">
              <div className="h-px mb-2" style={{ background: neutral.crumb }} />
              <div className="text-[12px] font-medium">{deal?.owner?.name ?? 'D. Whitlock'} MRICS</div>
              <div className="text-[11px] text-ink-3">For and on behalf of {org?.name ?? 'Apex Appraise'}</div>
            </div>
            <div className="flex-1">
              <div className="h-px mb-2" style={{ background: neutral.crumb }} />
              <div className="text-[12px] font-medium">Date</div>
              <div className="text-[11px] text-ink-3">{today}</div>
            </div>
          </div>
          <PageFoot no={assumptionsPageNo} total={pageTotal} refCode={refCode} firmName={firmName} />
        </A4Page>

        {/* ===== PAGE — CONSTRUCTION MONITORING (only when photos exist) ===== */}
        {monitoring.length > 0 && (
          <A4Page>
            <PageHead title={`${secMonitoring} · Construction monitoring`} scheme={scheme} />
            <p className="text-[13px] leading-[1.6]" style={{ marginTop: 18, color: '#3F463F' }}>
              Progress record from the live construction log — the latest site photograph for each recent week, evidencing build progress
              against the appraised programme.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-5">
              {monitoring.map((ph, i) => (
                <div key={ph.id} className="border border-border-std rounded-[12px] overflow-hidden">
                  <div className="flex items-center justify-between bg-sunken border-b border-border-faint" style={{ padding: '10px 13px' }}>
                    <span className="fig text-[11px] font-semibold uppercase" style={{ letterSpacing: '0.4px', color: brand[700] }}>
                      w/c {fmtShort(ph.weekCommencing)}
                    </span>
                    <span className="fig text-[10px] font-medium text-ink-3">{fmtShort(ph.takenAt)}</span>
                  </div>
                  <div className="flex items-end p-2.5" style={{ height: 180, background: PHOTO_GRADS[i % PHOTO_GRADS.length] }}>
                    <span className="label-mono" style={{ color: 'rgba(255,255,255,0.75)' }}>Site photo</span>
                  </div>
                  <div style={{ padding: '11px 13px' }}>
                    <div className="text-[12.5px] font-semibold truncate">{ph.caption}</div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="w-[13px] h-[13px] rounded-[4px] inline-block shrink-0" style={{ background: gradOf(ph.contractorId) }} />
                      <span className="text-[10.5px] text-ink-3 truncate">{ph.contractor ?? 'No contractor'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <PageFoot no={monitoringPageNo} total={pageTotal} refCode={refCode} firmName={firmName} />
          </A4Page>
        )}
      </div>
    </div>
  );
}
