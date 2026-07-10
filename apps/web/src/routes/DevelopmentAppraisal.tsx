import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  computeAppraisal,
  jvWaterfall,
  monteCarlo,
  sensitivityGrid,
  formatPct,
  formatSigned,
  type AppraisalInput,
} from '@apex/appraisal-engine';
import { trpc } from '../lib/trpc';
import { fM, n0 } from '../lib/format';
import { exportAppraisalXlsx } from '../lib/exportXlsx';
import { useToast } from '../components/Toast';
import { Avatar, Button, Dot, Drawer, Panel, SegmentedToggle, Spinner, StatCard, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';

const TABS: Array<[string, string]> = [
  ['general', 'General'],
  ['revenue', 'Revenue'],
  ['build', 'Build'],
  ['other', 'Other Costs'],
  ['finance', 'Finance'],
  ['site', 'Site Purchase'],
  ['cashflow', 'Cashflow'],
  ['returns', 'Returns'],
];

const ASPECT: Record<string, string> = {
  general: 'Site visit', revenue: 'Comparables', build: 'Cost plan', other: 'Planning',
  finance: 'Finance', site: 'Site purchase', cashflow: 'Cashflow', returns: 'Returns',
};

const PRESETS: Record<string, number[]> = {
  industrial: [14, 24, 16, 10, 3, 5],
  trade: [18, 32, 22, 19, 9, 5],
  office: [20, 38, 30, 34, 18, 8],
};

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DEFAULT_INPUT: AppraisalInput = {
  units: [{ label: 'New unit type', count: 1, area: 1000, cap: 200 }],
  efficiency: 90,
  trades: [
    { label: 'Groundworks & substructure', rate: 18 },
    { label: 'Frame & superstructure', rate: 32 },
    { label: 'Envelope — roof & cladding', rate: 22 },
    { label: 'M&E services', rate: 19 },
    { label: 'Internal fit-out', rate: 9 },
    { label: 'Externals & landscaping', rate: 5 },
  ],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [{ label: 'Other costs', amount: 0 }],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 3, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 350000, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
  jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
  startYear: 2026,
  startMonth: 4,
};

function NumField({ label, value, onChange, suffix, step }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
  return (
    <label className="block">
      <span className="label-mono text-ink-3 block mb-1">{label}{suffix ? ` (${suffix})` : ''}</span>
      <input
        type="number"
        step={step ?? 'any'}
        className="w-full fig"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}

export default function DevelopmentAppraisal() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: saved, isLoading } = trpc.appraisal.getCurrent.useQuery(dealId, { enabled: !!dealId });
  const save = trpc.appraisal.save.useMutation({
    onSuccess: () => {
      utils.appraisal.getCurrent.invalidate(dealId);
      utils.deals.list.invalidate();
      setDirty(false);
    },
  });

  const toast = useToast();
  const [tab, setTab] = useState('revenue');
  const [sensTab, setSensTab] = useState<'roc' | 'profit' | 'residual'>('roc');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');
  const { data: versions } = trpc.appraisal.versions.useQuery(dealId, { enabled: !!dealId });
  const restore = trpc.appraisal.restore.useMutation({
    onSuccess: () => {
      toast.success('Version restored as the new current appraisal');
      setLoaded(false); // re-hydrate the form from the restored version
      utils.appraisal.getCurrent.invalidate(dealId);
      utils.appraisal.versions.invalidate(dealId);
      utils.deals.list.invalidate();
    },
  });
  const saveVersion = trpc.appraisal.save.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(`Saved version “${vars.label || 'new version'}”`);
      setVersionLabel('');
      setDirty(false);
      utils.appraisal.getCurrent.invalidate(dealId);
      utils.appraisal.versions.invalidate(dealId);
      utils.deals.list.invalidate();
    },
  });
  const [input, setInput] = useState<AppraisalInput>(DEFAULT_INPUT);
  const [mezz, setMezz] = useState({ mezzTo: 72, mezzRate: 12, drawFactor: 55 });
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (saved && !loaded) {
      setInput({ ...saved.input, jv: saved.input.jv ?? DEFAULT_INPUT.jv });
      setLoaded(true);
    }
    if (saved === null && !loaded) setLoaded(true);
  }, [saved, loaded]);

  const set = (patch: Partial<AppraisalInput>) => {
    setInput((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  // ---- ALL figures from the shared engine ----
  const R = useMemo(() => computeAppraisal(input, { withCash: true }), [input]);
  const jv = useMemo(
    () => jvWaterfall(R.equity, R.profit, R.holdYears, input.jv ?? DEFAULT_INPUT.jv!),
    [R, input.jv],
  );
  const sens = useMemo(() => sensitivityGrid(input, sensTab), [input, sensTab]);
  // Monte Carlo risk — land held at the base residual, sales/build shocked (seeded → stable UI)
  const risk = useMemo(() => monteCarlo(input, { iterations: 400, seed: 42 }), [input]);

  const isResidual = input.site.mode === 'residual';
  const viab = R.poc >= 0.17 ? { v: 'Viable', dot: '#7FE3B4', tone: '#1E7A55' } : R.poc >= 0.1 ? { v: 'Marginal', dot: '#F5C451', tone: '#9A6212' } : { v: 'Unviable', dot: '#F08A7C', tone: '#B23A2E' };

  const startY = input.startYear ?? 2026;
  const startM = input.startMonth ?? 0;
  const monthLabel = (idx: number) => {
    const tot = startM + (idx - 1);
    const y = startY + Math.floor(tot / 12);
    return `${MO[((tot % 12) + 12) % 12]} '${String(y % 100).padStart(2, '0')}`;
  };

  // capital stack (senior + mezz + equity) — display model per the prototype
  const stack = useMemo(() => {
    const ltc = input.finance.ltcPct;
    const mezzTo = Math.max(mezz.mezzTo, ltc);
    const constr = ltc > 0 ? R.facility / (ltc / 100) : R.build + R.fees + R.cont + R.otherTotal;
    const senior = (constr * ltc) / 100;
    const mezzAmt = (constr * (mezzTo - ltc)) / 100;
    const land = R.landGross;
    const equity = Math.max(0, constr * (1 - mezzTo / 100) + land);
    const total = senior + mezzAmt + equity || 1;
    const mo = (input.finance.periodMonths + input.finance.salesMonths) / 12;
    const draw = mezz.drawFactor / 100;
    const mezzInt = (mezzAmt * mezz.mezzRate) / 100 * mo * draw;
    const blended = senior + mezzAmt > 0 ? (senior * input.finance.ratePct + mezzAmt * mezz.mezzRate) / (senior + mezzAmt) : 0;
    return { senior, mezzAmt, equity, total, mezzInt, blended };
  }, [R, input.finance, mezz]);

  // ---- Tasks card (per-aspect, persisted) ----
  const aspect = ASPECT[tab];
  const { data: tasks } = trpc.tasks.list.useQuery({ dealId, aspect }, { enabled: !!dealId });
  const createTask = trpc.tasks.create.useMutation({ onSuccess: () => utils.tasks.list.invalidate() });
  const toggleTask = trpc.tasks.toggle.useMutation({ onSuccess: () => utils.tasks.list.invalidate() });
  const [newTask, setNewTask] = useState('');
  const [newWho, setNewWho] = useState('AO');

  const breakdown: Array<[string, number, boolean?]> = [
    ['Gross development value', R.gdv],
    ['Disposal costs', -R.saleCosts],
    ['Construction', -R.build],
    ['Professional fees', -R.fees],
    ['Contingency', -R.cont],
    ['Other costs', -R.otherTotal],
    ['Finance', -R.finance],
    ...(isResidual
      ? ([['Developer profit', -R.profit], ['Residual land value', R.residualNet, true]] as Array<[string, number, boolean?]>)
      : ([['Land (incl. acquisition)', -R.landGross], ['Developer profit', R.profit, true]] as Array<[string, number, boolean?]>)),
  ];

  const steps = [-0.1, -0.05, 0, 0.05, 0.1];
  const colLabel = (d: number) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d * 100) + '%';
  const cellStyle = (v: number, ratio: number) => {
    if (v <= 0) return { color: '#B23A2E', background: '#F9EAE7' };
    if (ratio >= 1.12) return { color: '#14503B', background: '#DFEFE7' };
    if (ratio >= 1.02) return { color: '#1E7A55', background: '#ECF3EF' };
    if (ratio > 0.98) return { color: '#5F665F', background: '#F4F4F0' };
    if (ratio > 0.85) return { color: '#9A6212', background: '#F8F0DE' };
    return { color: '#B23A2E', background: '#F9EAE7' };
  };
  const fmtMetric = (v: number) => (sensTab === 'roc' ? `${Math.round(v * 100)}%` : fM(v));

  const cash = R.cash!;
  const maxBar = Math.max(...cash.rows.map((r) => Math.max(r.cost, r.rev)), 1);

  if (isLoading || !loaded) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Development appraisal" />
        <div className="mt-16 flex justify-center"><Spinner /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-700">Pipeline</Link> / {deal?.name ?? 'Development appraisal'}
          </span>
        }
        right={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold" style={{ color: viab.tone }}>
              <Dot color={viab.dot} /> {viab.v} · RoC {formatPct(R.poc)}
            </span>
            <Button variant="secondary" onClick={() => setVersionsOpen(true)}>
              Versions{versions && versions.length > 1 ? ` · ${versions.length}` : ''}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                exportAppraisalXlsx({ dealName: deal?.name ?? 'Appraisal', address: deal?.address ?? '', input, R, jv, monthLabel })
              }
            >
              Export .xlsx
            </Button>
            <Button onClick={() => save.mutate({ dealId, input })} disabled={save.isPending || !dirty}>
              {save.isPending ? <Spinner /> : dirty ? 'Save appraisal' : 'Saved'}
            </Button>
          </>
        }
      />

      <DealNav dealId={dealId} active="appraisal" />
      <main className="max-w-[1640px] mx-auto px-6 pb-14">
        {/* metrics rail */}
        <div className="mt-5 flex gap-3 flex-wrap">
          <StatCard label="Project IRR" value={cash.projIrr == null ? 'N/A' : formatPct(cash.projIrr)} tone="#14503B" />
          <StatCard label="Equity IRR" value={cash.eqIrr == null ? 'N/A' : formatPct(cash.eqIrr)} tone="#14503B" />
          <StatCard label="Return on cost" value={formatPct(R.poc)} tone={viab.tone} />
          <StatCard label="Return on GDV" value={formatPct(R.rogdv)} />
          <StatCard label={isResidual ? 'Residual land' : 'Profit'} value={fM(isResidual ? R.residualNet : R.profit)} tone="#1E7A55" />
          <StatCard label="Peak debt" value={fM(R.facility)} />
          <StatCard label="GDV" value={fM(R.gdv)} />
        </div>

        <div className="mt-5 grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 330px' }}>
          <div>
            {/* tabs */}
            <nav className="flex gap-1 border-b border-border-strong overflow-x-auto">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className="px-3.5 py-2.5 text-[13.5px] whitespace-nowrap transition-colors"
                  style={{
                    borderBottom: `2px solid ${tab === k ? '#14503B' : 'transparent'}`,
                    color: tab === k ? '#16201B' : '#8A908A',
                    fontWeight: tab === k ? 600 : 500,
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="mt-4 flex flex-col gap-4">
              {tab === 'general' && (
                <Panel title="Scheme">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 text-[14px] font-semibold">{deal?.name}</div>
                    <div className="text-[12.5px] text-ink-2">{deal?.address}</div>
                    <div className="text-[12.5px]"><AssetBadge type={deal?.assetType} /></div>
                    <div className="col-span-2 text-[12px] text-ink-3">
                      Figures {deal?.figureStatus?.toLowerCase()} · probability {deal?.probability}% · stage {deal?.stage?.replace('_', ' / ').toLowerCase()}
                    </div>
                  </div>
                </Panel>
              )}

              {tab === 'revenue' && (
                <>
                  <Panel
                    title="Unit schedule"
                    right={<Button variant="secondary" onClick={() => set({ units: [...input.units, { label: 'New unit type', count: 1, area: 1000, cap: 200 }] })}>+ Add unit</Button>}
                  >
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="label-mono text-ink-3 text-left pb-2">Unit type</th>
                          <th className="label-mono text-ink-3 text-right pb-2 w-16">No.</th>
                          <th className="label-mono text-ink-3 text-right pb-2 w-24">Area ft²</th>
                          <th className="label-mono text-ink-3 text-right pb-2 w-24">£/ft²</th>
                          <th className="label-mono text-ink-3 text-right pb-2 w-24">Value</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {input.units.map((u, i) => (
                          <tr key={i}>
                            <td className="py-1.5 pr-2 border-t border-border-faint">
                              <input className="w-full" value={u.label} onChange={(e) => set({ units: input.units.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                            </td>
                            {(['count', 'area', 'cap'] as const).map((k) => (
                              <td key={k} className="py-1.5 px-1 border-t border-border-faint">
                                <input
                                  type="number"
                                  className="w-full text-right fig"
                                  value={u[k]}
                                  onChange={(e) => set({ units: input.units.map((x, j) => (j === i ? { ...x, [k]: parseFloat(e.target.value) || 0 } : x)) })}
                                />
                              </td>
                            ))}
                            <td className="fig text-right text-[12.5px] font-semibold border-t border-border-faint">{fM(u.count * u.area * u.cap)}</td>
                            <td className="text-right border-t border-border-faint">
                              <button className="text-ink-3 hover:text-status-red px-1" onClick={() => set({ units: input.units.filter((_, j) => j !== i) })}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-3 flex gap-6 border-t border-border-std pt-3">
                      <Kv k="NIA" v={`${n0(R.nia)} ft²`} />
                      <Kv k="GIA (via efficiency)" v={`${n0(R.gia)} ft²`} />
                      <Kv k="GDV" v={fM(R.gdv)} tone="#14503B" />
                    </div>
                  </Panel>
                  <Panel title="Efficiency & disposal">
                    <div className="grid grid-cols-3 gap-3">
                      <NumField label="NIA / GIA efficiency" suffix="%" value={input.efficiency} onChange={(v) => set({ efficiency: v })} />
                      <NumField label="Sales agent" suffix="%" value={input.disposal.agentPct} onChange={(v) => set({ disposal: { ...input.disposal, agentPct: v } })} />
                      <NumField label="Sales legal" suffix="%" value={input.disposal.legalPct} onChange={(v) => set({ disposal: { ...input.disposal, legalPct: v } })} />
                    </div>
                    <div className="mt-3 text-[12px] text-ink-2">Disposal costs <span className="fig font-semibold">{fM(R.saleCosts)}</span></div>
                  </Panel>
                </>
              )}

              {tab === 'build' && (
                <Panel
                  title="Trade-level build rates"
                  right={
                    <div className="flex gap-1.5">
                      {Object.keys(PRESETS).map((k) => (
                        <Button key={k} variant="secondary" onClick={() => set({ trades: input.trades.map((t, i) => ({ ...t, rate: PRESETS[k][i] ?? t.rate })) })}>
                          {k[0].toUpperCase() + k.slice(1)}
                        </Button>
                      ))}
                    </div>
                  }
                >
                  {input.trades.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5 border-t border-border-faint first:border-t-0">
                      <span className="flex-1 text-[12.5px]">{t.label}</span>
                      <input
                        type="number"
                        className="w-20 text-right fig"
                        value={t.rate}
                        onChange={(e) => set({ trades: input.trades.map((x, j) => (j === i ? { ...x, rate: parseFloat(e.target.value) || 0 } : x)) })}
                      />
                      <span className="fig w-20 text-right text-[12px] text-ink-2">{fM(t.rate * R.gia)}</span>
                    </div>
                  ))}
                  <div className="mt-3 border-t border-border-std pt-3 grid grid-cols-2 gap-3">
                    <NumField label="Professional fees" suffix="%" value={input.profFeePct} onChange={(v) => set({ profFeePct: v })} />
                    <NumField label="Contingency" suffix="%" value={input.contingencyPct} onChange={(v) => set({ contingencyPct: v })} />
                  </div>
                  <div className="mt-3 flex gap-6">
                    <Kv k="Build rate" v={`£${Math.round(R.buildRate)}/ft²`} tone="#14503B" />
                    <Kv k="All-in construction" v={fM(R.build + R.fees + R.cont)} />
                  </div>
                </Panel>
              )}

              {tab === 'other' && (
                <Panel
                  title="Other costs — S106, CIL, PM, surveys"
                  right={<Button variant="secondary" onClick={() => set({ otherCosts: [...input.otherCosts, { label: 'New cost', amount: 0 }] })}>+ Add cost</Button>}
                >
                  {input.otherCosts.map((o, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5 border-t border-border-faint first:border-t-0">
                      <input className="flex-1" value={o.label} onChange={(e) => set({ otherCosts: input.otherCosts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                      <input
                        type="number"
                        className="w-32 text-right fig"
                        value={o.amount}
                        onChange={(e) => set({ otherCosts: input.otherCosts.map((x, j) => (j === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x)) })}
                      />
                      <button className="text-ink-3 hover:text-status-red px-1" onClick={() => set({ otherCosts: input.otherCosts.filter((_, j) => j !== i) })}>×</button>
                    </div>
                  ))}
                  <div className="mt-3 border-t border-border-std pt-3">
                    <Kv k="Other costs total" v={fM(R.otherTotal)} tone="#14503B" />
                  </div>
                </Panel>
              )}

              {tab === 'finance' && (
                <>
                  <Panel title="Debt terms">
                    <div className="grid grid-cols-3 gap-3">
                      <NumField label="Loan to cost" suffix="%" value={input.finance.ltcPct} onChange={(v) => set({ finance: { ...input.finance, ltcPct: v } })} />
                      <NumField label="Interest rate" suffix="% pa" value={input.finance.ratePct} onChange={(v) => set({ finance: { ...input.finance, ratePct: v } })} />
                      <NumField label="Arrangement fee" suffix="%" value={input.finance.arrangementFeePct} onChange={(v) => set({ finance: { ...input.finance, arrangementFeePct: v } })} />
                      <NumField label="Build period" suffix="months" value={input.finance.periodMonths} onChange={(v) => set({ finance: { ...input.finance, periodMonths: v } })} />
                      <NumField label="Sales period" suffix="months" value={input.finance.salesMonths} onChange={(v) => set({ finance: { ...input.finance, salesMonths: v } })} />
                      <label className="block">
                        <span className="label-mono text-ink-3 block mb-1">Absorption (units/month — optional)</span>
                        <input
                          type="number"
                          step="any"
                          className="w-full fig"
                          placeholder="even spread"
                          value={input.finance.absorptionUnitsPerMonth ?? ''}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            set({ finance: { ...input.finance, absorptionUnitsPerMonth: Number.isFinite(v) && v > 0 ? v : undefined } });
                          }}
                        />
                        <span className="block mt-1 text-[10.5px] text-ink-3">
                          {input.finance.absorptionUnitsPerMonth
                            ? `Derived sales period: ${R.salesMonths} months (revenue lands as units sell)`
                            : 'Blank = even spread over the sales period'}
                        </span>
                      </label>
                      <NumField label="Mezzanine to" suffix="% of cost" value={mezz.mezzTo} onChange={(v) => setMezz({ ...mezz, mezzTo: v })} />
                      <NumField label="Mezzanine rate" suffix="% pa" value={mezz.mezzRate} onChange={(v) => setMezz({ ...mezz, mezzRate: v })} />
                      <NumField label="Avg drawn factor" suffix="%" value={mezz.drawFactor} onChange={(v) => setMezz({ ...mezz, drawFactor: v })} />
                    </div>
                    <div className="mt-3.5 flex gap-6 border-t border-border-std pt-3 flex-wrap">
                      <Kv k="Facility (peak)" v={fM(R.facility)} />
                      <Kv k="Rolled-up interest" v={fM(R.interest)} />
                      <Kv k="Finance total" v={fM(R.finance)} tone="#14503B" />
                      <Kv k="Equity" v={fM(R.equity)} />
                    </div>
                    <p className="mt-2 text-[11px] text-ink-3">Interest compounds monthly on the drawn balance; only the LTC share of each month's spend is drawn.</p>
                  </Panel>
                  <Panel title="Capital stack">
                    <div className="flex h-9 rounded-[9px] overflow-hidden border border-border-std">
                      <div style={{ width: `${(stack.senior / stack.total) * 100}%`, background: '#14503B' }} title="Senior" />
                      <div style={{ width: `${(stack.mezzAmt / stack.total) * 100}%`, background: '#C79A4B' }} title="Mezzanine" />
                      <div style={{ width: `${(stack.equity / stack.total) * 100}%`, background: '#AECBBC' }} title="Equity + land" />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <Kv k={`Senior · ${input.finance.ltcPct}% LTC`} v={fM(stack.senior)} dot="#14503B" />
                      <Kv k={`Mezz to ${Math.max(mezz.mezzTo, input.finance.ltcPct)}%`} v={stack.mezzAmt < 1 ? '—' : fM(stack.mezzAmt)} dot="#C79A4B" />
                      <Kv k="Equity + land" v={fM(stack.equity)} dot="#AECBBC" />
                    </div>
                    <div className="mt-2 flex gap-6">
                      <Kv k="Blended debt cost" v={`${stack.blended.toFixed(1)}%`} />
                      <Kv k="Mezz interest (approx)" v={stack.mezzAmt < 1 ? '—' : fM(stack.mezzInt)} />
                    </div>
                  </Panel>
                </>
              )}

              {tab === 'site' && (
                <Panel title="Site purchase basis">
                  <SegmentedToggle
                    options={[
                      ['residual', 'Residual — solve land at target profit'],
                      ['profit', 'Profit — fix land, read return'],
                    ]}
                    value={input.site.mode}
                    onChange={(m) => set({ site: { ...input.site, mode: m } })}
                  />
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {!isResidual && <NumField label="Fixed land price" suffix="£" value={input.site.landFixed} onChange={(v) => set({ site: { ...input.site, landFixed: v } })} />}
                    <NumField label="Acquisition costs" suffix="% — SDLT, legal, agent" value={input.site.acqPct} onChange={(v) => set({ site: { ...input.site, acqPct: v } })} />
                    {isResidual && <NumField label="Target profit on GDV" suffix="%" value={input.targetProfitOnGdvPct} onChange={(v) => set({ targetProfitOnGdvPct: v })} />}
                  </div>
                  <div className="mt-4 flex gap-6 flex-wrap border-t border-border-std pt-3">
                    <Kv k={isResidual ? 'Residual site value' : 'Land value (input)'} v={formatSigned(R.residualNet)} tone="#14503B" />
                    <Kv k="Land incl. acquisition" v={fM(R.landGross)} />
                    <Kv k="Land % of GDV" v={R.gdv > 0 ? formatPct(R.landGross / R.gdv) : '—'} />
                    <Kv k="Developer profit" v={fM(R.profit)} tone="#1E7A55" />
                  </div>
                </Panel>
              )}

              {tab === 'cashflow' && (
                <Panel
                  title="Monthly cashflow"
                  right={
                    <div className="flex items-center gap-3">
                      <SegmentedToggle
                        options={[['scurve', 'S-curve'], ['even', 'Even'], ['front', 'Front'], ['back', 'Back']]}
                        value={(input.finance.spendProfile ?? 'scurve') as never}
                        onChange={(p) => set({ finance: { ...input.finance, spendProfile: p } })}
                      />
                      <select value={startM} onChange={(e) => set({ startMonth: parseInt(e.target.value) })}>
                        {MONTHS_FULL.map((m, i) => (
                          <option key={m} value={i}>{m}</option>
                        ))}
                      </select>
                      <input type="number" className="w-20 fig" value={startY} onChange={(e) => set({ startYear: parseInt(e.target.value) || 2026 })} />
                    </div>
                  }
                >
                  {/* cost/revenue bars */}
                  <div className="flex items-end gap-[3px] h-28 border-b border-border-std pb-1">
                    {cash.rows.map((r) => (
                      <div key={r.m} className="flex-1 flex items-end gap-[2px] h-full" title={`${monthLabel(r.m)} · net ${formatSigned(r.net)}`}>
                        <div className="flex-1 rounded-t-[2px]" style={{ height: `${(r.cost / maxBar) * 100}%`, background: '#C7A95B' }} />
                        <div className="flex-1 rounded-t-[2px]" style={{ height: `${(r.rev / maxBar) * 100}%`, background: '#1E7A55' }} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[10.5px] fig text-ink-3">
                    <span>{monthLabel(1)}</span>
                    <span>PC {monthLabel(R.period)}</span>
                    <span>{monthLabel(cash.totalMonths)}</span>
                  </div>
                  <div className="mt-2 flex gap-5 text-[11px] text-ink-2">
                    <span className="inline-flex items-center gap-1.5"><Dot color="#C7A95B" /> Cost out</span>
                    <span className="inline-flex items-center gap-1.5"><Dot color="#1E7A55" /> Revenue</span>
                    <span className="ml-auto">Peak debt <b className="fig">{fM(cash.peak)}</b></span>
                  </div>
                  <div className="mt-4 max-h-[340px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-surface">
                        <tr>
                          {['Month', 'Cost', 'Interest', 'Revenue', 'Net', 'Cumulative'].map((h, i) => (
                            <th key={h} className={`label-mono text-ink-3 pb-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cash.rows.map((r) => (
                          <tr key={r.m} style={{ background: r.m % 2 === 0 ? '#FBFCFB' : '#fff' }}>
                            <td className="py-1.5 text-[12px] fig">{monthLabel(r.m)}</td>
                            <td className="py-1.5 text-right fig text-[12px]">{r.cost ? fM(r.cost) : '—'}</td>
                            <td className="py-1.5 text-right fig text-[12px]">{r.intr ? fM(r.intr) : '—'}</td>
                            <td className="py-1.5 text-right fig text-[12px]">{r.rev ? fM(r.rev) : '—'}</td>
                            <td className="py-1.5 text-right fig text-[12px]" style={{ color: r.net < 0 ? '#B23A2E' : '#1E7A55' }}>{formatSigned(r.net)}</td>
                            <td className="py-1.5 text-right fig text-[12px]" style={{ color: r.cum < 0 ? '#B23A2E' : '#16201B' }}>{formatSigned(r.cum)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}

              {tab === 'returns' && (
                <>
                  <Panel title="JV structure">
                    <div className="grid grid-cols-3 gap-3">
                      <NumField label="GP co-invest" suffix="% of equity" value={input.jv!.gpCoinvestPct} onChange={(v) => set({ jv: { ...input.jv!, gpCoinvestPct: v } })} />
                      <NumField label="Preferred return" suffix="% pa compounded" value={input.jv!.prefPct} onChange={(v) => set({ jv: { ...input.jv!, prefPct: v } })} />
                      <NumField label="Promote" suffix="% of residual" value={input.jv!.promotePct} onChange={(v) => set({ jv: { ...input.jv!, promotePct: v } })} />
                    </div>
                  </Panel>
                  <Panel title="Equity waterfall — four tiers">
                    {(
                      [
                        ['1 · Return of capital', fM(R.equity)],
                        [`2 · Preferred @ ${input.jv!.prefPct}% over ${jv.holdYears.toFixed(1)} yrs`, fM(jv.prefTotal)],
                        ['3 · Residual profit', fM(jv.residualProfit)],
                        [`4 · Promote @ ${input.jv!.promotePct}%`, fM(jv.promote)],
                      ] as Array<[string, string]>
                    ).map(([k, v]) => (
                      <div key={k} className="flex justify-between py-2 border-t border-border-faint first:border-t-0 text-[12.5px]">
                        <span className="text-ink-2">{k}</span>
                        <span className="fig font-semibold">{v}</span>
                      </div>
                    ))}
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {(
                        [
                          ['LP (investors)', jv.lp],
                          ['GP (developer)', jv.gp],
                        ] as Array<[string, typeof jv.lp]>
                      ).map(([label, p]) => (
                        <div key={label} className="rounded-card border border-border-strong p-4 bg-sunken">
                          <div className="label-mono text-ink-3">{label}</div>
                          <div className="fig mt-1.5 text-[19px] font-semibold tracking-[-0.5px]">{fM(p.total)}</div>
                          <div className="mt-2 flex flex-col gap-1 text-[11.5px] text-ink-2">
                            <span>Equity <b className="fig">{fM(p.equity)}</b></span>
                            <span>Profit share <b className="fig">{fM(p.profit)}</b></span>
                            <span>MOIC <b className="fig">{p.moic.toFixed(2)}×</b> · IRR <b className="fig">{p.irr == null ? 'N/A' : formatPct(p.irr)}</b></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </>
              )}
            </div>
          </div>

          {/* right rail: result summary + breakdown + sensitivity + tasks */}
          <aside className="flex flex-col gap-4">
            <Panel
              title={
                <div>
                  <div className="label-mono text-ink-3">{isResidual ? 'Residual land value' : 'Fixed land price → profit'}</div>
                  <div className="fig text-[24px] font-semibold tracking-[-1px] text-brand-700">{formatSigned(isResidual ? R.residualNet : R.profit)}</div>
                </div>
              }
              right={<Dot color={viab.dot} size={10} />}
            >
              {breakdown.map(([label, val, final]) => (
                <div key={label} className={`flex justify-between py-[7px] border-t ${final ? 'border-border-std' : 'border-[#F4F4F0]'} first:border-t-0`}>
                  <span className={final ? 'text-[13px] font-bold text-brand-700' : 'text-[12px] text-ink-2'}>{label}</span>
                  <span className="fig" style={{ fontWeight: final ? 700 : 500, fontSize: final ? 14 : 12, color: final ? '#14503B' : val < 0 ? '#B23A2E' : '#16201B' }}>
                    {formatSigned(val)}
                  </span>
                </div>
              ))}
              <div className="mt-2 pt-2 border-t border-border-std flex justify-between text-[12px] text-ink-2">
                <span>Total cost</span>
                <span className="fig font-semibold">{fM(R.totalCost)}</span>
              </div>
            </Panel>

            <Panel
              title="Sensitivity — GDV × build"
              right={
                <SegmentedToggle
                  options={[['roc', 'RoC'], ['profit', 'Profit'], ['residual', 'Residual']]}
                  value={sensTab}
                  onChange={setSensTab}
                />
              }
            >
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="label-mono text-ink-3 text-left pb-1.5">Build ↓</th>
                    {steps.map((s) => (
                      <th key={s} className="label-mono text-ink-3 text-right pb-1.5">{colLabel(s)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sens.map((row, ri) => (
                    <tr key={ri}>
                      <td className="fig text-[10.5px] text-ink-3 py-[3px]">{colLabel(steps.slice().reverse()[ri])}</td>
                      {row.map((cell, ci) => (
                        <td key={ci} className="p-[2px]">
                          <div
                            className="fig rounded-[5px] px-1 py-[5px] text-right text-[10.5px] font-medium"
                            style={{ ...cellStyle(cell.value, cell.ratio), outline: cell.isBase ? '2px solid #14503B' : 'none' }}
                          >
                            {fmtMetric(cell.value)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1.5 text-[10.5px] text-ink-3">Columns: GDV. Rows: build cost. Base cell outlined.</div>
            </Panel>

            <Panel
              title="Risk — Monte Carlo"
              right={<span className="fig text-[10.5px] text-ink-3">{risk.iterations} runs · land held at {fM(risk.landFixed)}</span>}
            >
              {(() => {
                const lo = Math.min(risk.profit.p10, 0);
                const hi = Math.max(risk.profit.p90, 1);
                const posOf = (v: number) => ((v - lo) / (hi - lo)) * 100;
                return (
                  <>
                    <div className="relative h-[26px] rounded-[7px] bg-sunken-2 overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0"
                        style={{ left: `${posOf(risk.profit.p10)}%`, width: `${posOf(risk.profit.p90) - posOf(risk.profit.p10)}%`, background: '#DFEFE7' }}
                      />
                      <div className="absolute top-0 bottom-0 w-[3px] rounded" style={{ left: `${posOf(risk.profit.p50)}%`, background: '#14503B' }} />
                      {lo < 0 && <div className="absolute top-0 bottom-0 w-px" style={{ left: `${posOf(0)}%`, background: '#B23A2E' }} />}
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10.5px] fig text-ink-3">
                      <span>P10 {fM(risk.profit.p10)}</span>
                      <span className="font-semibold text-brand-700">P50 {fM(risk.profit.p50)}</span>
                      <span>P90 {fM(risk.profit.p90)}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <div className="rounded-[10px] bg-tint-success px-3 py-2.5">
                        <div className="label-mono text-ink-3">Prob ≥ target profit</div>
                        <div className="fig text-[16px] font-semibold text-brand-500">{Math.round(risk.probAtTarget * 100)}%</div>
                      </div>
                      <div className="rounded-[10px] px-3 py-2.5" style={{ background: risk.probLoss > 0.1 ? '#F9EAE7' : '#F0EFE9' }}>
                        <div className="label-mono text-ink-3">Prob of loss</div>
                        <div className="fig text-[16px] font-semibold" style={{ color: risk.probLoss > 0.1 ? '#B23A2E' : '#6E7269' }}>
                          {Math.round(risk.probLoss * 100)}%
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-[10.5px] text-ink-3 leading-snug">
                      Sales ±7.5% / build ±5% (1σ, normal). PoC band {formatPct(risk.poc.p10)}–{formatPct(risk.poc.p90)}.
                    </div>
                  </>
                );
              })()}
            </Panel>

            <Panel title={`Tasks — ${aspect}`} right={<span className="fig text-[11px] text-ink-3">{tasks?.filter((t) => !t.done).length ?? 0} open</span>}>
              <div className="flex flex-col gap-1.5">
                {(tasks ?? []).map((t) => (
                  <button key={t.id} className="flex items-center gap-2.5 py-1 text-left group" onClick={() => toggleTask.mutate(t.id)}>
                    <span
                      className="w-[16px] h-[16px] rounded-[5px] border inline-flex items-center justify-center shrink-0"
                      style={{ background: t.done ? '#14503B' : '#fff', borderColor: t.done ? '#14503B' : '#D2D1CA' }}
                    >
                      {t.done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2"><path d="M4 12l5 5L20 7" /></svg>}
                    </span>
                    <span className="flex-1 text-[12px]" style={{ color: t.done ? '#B6B5AD' : '#16201B', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
                    <Avatar initials={t.assignee} size={20} />
                  </button>
                ))}
                {(tasks ?? []).length === 0 && <div className="text-[11.5px] text-ink-3b py-2">No tasks for this aspect yet.</div>}
              </div>
              <div className="mt-2.5 flex gap-1.5">
                <input
                  className="flex-1"
                  placeholder={`Add ${aspect.toLowerCase()} task…`}
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTask.trim()) {
                      createTask.mutate({ dealId, title: newTask.trim(), aspect, assignee: newWho });
                      setNewTask('');
                    }
                  }}
                />
                {['AO', 'DW', 'MV', 'PA'].map((w) => (
                  <button key={w} onClick={() => setNewWho(w)} className="rounded-full" style={{ outline: newWho === w ? '2px solid #14503B' : 'none', outlineOffset: 1 }}>
                    <Avatar initials={w} size={24} />
                  </button>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </main>

      {/* version history — every figure stays traceable */}
      <Drawer open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Appraisal versions" width={520}>
        <div className="flex gap-2 mb-4">
          <input
            className="flex-1"
            placeholder="Label this version — e.g. “Post-tender build rates”"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && versionLabel.trim()) saveVersion.mutate({ dealId, input, asNewVersion: true, label: versionLabel.trim() });
            }}
          />
          <Button
            disabled={!versionLabel.trim() || saveVersion.isPending}
            onClick={() => saveVersion.mutate({ dealId, input, asNewVersion: true, label: versionLabel.trim() })}
          >
            {saveVersion.isPending ? <Spinner /> : 'Save as version'}
          </Button>
        </div>
        <div className="flex flex-col gap-2.5">
          {(versions ?? []).map((v) => {
            const cur = versions?.find((x) => x.isCurrent)?.headline;
            const d = v.headline && cur && !v.isCurrent ? v.headline.residualNet - cur.residualNet : null;
            return (
              <div key={v.id} className="rounded-card border border-border-strong p-3.5" style={v.isCurrent ? { borderColor: '#14503B', background: '#FBFCFB' } : undefined}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{v.label}</span>
                  {v.isCurrent && <span className="label-mono rounded-[6px] bg-tint-success text-brand-700 px-1.5 py-[2px]">CURRENT</span>}
                  <span className="label-mono text-ink-3">{v.source}</span>
                  <span className="fig ml-auto text-[10.5px] text-ink-3">
                    {new Date(v.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{' '}
                    {new Date(v.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {v.headline && (
                  <div className="mt-2 flex gap-5 flex-wrap">
                    <Kv k="GDV" v={fM(v.headline.gdv)} />
                    <Kv k="Residual" v={fM(v.headline.residualNet)} />
                    <Kv k="Profit" v={fM(v.headline.profit)} />
                    <Kv k="RoC" v={formatPct(v.headline.poc)} tone={v.headline.poc >= 0.17 ? '#1E7A55' : v.headline.poc >= 0.1 ? '#9A6212' : '#B23A2E'} />
                    {d != null && Math.round(d) !== 0 && (
                      <Kv k="Residual vs current" v={`${d > 0 ? '+' : '−'}${fM(Math.abs(d))}`} tone={d > 0 ? '#1E7A55' : '#B23A2E'} />
                    )}
                  </div>
                )}
                {!v.isCurrent && (
                  <div className="mt-2.5">
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-[11.5px]"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate({ dealId, versionId: v.id })}
                    >
                      Restore as current
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {(versions ?? []).length === 0 && <div className="text-[12px] text-ink-3 py-4 text-center">No saved versions yet — save the appraisal first.</div>}
        </div>
        <div className="mt-4 text-[10.5px] text-ink-3 leading-relaxed">
          Restoring never rewrites history — the old version's inputs become a new current version, and the audit trail records who restored what.
        </div>
      </Drawer>
    </div>
  );
}

function Kv({ k, v, tone, dot }: { k: string; v: string; tone?: string; dot?: string }) {
  return (
    <div>
      <div className="label-mono text-ink-3 flex items-center gap-1.5">{dot && <Dot color={dot} size={7} />}{k}</div>
      <div className="fig mt-0.5 text-[14px] font-semibold" style={tone ? { color: tone } : undefined}>{v}</div>
    </div>
  );
}

function AssetBadge({ type }: { type?: string }) {
  if (!type) return null;
  return <span className="text-[12.5px] text-ink-2">{type.replace('_', ' / ').toLowerCase()}</span>;
}
