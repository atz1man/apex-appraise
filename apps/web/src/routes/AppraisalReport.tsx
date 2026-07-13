import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { computeAppraisal, sensitivityGrid, formatMoneyFull, formatPct } from '@apex/appraisal-engine';
import { accent, brand, neutral } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { fM, n0 } from '../lib/format';
import { BrandMark, Button, Spinner } from '../components/ui';
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
        minHeight: 1123,
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

function PageFoot({ no, total, refCode }: { no: number; total: number; refCode: string }) {
  return (
    <div className="mt-auto pt-6">
      <div className="flex items-center justify-between pt-2.5 text-[9.5px] text-ink-3" style={{ borderTop: '1px solid #ECEBE5' }}>
        <span>
          <span className="font-semibold" style={{ color: brand[700] }}>Apex</span> Appraise · development appraisal
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

  const input = appr?.input;

  // All figures from the shared engine — never hand-rolled.
  const R = useMemo(() => (input ? computeAppraisal(input, { withCash: true }) : null), [input]);
  const sens = useMemo(() => (input ? sensitivityGrid(input, 'roc') : null), [input]);

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

  const refCode = `AP-${dealId.slice(0, 4).toUpperCase()}`;
  const today = fmtLong(new Date());
  const scheme = deal?.name ?? 'Development appraisal';

  const toolbar = (
    <div className="no-print sticky top-0 z-40 h-[54px] bg-surface border-b border-border-strong flex items-center gap-3.5 px-5">
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
    if (ratio > 0.85) return { color: '#9A6212', background: '#F8F0DE' };
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

  // Page numbering: 1 cover · 2 summary · 3 accommodation · 4 appraisal · 5 sensitivity · 6.. cashflow · assumptions · monitoring.
  const assumptionsPageNo = 5 + cashChunks.length + 1;
  const monitoringPageNo = assumptionsPageNo + 1;
  const pageTotal = monitoring.length > 0 ? monitoringPageNo : assumptionsPageNo;

  const unitRows = input.units.map((u) => ({
    label: u.label,
    count: u.count,
    area: u.count * u.area,
    rate: u.cap,
    value: u.count * u.area * u.cap,
  }));

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
              <BrandMark size={38} />
              <span className="text-[19px] font-bold tracking-[-0.3px]">Apex Appraise</span>
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
            <span>Apex Appraise · {today}</span>
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
          <PageFoot no={2} total={pageTotal} refCode={refCode} />
        </A4Page>

        {/* ===== PAGE 3 — ACCOMMODATION SCHEDULE ===== */}
        <A4Page>
          <PageHead title="2 · Accommodation schedule" scheme={scheme} />
          <div className="border border-border-std rounded-[12px] overflow-hidden" style={{ marginTop: 18 }}>
            <div className="flex text-white fig text-[10px] font-semibold uppercase" style={{ background: brand[700], letterSpacing: '0.4px' }}>
              <div style={{ flex: 2.4, padding: '11px 14px' }}>Use / unit</div>
              <div className="text-right" style={{ flex: 0.8, padding: '11px 14px' }}>No.</div>
              <div className="text-right" style={{ flex: 1.1, padding: '11px 14px' }}>Area ft²</div>
              <div className="text-right" style={{ flex: 1, padding: '11px 14px' }}>£/ft²</div>
              <div className="text-right" style={{ flex: 1.3, padding: '11px 14px' }}>Value</div>
            </div>
            {unitRows.map((u, i) => (
              <div key={i} className="flex border-t border-border-faint fig text-[12px] font-medium">
                <div className="font-ui text-[12.5px]" style={{ flex: 2.4, padding: '10px 14px' }}>{u.label}</div>
                <div className="text-right" style={{ flex: 0.8, padding: '10px 14px' }}>{u.count}</div>
                <div className="text-right" style={{ flex: 1.1, padding: '10px 14px' }}>{n0(u.area)}</div>
                <div className="text-right" style={{ flex: 1, padding: '10px 14px' }}>£{n0(u.rate)}</div>
                <div className="text-right font-semibold" style={{ flex: 1.3, padding: '10px 14px', color: brand[700] }}>{formatMoneyFull(u.value)}</div>
              </div>
            ))}
            <div className="flex bg-sunken fig text-[12.5px] font-semibold" style={{ borderTop: `2px solid ${neutral.border}` }}>
              <div className="font-ui" style={{ flex: 2.4, padding: '11px 14px' }}>Gross development value</div>
              <div style={{ flex: 0.8 }} />
              <div className="text-right" style={{ flex: 1.1, padding: '11px 14px' }}>{n0(R.nia)}</div>
              <div style={{ flex: 1 }} />
              <div className="text-right" style={{ flex: 1.3, padding: '11px 14px', color: brand[700] }}>{formatMoneyFull(R.gdv)}</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            <Kpi label="Net internal area" value={`${n0(R.nia)} ft²`} />
            <Kpi label="Gross internal area" value={`${n0(R.gia)} ft²`} />
            <Kpi label="Efficiency (NIA:GIA)" value={`${input.efficiency}%`} />
          </div>

          <SectionTitle>Basis of areas</SectionTitle>
          <p className="mt-2.5 text-[12px] text-ink-2b leading-[1.6]">
            Unit areas are net internal areas (NIA) in square feet as scheduled in the current appraisal. Gross internal area is derived
            at the stated NIA:GIA efficiency of {input.efficiency}%. Capital values are applied per square foot of NIA; construction costs
            are applied per square foot of GIA.
          </p>
          <PageFoot no={3} total={pageTotal} refCode={refCode} />
        </A4Page>

        {/* ===== PAGE 4 — RESIDUAL APPRAISAL ===== */}
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
          <PageFoot no={4} total={pageTotal} refCode={refCode} />
        </A4Page>

        {/* ===== PAGE 5 — SENSITIVITY ===== */}
        <A4Page>
          <PageHead title="4 · Sensitivity — profit on cost" scheme={scheme} />
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
          <PageFoot no={5} total={pageTotal} refCode={refCode} />
        </A4Page>

        {/* ===== PAGES 6.. — CASHFLOW & RETURNS PROFILE ===== */}
        {cashChunks.map((chunk, pi) => (
          <A4Page key={pi}>
            <PageHead
              title={pi === 0 ? '5 · Cashflow & returns profile' : `5 · Cashflow ledger (${pi} of ${cashChunks.length - 1})`}
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
            <PageFoot no={6 + pi} total={pageTotal} refCode={refCode} />
          </A4Page>
        ))}

        {/* ===== PAGE — KEY ASSUMPTIONS, NOTICE & SIGNATURE ===== */}
        <A4Page>
          <PageHead title="6 · Key assumptions" scheme={scheme} />
          <div className="grid grid-cols-2" style={{ marginTop: 18, gap: '0 40px' }}>
            {assumptions.map(([k, v]) => (
              <KvRow key={k} k={k} v={v} />
            ))}
          </div>

          <SectionTitle>7 · Important notice</SectionTitle>
          <p className="mt-3 text-[11px] text-ink-2b leading-[1.6]">{DISCLAIMER}</p>

          <div className="mt-8 flex gap-10">
            <div className="flex-1">
              <div className="h-px mb-2" style={{ background: neutral.crumb }} />
              <div className="text-[12px] font-medium">{deal?.owner?.name ?? 'D. Whitlock'} MRICS</div>
              <div className="text-[11px] text-ink-3">For and on behalf of Apex Appraise</div>
            </div>
            <div className="flex-1">
              <div className="h-px mb-2" style={{ background: neutral.crumb }} />
              <div className="text-[12px] font-medium">Date</div>
              <div className="text-[11px] text-ink-3">{today}</div>
            </div>
          </div>
          <PageFoot no={assumptionsPageNo} total={pageTotal} refCode={refCode} />
        </A4Page>

        {/* ===== PAGE — CONSTRUCTION MONITORING (only when photos exist) ===== */}
        {monitoring.length > 0 && (
          <A4Page>
            <PageHead title="8 · Construction monitoring" scheme={scheme} />
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
            <PageFoot no={monitoringPageNo} total={pageTotal} refCode={refCode} />
          </A4Page>
        )}
      </div>
    </div>
  );
}
