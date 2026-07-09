import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { status as statusTokens, neutral, brand, type StatusKey } from '@apex/ui-tokens';
import { trpc } from '../lib/trpc';
import { fM, formatDelta, formatMoneyFull, formatPct, formatRent } from '../lib/format';
import { Button, Dot, Drawer, EmptyState, Panel, ProgressBar, SegmentedToggle, Spinner, StatCard, StatusChip, Td, Th, TopBar } from '../components/ui';

const MINUS = '−';

interface Def {
  id: string;
  label: string;
  key: StatusKey;
  prog: number;
}

const SALES_DEFS: Def[] = [
  { id: 'AVAILABLE', label: 'Available', key: 'neutral', prog: 0 },
  { id: 'RESERVED', label: 'Reserved', key: 'amber', prog: 1 },
  { id: 'EXCHANGED', label: 'Exchanged', key: 'blue', prog: 5 },
  { id: 'COMPLETED', label: 'Completed', key: 'green', prog: 6 },
  { id: 'HANDOVER', label: 'Handover', key: 'green', prog: 7 },
];
const LET_DEFS: Def[] = [
  { id: 'AVAILABLE', label: 'Available', key: 'neutral', prog: 0 },
  { id: 'APPLICATION', label: 'Applied', key: 'amber', prog: 2 },
  { id: 'REFERENCING', label: 'Referencing', key: 'blue', prog: 3 },
  { id: 'SIGNED', label: 'Signed', key: 'purple', prog: 4 },
  { id: 'OCCUPIED', label: 'Occupied', key: 'green', prog: 5 },
];

const SALES_MS = ['Reserved', 'Memorandum of sale', 'Searches ordered', 'Enquiries raised', 'Mortgage offer', 'Exchanged', 'Completed', 'Handover & snagging'];
const LET_MS = ['Enquiry', 'Viewing', 'Application', 'Referencing', 'Tenancy signed', 'Move-in'];

/** A normalised record — sales unit or tenancy — so both modes share one UI. */
interface Row {
  id: string;
  name: string;
  spec: string;
  level: number;
  appraised: number;
  agreed: number | null;
  status: string;
  party: string | null;
  solicitor: string | null;
  lead: string | null;
  incentive: string | null;
  deposit: number | null;
  date: Date | null;
  progress: number;
  stalled: boolean;
  arrears: number;
  msDates: Array<Date | null>;
}

interface Draft {
  name: string;
  spec: string;
  level: number;
  party: string;
  solicitor: string;
  appraised: number;
  agreed: number;
  lead: string;
  incentive: string;
  statusId: string;
  stalled: boolean;
}

const emptyDraft = (): Draft => ({ name: '', spec: '', level: 0, party: '', solicitor: '', appraised: 0, agreed: 0, lead: '', incentive: 'None', statusId: 'AVAILABLE', stalled: false });

const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtFull = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const rentDelta = (d: number) => (Math.round(d) === 0 ? '—' : `${d > 0 ? '+' : MINUS}£${Math.abs(Math.round(d)).toLocaleString('en-GB')}`);
const deltaTone = (d: number) => (d > 0 ? statusTokens.green.text : d < 0 ? statusTokens.red.text : neutral.ink3);

export default function SalesCrm() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<'sales' | 'lettings'>('sales');
  const [view, setView] = useState<'table' | 'plan'>('table');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null); // row id | 'new' | null
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const unitsQ = trpc.sales.units.useQuery(dealId, { enabled: !!dealId });
  const tenQ = trpc.sales.tenancies.useQuery(dealId, { enabled: !!dealId });

  const isRent = mode === 'lettings';
  const defs = isRent ? LET_DEFS : SALES_DEFS;
  const names: readonly string[] = isRent ? tenQ.data?.milestones ?? LET_MS : unitsQ.data?.milestones ?? SALES_MS;
  const maxProg = names.length - 1;

  const closeDrawer = () => {
    setSelected(null);
    setEditing(false);
    setDraft(null);
  };
  const afterSave = (id: string) => {
    setEditing(false);
    setDraft(null);
    setSelected(id);
  };

  const upsertUnit = trpc.sales.upsertUnit.useMutation({
    onSuccess: (rec) => {
      utils.sales.units.invalidate(dealId);
      afterSave(rec.id);
    },
  });
  const deleteUnit = trpc.sales.deleteUnit.useMutation({
    onSuccess: () => {
      utils.sales.units.invalidate(dealId);
      closeDrawer();
    },
  });
  const advanceUnit = trpc.sales.advanceMilestone.useMutation({ onSuccess: () => utils.sales.units.invalidate(dealId) });
  const upsertTenancy = trpc.sales.upsertTenancy.useMutation({
    onSuccess: (rec) => {
      utils.sales.tenancies.invalidate(dealId);
      afterSave(rec.id);
    },
  });
  const deleteTenancy = trpc.sales.deleteTenancy.useMutation({
    onSuccess: () => {
      utils.sales.tenancies.invalidate(dealId);
      closeDrawer();
    },
  });
  const advanceTenancy = trpc.sales.advanceTenancy.useMutation({ onSuccess: () => utils.sales.tenancies.invalidate(dealId) });

  const saving = upsertUnit.isPending || upsertTenancy.isPending;
  const advancing = advanceUnit.isPending || advanceTenancy.isPending;

  // ---- normalise rows ----
  const rows: Row[] = useMemo(() => {
    if (mode === 'sales') {
      return (unitsQ.data?.units ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        spec: u.spec,
        level: u.level,
        appraised: u.appraisedValue,
        agreed: u.agreedValue,
        status: u.status,
        party: u.buyerName,
        solicitor: u.buyerSolicitor,
        lead: u.leadSource,
        incentive: u.incentive,
        deposit: u.depositHeld,
        date: u.reservedAt,
        progress: u.progress,
        stalled: u.stalled,
        arrears: 0,
        msDates: u.milestones.map((m) => m.date),
      }));
    }
    return (tenQ.data?.tenancies ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      spec: t.spec,
      level: t.level,
      appraised: t.ervPcm,
      agreed: t.agreedRentPcm,
      status: t.status,
      party: t.tenantName,
      solicitor: null,
      lead: t.leadSource,
      incentive: t.incentive,
      deposit: t.progress > 0 && t.agreedRentPcm != null ? Math.round(((t.agreedRentPcm * 12) / 52) * 5) : null,
      date: t.appliedAt,
      progress: t.progress,
      stalled: t.stalled,
      arrears: t.arrears,
      msDates: [],
    }));
  }, [mode, unitsQ.data, tenQ.data]);

  const defOf = (status: string): Def => defs.find((d) => d.id === status) ?? defs[0];
  const money = (n: number) => (isRent ? formatRent(n) : fM(n));
  const delta = (d: number) => (isRent ? rentDelta(d) : formatDelta(d));

  const labels = isRent
    ? {
        tableTitle: 'Unit lettings tracker', party: 'Tenant', partySub: 'Lead source', solicitor: 'Referencing', price: 'ERV', agreed: 'Rent',
        dateLabel: 'Applied', partyBlock: 'Tenant & referencing', progTitle: 'Letting progression', forecastTitle: 'Rent roll forecast',
        forecastSub: 'pcm building', forecastTotal: 'Projected rent roll', healthTitle: 'Portfolio health', availTitle: 'Available to let',
        availCta: 'Take application', vacant: 'Vacant', doneCta: 'Move-in complete',
      }
    : {
        tableTitle: 'Unit sales tracker', party: 'Buyer', partySub: 'Solicitor', solicitor: 'Solicitor', price: 'Appraised', agreed: 'Agreed',
        dateLabel: 'Reserved', partyBlock: 'Buyer & conveyancing', progTitle: 'Sales progression', forecastTitle: 'Completion forecast',
        forecastSub: 'cash landing', forecastTotal: 'Forecast to complete', healthTitle: 'Pipeline health', availTitle: 'Available to reserve',
        availCta: 'Take reservation', vacant: 'Available', doneCta: 'Handed over',
      };

  // ---- rollups & derived panels ----
  const SR = unitsQ.data?.rollup;
  const LR = tenQ.data?.rollup;
  const secured = rows.filter((r) => r.status !== 'AVAILABLE').length;
  const stalledCount = rows.filter((r) => r.stalled).length;

  // Marketing funnel — derived per the prototype: reservations = secured count,
  // offers ≈ reservations + 3, viewings ≈ offers × 4, enquiries ≈ viewings × 2.
  const funnel = useMemo(() => {
    if (!isRent) {
      const reservations = secured;
      const offers = reservations > 0 ? reservations + 3 : 0;
      const viewings = offers * 4;
      const enquiries = viewings * 2;
      return [
        { label: 'Enquiries', count: enquiries, dot: statusTokens.neutral.dot },
        { label: 'Viewings', count: viewings, dot: statusTokens.amber.dot },
        { label: 'Offers', count: offers, dot: statusTokens.blue.dot },
        { label: 'Reservations', count: reservations, dot: brand[700] },
      ];
    }
    const tenancies = rows.filter((r) => r.status === 'OCCUPIED').length;
    const applications = secured > 0 ? secured + 3 : 0;
    const viewings = applications * 4;
    const enquiries = viewings * 2;
    return [
      { label: 'Enquiries', count: enquiries, dot: statusTokens.neutral.dot },
      { label: 'Viewings', count: viewings, dot: statusTokens.amber.dot },
      { label: 'Applications', count: applications, dot: statusTokens.blue.dot },
      { label: 'Tenancies', count: tenancies, dot: brand[700] },
    ];
  }, [isRent, rows, secured]);
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));
  const funnelConv =
    funnel[0].count > 0
      ? `${formatPct(funnel[3].count / funnel[0].count, 1)} enquiry → ${funnel[3].label.toLowerCase().replace(/s$/, '').replace(/ie$/, 'y')} · ${formatPct(
          funnel[1].count > 0 ? funnel[2].count / funnel[1].count : 0,
          0,
        )} viewing → ${funnel[2].label.toLowerCase().replace(/s$/, '')}`
      : 'No marketing activity yet.';

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() + 1 + i, 1));
  }, []);

  // Forecast — per the prototype: exchanged cash lands in the first two months,
  // reserved spreads over months 3–5; lettings builds a cumulative rent roll.
  const forecast = useMemo(() => {
    if (!isRent) {
      const fc = new Array<number>(6).fill(0);
      rows.forEach((r, idx) => {
        const v = r.agreed ?? 0;
        if (r.status === 'EXCHANGED') fc[idx % 2] += v;
        else if (r.status === 'RESERVED') fc[2 + (idx % 3)] += v;
      });
      return { bars: fc, total: fc.reduce((a, b) => a + b, 0), cumulative: false };
    }
    let roll = rows.filter((r) => r.status === 'OCCUPIED').reduce((a, r) => a + (r.agreed ?? 0), 0);
    const pending = rows.filter((r) => ['APPLICATION', 'REFERENCING', 'SIGNED'].includes(r.status)).sort((a, b) => b.progress - a.progress);
    const fc = months.map((_, i) => {
      if (i < pending.length) roll += pending[i].agreed ?? pending[i].appraised;
      return roll;
    });
    return { bars: fc, total: roll, cumulative: true };
  }, [isRent, rows, months]);
  const fcMax = Math.max(1, ...forecast.bars);

  const health: Array<[string, string, string]> = isRent
    ? [
        ['Avg apply → move-in', '24 days', neutral.ink],
        ['Void rate', LR ? formatPct(LR.voidRate, 0) : '—', neutral.ink],
        ['Arrears', LR ? formatMoneyFull(LR.arrears) : '—', LR && LR.arrears > 0 ? statusTokens.red.text : statusTokens.green.text],
      ]
    : [
        ['Avg reserve → exchange', '47 days', neutral.ink],
        ['Fall-through rate', '0%', neutral.ink],
        ['Stalled sales', String(stalledCount), stalledCount > 0 ? statusTokens.red.text : statusTokens.green.text],
      ];

  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  const levels = useMemo(() => [...new Set(rows.map((r) => r.level))].sort((a, b) => b - a), [rows]);
  const levelLabel = (l: number) => (l === 0 ? 'Ground' : `Level ${l}`);

  const headline = isRent
    ? LR && LR.total > 0
      ? `${Math.round((LR.occupied / LR.total) * 100)}% let`
      : null
    : SR && SR.gdvAppraised > 0
      ? `${Math.round((SR.gdvRealised / SR.gdvAppraised) * 100)}% of GDV realised`
      : null;

  // ---- drawer ----
  const sel = selected && selected !== 'new' ? rows.find((r) => r.id === selected) ?? null : null;
  const drawerOpen = selected === 'new' || !!sel;
  const selDef = sel ? defOf(sel.status) : null;
  const selDelta = sel && sel.agreed != null && sel.agreed > 0 ? sel.agreed - sel.appraised : 0;

  const openRow = (id: string) => {
    setSelected(id);
    setEditing(false);
    setDraft(null);
  };
  const openCreate = () => {
    setSelected('new');
    setEditing(true);
    setDraft(emptyDraft());
  };
  const openEdit = () => {
    if (!sel) return;
    setDraft({
      name: sel.name, spec: sel.spec, level: sel.level, party: sel.party ?? '', solicitor: sel.solicitor ?? '',
      appraised: sel.appraised, agreed: sel.agreed ?? 0, lead: sel.lead ?? '', incentive: sel.incentive ?? 'None',
      statusId: sel.status, stalled: sel.stalled,
    });
    setEditing(true);
  };
  const cancelEdit = () => {
    if (selected === 'new') closeDrawer();
    else {
      setEditing(false);
      setDraft(null);
    }
  };
  const saveDraft = () => {
    if (!draft || saving) return;
    const prog = defs.find((d) => d.id === draft.statusId)?.prog ?? 0;
    const base = {
      id: selected === 'new' ? undefined : selected ?? undefined,
      dealId,
      name: draft.name.trim() || 'New unit',
      spec: draft.spec,
      level: draft.level,
      leadSource: draft.lead || null,
      incentive: draft.incentive || null,
      progress: prog,
      stalled: draft.stalled,
    };
    if (isRent) {
      upsertTenancy.mutate({ ...base, ervPcm: draft.appraised, agreedRentPcm: draft.agreed > 0 ? draft.agreed : null, tenantName: draft.party || null });
    } else {
      upsertUnit.mutate({
        ...base,
        appraisedValue: draft.appraised,
        agreedValue: draft.agreed > 0 ? draft.agreed : null,
        buyerName: draft.party || null,
        buyerSolicitor: draft.solicitor || null,
      });
    }
  };
  const removeSel = () => {
    if (!sel) return;
    if (!window.confirm(`Delete ${sel.name}? This cannot be undone.`)) return;
    if (isRent) deleteTenancy.mutate(sel.id);
    else deleteUnit.mutate(sel.id);
  };
  const advanceSel = (id: string) => (isRent ? advanceTenancy.mutate(id) : advanceUnit.mutate(id));

  const switchMode = (m: 'sales' | 'lettings') => {
    setMode(m);
    setFilter('all');
    closeDrawer();
  };

  const loading = isRent ? tenQ.isLoading : unitsQ.isLoading;

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-700">Pipeline</Link> / {deal?.name ?? '…'} / Sales & lettings
          </span>
        }
        right={
          <>
            <SegmentedToggle options={[['sales', 'Sales'], ['lettings', 'Lettings']]} value={mode} onChange={switchMode} />
            {headline && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-700">
                <Dot color={brand[500]} /> {headline}
              </span>
            )}
          </>
        }
      />

      <main className="max-w-[1640px] mx-auto px-6 pb-14">
        {loading ? (
          <div className="mt-16 flex justify-center"><Spinner /></div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="mt-5 flex gap-3 flex-wrap">
              {isRent ? (
                <>
                  <StatCard label="Annual rent roll" value={LR ? fM(LR.rentRollAnnual) : '—'} tone={brand[700]} sub={LR ? `of ${fM(LR.ervAnnual)} ERV` : undefined} />
                  <StatCard label="Occupancy" value={LR && LR.total > 0 ? formatPct(LR.occupied / LR.total, 0) : '—'} />
                  <StatCard label="Void rate" value={LR ? formatPct(LR.voidRate, 0) : '—'} />
                  <StatCard label="Arrears" value={LR ? formatMoneyFull(LR.arrears) : '—'} tone={LR && LR.arrears > 0 ? statusTokens.red.text : statusTokens.green.text} />
                  <StatCard label="Units let" value={LR ? `${LR.occupied} / ${LR.total}` : '—'} />
                </>
              ) : (
                <>
                  <StatCard label="GDV realised" value={SR ? fM(SR.gdvRealised) : '—'} tone={brand[700]} sub={SR ? `of ${fM(SR.gdvAppraised)} appraised` : undefined} />
                  <StatCard label="GDV appraised" value={SR ? fM(SR.gdvAppraised) : '—'} />
                  <StatCard label="Deposits held" value={SR ? fM(SR.depositsHeld) : '—'} />
                  <StatCard label="Sales rate" value={SR ? formatPct(SR.salesRate, 0) : '—'} sub="exchanged or beyond" />
                  <StatCard label="Units secured" value={SR ? `${secured} / ${SR.total}` : '—'} />
                </>
              )}
            </div>

            <div className="mt-5 grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
              {/* tracker */}
              <Panel
                title={labels.tableTitle}
                right={
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {[{ id: 'all', label: 'All', key: 'neutral' as StatusKey }, ...defs].map((f) => {
                      const on = filter === f.id;
                      const count = f.id === 'all' ? rows.length : rows.filter((r) => r.status === f.id).length;
                      return (
                        <button
                          key={f.id}
                          onClick={() => setFilter(f.id)}
                          className="inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"
                          style={on ? { background: neutral.tintSuccess, borderColor: '#D6E6DD', color: brand[700] } : { background: '#fff', borderColor: neutral.borderStrong, color: neutral.ink2b }}
                        >
                          <Dot color={f.id === 'all' ? brand[700] : statusTokens[f.key].dot} /> {f.label} · <span className="fig">{count}</span>
                        </button>
                      );
                    })}
                    <SegmentedToggle options={[['table', 'Table'], ['plan', 'Plan']]} value={view} onChange={setView} />
                    <Button onClick={openCreate}>+ Add unit</Button>
                  </div>
                }
              >
                {rows.length === 0 ? (
                  <EmptyState cta={<Button onClick={openCreate}>+ Add unit</Button>}>
                    No {isRent ? 'tenancies' : 'units'} on this deal yet — add the first one to start tracking {isRent ? 'lettings' : 'sales'}.
                  </EmptyState>
                ) : view === 'table' ? (
                  shown.length === 0 ? (
                    <EmptyState>No {isRent ? 'tenancies' : 'units'} match this filter.</EmptyState>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr>
                          <Th>Unit</Th>
                          <Th>{labels.party} / {labels.partySub.toLowerCase()}</Th>
                          <Th right>{labels.price}</Th>
                          <Th right>{labels.agreed}</Th>
                          <Th right>Δ</Th>
                          <Th className="pl-4">Progress</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => {
                          const d = defOf(r.status);
                          const hasAgreed = r.agreed != null && r.agreed > 0;
                          const dv = hasAgreed ? r.agreed! - r.appraised : 0;
                          return (
                            <tr key={r.id} className="cursor-pointer hover:bg-sunken transition-colors" onClick={() => openRow(r.id)}>
                              <Td>
                                <div className="flex items-center gap-2">
                                  <Dot color={statusTokens[d.key].dot} />
                                  <div>
                                    <div className="text-[13px] font-semibold">{r.name}</div>
                                    <div className="text-[10.5px] text-ink-3">{r.spec || '—'}</div>
                                  </div>
                                </div>
                              </Td>
                              <Td>
                                <div className="text-[12.5px] font-medium" style={{ color: r.party ? neutral.ink : neutral.ink3b }}>{r.party ?? labels.vacant}</div>
                                <div className="text-[10.5px] text-ink-3">{(isRent ? r.lead : r.solicitor) ?? (r.party ? 'TBC' : '—')}</div>
                              </Td>
                              <Td right fig className="text-ink-2b">{money(r.appraised)}</Td>
                              <Td right fig className="font-semibold">{hasAgreed ? money(r.agreed!) : '—'}</Td>
                              <Td right fig className="font-semibold" style={{ color: hasAgreed ? deltaTone(dv) : neutral.ink3 }}>
                                {hasAgreed ? delta(dv) : '—'}
                              </Td>
                              <Td className="pl-4">
                                <div className="flex items-center gap-2">
                                  <StatusChip status={d.key} label={d.label.toUpperCase()} />
                                  {r.stalled && <StatusChip status="red" label="STALLED" />}
                                </div>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="flex-1 min-w-[70px]">
                                    <ProgressBar pct={(r.progress / maxProg) * 100} height={5} color={r.stalled ? statusTokens.red.dot : statusTokens[d.key].dot} />
                                  </div>
                                  <span className="fig text-[9px] text-ink-3 whitespace-nowrap">
                                    {r.status === 'AVAILABLE' ? (isRent ? 'Vacant' : 'Unsold') : `Stage ${r.progress}/${maxProg}`}
                                  </span>
                                </div>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
                ) : (
                  <div>
                    <div className="text-[11.5px] text-ink-3 mb-3">Click a unit to open its record.</div>
                    <div className="flex flex-col gap-2">
                      {levels.map((l) => (
                        <div key={l} className="flex items-stretch gap-2">
                          <div className="w-[52px] shrink-0 flex items-center label-mono text-ink-3">{levelLabel(l)}</div>
                          <div className="flex-1 flex gap-2">
                            {rows
                              .filter((r) => r.level === l)
                              .map((r) => {
                                const d = defOf(r.status);
                                const t = statusTokens[d.key];
                                return (
                                  <button
                                    key={r.id}
                                    className="flex-1 min-w-0 rounded-[10px] border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-float"
                                    style={{ background: t.bg, borderColor: t.text }}
                                    onClick={() => openRow(r.id)}
                                  >
                                    <div className="flex items-center justify-between gap-1.5">
                                      <span className="text-[13px] font-semibold truncate">{r.name}</span>
                                      <Dot color={r.stalled ? statusTokens.red.dot : t.dot} size={8} />
                                    </div>
                                    <div className="fig mt-1 text-[12px] font-semibold">{money(r.agreed != null && r.agreed > 0 ? r.agreed : r.appraised)}</div>
                                    <div className="label-mono mt-0.5" style={{ color: t.text }}>{d.label}</div>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-3 border-t border-border-faint flex gap-4 flex-wrap">
                      {defs.map((d) => (
                        <span key={d.id} className="inline-flex items-center gap-1.5 text-[11px] text-ink-2b">
                          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: statusTokens[d.key].dot }} /> {d.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>

              {/* side rail */}
              <aside className="flex flex-col gap-4">
                <Panel title="Marketing funnel" right={<span className="fig text-[11px] text-ink-3">to date</span>}>
                  {rows.length === 0 ? (
                    <EmptyState>Funnel appears once units are added.</EmptyState>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2.5">
                        {funnel.map((f) => (
                          <div key={f.label}>
                            <div className="flex justify-between text-[12px] font-medium text-ink-2">
                              <span className="inline-flex items-center gap-1.5"><Dot color={f.dot} /> {f.label}</span>
                              <span className="fig font-semibold text-ink">{f.count}</span>
                            </div>
                            <div className="mt-1"><ProgressBar pct={(f.count / funnelMax) * 100} color={f.dot} /></div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-border-faint text-[11px] text-ink-3 leading-snug">{funnelConv}</div>
                    </>
                  )}
                </Panel>

                <Panel title={labels.forecastTitle} right={<span className="fig text-[11px] text-ink-3">{labels.forecastSub}</span>}>
                  {rows.length === 0 || forecast.bars.every((b) => b === 0) ? (
                    <EmptyState>No {isRent ? 'rent secured' : 'exchanges or reservations'} to forecast yet.</EmptyState>
                  ) : (
                    <>
                      <div className="flex items-end gap-2 h-[90px]">
                        {forecast.bars.map((v, i) => (
                          <div key={i} className="flex-1 h-full flex flex-col items-center justify-end gap-1">
                            <span className="fig text-[8px] font-semibold text-brand-700">{v > 0 ? fM(v) : ''}</span>
                            <div
                              className="w-[70%] rounded-t-[3px]"
                              style={{ height: `${(v / fcMax) * 72}%`, background: forecast.cumulative || i < 2 ? brand[700] : '#AECBBC' }}
                            />
                            <span className="fig text-[9px] text-ink-3">{months[i].toLocaleDateString('en-GB', { month: 'short' })}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-border-faint flex justify-between text-[12px] text-ink-2b">
                        <span>{labels.forecastTotal}</span>
                        <span className="fig font-semibold text-ink">{isRent ? formatRent(forecast.total) : fM(forecast.total)}</span>
                      </div>
                    </>
                  )}
                </Panel>

                <Panel title={labels.healthTitle}>
                  <div className="flex flex-col gap-2.5">
                    {health.map(([l, v, tone]) => (
                      <div key={l} className="flex justify-between text-[12.5px] text-ink-2b">
                        <span>{l}</span>
                        <span className="fig font-semibold" style={{ color: tone }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </aside>
            </div>
          </>
        )}
      </main>

      {/* ===== Drawer — read / create / edit / delete ===== */}
      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        width={520}
        title={
          selected === 'new' ? (
            'New unit'
          ) : sel ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[17px] font-bold tracking-[-0.4px] truncate">{sel.name}</span>
              {selDef && <StatusChip status={selDef.key} label={selDef.label.toUpperCase()} />}
              {sel.stalled && <StatusChip status="red" label="STALLED" />}
            </div>
          ) : undefined
        }
      >
        {editing && draft ? (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit name"><input className="w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={isRent ? 'e.g. Apt 9' : 'e.g. Plot 11'} /></Field>
              <Field label="Spec"><input className="w-full" value={draft.spec} onChange={(e) => setDraft({ ...draft, spec: e.target.value })} placeholder="2-bed apt · 78 m²" /></Field>
              <Field label={labels.party}><input className="w-full" value={draft.party} onChange={(e) => setDraft({ ...draft, party: e.target.value })} /></Field>
              {!isRent && <Field label={labels.solicitor}><input className="w-full" value={draft.solicitor} onChange={(e) => setDraft({ ...draft, solicitor: e.target.value })} /></Field>}
              <Field label={isRent ? 'ERV (£ pcm)' : 'Appraised (£)'}>
                <input type="number" className="w-full fig" value={draft.appraised || ''} onChange={(e) => setDraft({ ...draft, appraised: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label={isRent ? 'Agreed rent (£ pcm)' : 'Agreed (£)'}>
                <input type="number" className="w-full fig" value={draft.agreed || ''} onChange={(e) => setDraft({ ...draft, agreed: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="Lead source"><input className="w-full" value={draft.lead} onChange={(e) => setDraft({ ...draft, lead: e.target.value })} placeholder="Rightmove" /></Field>
              <Field label="Level">
                <input type="number" className="w-full fig" value={draft.level} onChange={(e) => setDraft({ ...draft, level: parseInt(e.target.value) || 0 })} />
              </Field>
              <Field label="Status">
                <select className="w-full" value={draft.statusId} onChange={(e) => setDraft({ ...draft, statusId: e.target.value })}>
                  {defs.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Incentive"><input className="w-full" value={draft.incentive} onChange={(e) => setDraft({ ...draft, incentive: e.target.value })} /></Field>
            </div>
            <div className="flex gap-2.5 mt-1">
              <Button className="flex-1 justify-center" disabled={saving || !draft.name.trim() || draft.appraised <= 0} onClick={saveDraft}>
                {saving ? <Spinner /> : 'Save'}
              </Button>
              <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
            </div>
            {draft.appraised <= 0 && <div className="text-[11px] text-ink-3">Enter a {isRent ? 'monthly ERV' : 'list price'} to save.</div>}
          </div>
        ) : sel ? (
          <div className="flex flex-col gap-4">
            {/* value strip */}
            <div className="flex gap-2.5">
              <div className="flex-1 rounded-[11px] bg-sunken-2 px-3 py-2.5">
                <div className="label-mono text-ink-3">{labels.price}</div>
                <div className="fig mt-1 text-[15px] font-semibold text-ink-2b">{money(sel.appraised)}</div>
              </div>
              <div className="flex-1 rounded-[11px] bg-sunken-2 px-3 py-2.5">
                <div className="label-mono text-ink-3">{labels.agreed}</div>
                <div className="fig mt-1 text-[15px] font-semibold">{sel.agreed != null && sel.agreed > 0 ? money(sel.agreed) : '—'}</div>
              </div>
              <div className="flex-1 rounded-[11px] px-3 py-2.5" style={{ background: selDelta > 0 ? statusTokens.green.bg : selDelta < 0 ? statusTokens.red.bg : neutral.sunken2 }}>
                <div className="label-mono" style={{ color: deltaTone(selDelta) }}>Δ</div>
                <div className="fig mt-1 text-[15px] font-semibold" style={{ color: deltaTone(selDelta) }}>
                  {sel.agreed != null && sel.agreed > 0 ? delta(selDelta) : '—'}
                </div>
              </div>
            </div>

            {sel.status === 'AVAILABLE' ? (
              <div className="bg-surface border border-border-strong rounded-card p-5 text-center">
                <div className="w-12 h-12 rounded-[13px] bg-sunken-2 inline-flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={neutral.ink3} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5 12 4l9 5.5" /><path d="M5 11v8h14v-8" /></svg>
                </div>
                <div className="mt-3 text-[15.5px] font-semibold">{labels.availTitle}</div>
                <div className="mt-1.5 text-[12.5px] text-ink-3 leading-relaxed">
                  List {isRent ? 'rent' : 'price'} {money(sel.appraised)}. {isRent ? 'Take an application to start referencing.' : 'Take a reservation to start the chain.'}
                </div>
                <div className="mt-4 flex gap-2.5">
                  <Button className="flex-1 justify-center" disabled={advancing} onClick={() => advanceSel(sel.id)}>
                    {advancing ? <Spinner /> : labels.availCta}
                  </Button>
                  <Button variant="secondary" onClick={openEdit}>Edit</Button>
                  <Button variant="danger" onClick={removeSel}>Delete</Button>
                </div>
              </div>
            ) : (
              <>
                {/* party record */}
                <div className="bg-surface border border-border-strong rounded-card p-4">
                  <div className="label-mono text-ink-3">{labels.partyBlock}</div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    {(
                      [
                        [labels.party, sel.party ?? '—', false],
                        [labels.solicitor, isRent ? (sel.progress >= 3 ? 'Referencing under way' : 'Not started') : sel.solicitor ?? 'TBC', false],
                        ['Lead source', sel.lead ?? '—', false],
                        ['Incentive', sel.incentive ?? 'None', false],
                        ['Deposit held', sel.deposit != null ? formatMoneyFull(sel.deposit) : '—', true],
                        [labels.dateLabel, sel.date ? fmtFull(sel.date) : '—', false],
                      ] as Array<[string, string, boolean]>
                    ).map(([l, v, isFig]) => (
                      <div key={l}>
                        <div className="text-[11px] text-ink-3">{l}</div>
                        <div className={`mt-0.5 text-[13.5px] font-semibold ${isFig ? 'fig text-brand-700' : ''}`}>{v}</div>
                      </div>
                    ))}
                    {isRent && (
                      <div>
                        <div className="text-[11px] text-ink-3">Arrears</div>
                        <div className="fig mt-0.5 text-[13.5px] font-semibold" style={{ color: sel.arrears > 0 ? statusTokens.red.text : statusTokens.green.text }}>
                          {formatMoneyFull(sel.arrears)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* progression timeline */}
                <div className="bg-surface border border-border-strong rounded-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="label-mono text-ink-3">{labels.progTitle}</span>
                    <span className="fig text-[11px] font-semibold" style={{ color: sel.stalled ? statusTokens.red.text : statusTokens.green.text }}>
                      {sel.progress >= maxProg ? 'Final stage' : `Stage ${sel.progress} of ${maxProg}`}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-col">
                    {names.map((label, i) => {
                      const done = i < sel.progress;
                      const current = i === sel.progress;
                      const stepDays = isRent ? 10 : 12;
                      const est = sel.date ? new Date(sel.date.getTime() + i * stepDays * 86400e3) : null;
                      const rec = sel.msDates[i] ?? null;
                      const dateLabel = done ? (rec ? fmtDay(rec) : est ? fmtDay(est) : '—') : current ? 'In progress' : est ? `Est. ${fmtDay(est)}` : '—';
                      return (
                        <div key={label} className="flex gap-3.5">
                          <div className="flex flex-col items-center shrink-0">
                            <span
                              className="w-[22px] h-[22px] rounded-full inline-flex items-center justify-center"
                              style={{
                                background: done ? brand[700] : '#fff',
                                border: `2px solid ${done ? brand[700] : current ? statusTokens.amber.dot : neutral.dashed}`,
                              }}
                            >
                              {done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}
                            </span>
                            {i < names.length - 1 && <span className="w-[2px] flex-1 min-h-[14px]" style={{ background: i < sel.progress - 1 ? brand[700] : neutral.border }} />}
                          </div>
                          <div className="pb-3.5 flex-1 flex items-baseline justify-between gap-3">
                            <span className="text-[13px] font-semibold" style={{ color: done ? neutral.ink : current ? statusTokens.amber.text : neutral.ink3b }}>{label}</span>
                            <span className="fig text-[10.5px]" style={{ color: done ? statusTokens.green.text : current ? statusTokens.amber.text : neutral.ink3b }}>{dateLabel}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex gap-2.5">
                    <Button className="flex-1 justify-center" disabled={advancing || sel.progress >= maxProg} onClick={() => advanceSel(sel.id)}>
                      {advancing ? <Spinner /> : sel.progress >= maxProg ? labels.doneCta : 'Advance milestone'}
                    </Button>
                    <Button variant="secondary" onClick={openEdit}>Edit</Button>
                    <Button variant="danger" onClick={removeSel}>Delete</Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-ink-3 block mb-1">{label}</span>
      {children}
    </label>
  );
}
