import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatMoneyFull, n0 } from '../lib/format';
import { Button, Dot, EmptyState, Panel, Skeleton, SkeletonRows, StatCard, Td, Th, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';

type Weights = { salesComparison: number; cost: number; income: number };
type ApproachKey = 'sales' | 'cost' | 'income';

const APPROACHES: Array<{ key: ApproachKey; wKey: keyof Weights; label: string; dot: string; sub: string }> = [
  { key: 'sales', wKey: 'salesComparison', label: 'Sales comparison', dot: '#14503B', sub: 'Supported £/ft² × subject area' },
  { key: 'cost', wKey: 'cost', label: 'Cost approach', dot: '#1E9E6A', sub: 'Land + depreciated build cost' },
  { key: 'income', wKey: 'income', label: 'Income approach', dot: '#9AA09A', sub: 'Net rent capitalised at market yield' },
];

const adjFmt = (pts: number) => (pts === 0 ? '—' : `${pts > 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)}%`);
const adjColor = (pts: number) => (pts > 0 ? '#1E7A55' : pts < 0 ? '#B23A2E' : '#9AA09A');

export default function Workbench() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: inspection, isLoading: inspLoading } = trpc.inspections.get.useQuery(dealId, { enabled: !!dealId });
  const { data: compsData, isLoading: compsLoading } = trpc.comparables.list.useQuery(dealId, { enabled: !!dealId });
  const { data: appraisal, isLoading: apprLoading } = trpc.appraisal.getCurrent.useQuery(dealId, { enabled: !!dealId });

  const [values, setValues] = useState<Record<ApproachKey, number>>({ sales: 0, cost: 0, income: 0 });
  const [weights, setWeights] = useState<Weights>({ salesComparison: 60, cost: 20, income: 20 });
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);

  const nia = appraisal?.result.nia ?? 0;
  const comps = compsData?.comps ?? [];
  const summary = compsData?.summary;

  // hydrate once from the field inspection + comparable evidence
  useEffect(() => {
    if (hydrated || !deal || inspLoading || compsLoading || apprLoading) return;
    const supported = compsData?.summary.supportedPsf ?? 0;
    const area = appraisal?.result.nia ?? 0;
    const salesBase = Math.round(supported * area) || inspection?.reconciledValue || Math.round(deal.gdv) || 0;
    setValues({ sales: salesBase, cost: Math.round(salesBase * 0.97), income: Math.round(salesBase * 0.99) });
    if (inspection) setWeights(inspection.approachWeights);
    setHydrated(true);
  }, [hydrated, deal, inspLoading, compsLoading, apprLoading, compsData, appraisal, inspection]);

  const wSum = weights.salesComparison + weights.cost + weights.income;
  const reconciled = wSum > 0
    ? (values.sales * weights.salesComparison + values.cost * weights.cost + values.income * weights.income) / wSum
    : 0;

  const save = trpc.inspections.save.useMutation({
    onSuccess: () => {
      utils.inspections.get.invalidate(dealId);
      setDirty(false);
    },
  });

  const onSave = () =>
    save.mutate({
      id: inspection?.id,
      dealId,
      rooms: inspection?.rooms ?? [],
      reconciledValue: Math.round(reconciled) || null,
      approachWeights: weights,
      status: inspection?.status === 'submitted' ? 'submitted' : 'draft',
    });

  const setValue = (k: ApproachKey, v: number) => {
    setValues((s) => ({ ...s, [k]: v }));
    setDirty(true);
  };
  const setWeight = (k: keyof Weights, v: number) => {
    setWeights((s) => ({ ...s, [k]: Math.max(0, Math.min(100, v)) }));
    setDirty(true);
  };

  const rooms = inspection?.rooms ?? [];
  const ratedRooms = rooms.filter((r) => r.condition > 0);
  const photoTotal = rooms.reduce((a, r) => a + r.photos, 0);
  const isSynced = inspection?.status === 'submitted';
  const inspectedOn = inspection
    ? new Date(inspection.inspectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const avgGross = summary?.avgGrossAdjustment ?? 0;
  const conf =
    comps.length === 0
      ? { label: 'No evidence', color: '#6E7269', bg: '#F0EFE9', dot: '#9AA09A' }
      : avgGross < 8
        ? { label: 'High', color: '#1E7A55', bg: '#E4F1EA', dot: '#1E7A55' }
        : avgGross < 15
          ? { label: 'Medium', color: '#9A6212', bg: '#F8F0DE', dot: '#C7A95B' }
          : { label: 'Low', color: '#B23A2E', bg: '#F9EAE7', dot: '#B23A2E' };

  const compWeightSum = summary?.comps.reduce((a, c) => a + c.weight, 0) || 1;
  const rangeLow = summary && nia > 0 ? Math.round(summary.range.lo * nia) : null;
  const rangeHigh = summary && nia > 0 ? Math.round(summary.range.hi * nia) : null;
  const marker = rangeLow != null && rangeHigh != null && rangeHigh > rangeLow
    ? Math.max(4, Math.min(96, ((reconciled - rangeLow) / (rangeHigh - rangeLow)) * 100))
    : 50;

  if (!deal || inspLoading || compsLoading || apprLoading || !hydrated) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Valuation workbench" />
        <DealNav dealId={dealId} active="workbench" />
        <main className="max-w-[1500px] mx-auto px-4 sm:px-6 pb-14">
          <div className="mt-6">
            <Skeleton height={12} width={140} />
            <Skeleton height={26} width={300} className="mt-2.5" />
          </div>
          {/* KPI row skeleton */}
          <div className="mt-5 flex gap-3 flex-wrap">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex-1 min-w-[160px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
                <Skeleton height={10} width="60%" />
                <Skeleton height={21} width="75%" className="mt-2.5" />
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,1fr)_340px]">
            <div className="min-w-0 flex flex-col gap-4">
              {/* approach cards skeleton */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="bg-surface border border-border-strong rounded-card shadow-rest p-4">
                    <Skeleton height={12} width="55%" />
                    <Skeleton height={21} width="70%" className="mt-3" />
                    <Skeleton height={30} className="mt-3.5" />
                    <Skeleton height={30} className="mt-2.5" />
                  </div>
                ))}
              </div>
              <Panel>
                <SkeletonRows rows={5} height={16} />
              </Panel>
            </div>
            <aside className="flex flex-col gap-4 min-w-0">
              <Panel>
                <SkeletonRows rows={4} />
              </Panel>
              <Panel>
                <SkeletonRows rows={5} />
              </Panel>
            </aside>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-700">Pipeline</Link> / {deal.name} / Workbench
          </span>
        }
        right={
          <>
            {isSynced && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-pill bg-tint-success-2 px-3 py-1.5 text-[11.5px] font-semibold text-status-green">
                <Dot color="#1E7A55" /> Synced from field
              </span>
            )}
            <Button onClick={onSave} loading={save.isPending} disabled={!dirty}>
              {dirty ? 'Save valuation' : 'Saved'}
            </Button>
          </>
        }
      />

      {/* field-sync banner */}
      {isSynced && !dismissed && (
        <div className="flex items-center gap-3 px-4 sm:px-6 py-2.5 bg-tint-success border-b border-[#D6E6DD]">
          <span className="flex-none w-[30px] h-[30px] rounded-[9px] bg-brand-700 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-semibold text-brand-700">Synced from field inspection · {inspectedOn}</div>
            <div className="mt-px text-[11.5px]" style={{ color: '#1E5C45' }}>
              {ratedRooms.length} of {rooms.length} areas rated · {photoTotal} photos — valuation pre-filled below.
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="flex-none w-[26px] h-[26px] rounded-[7px] flex items-center justify-center hover:bg-tint-success-2"
            style={{ color: '#5E8C76' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      <DealNav dealId={dealId} active="workbench" />
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 pb-14">
        <div className="mt-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Valuation modeling</div>
            <h1 className="mt-1.5 text-[22px] sm:text-[26px] font-bold tracking-[-0.7px] leading-tight">Valuation reconciliation</h1>
            <div className="mt-1 text-[13.5px] text-ink-2">{deal.address}</div>
          </div>
          <Button to={`/deal/${dealId}/redbook`} variant="secondary">
            Generate Red Book report →
          </Button>
        </div>

        {/* KPI row */}
        <div className="mt-5 flex gap-3 flex-wrap">
          <div className="flex-[1.4] min-w-[210px] rounded-card px-4 py-3.5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(150deg,#1B6048,#13503B)' }}>
            <div className="absolute rounded-full" style={{ top: -24, right: -24, width: 96, height: 96, background: 'rgba(255,255,255,0.07)' }} />
            <div className="label-mono text-white/65">Market value</div>
            <div className="fig mt-1.5 text-[26px] font-semibold tracking-[-1.4px]">{formatMoneyFull(Math.round(reconciled))}</div>
            <div className="mt-0.5 text-[11px] text-white/70">{nia > 0 ? `£${n0(reconciled / nia)} / ft² · ${n0(nia)} ft² NIA` : 'Weighted across three approaches'}</div>
          </div>
          <StatCard
            label="Supported £/ft²"
            value={summary && comps.length ? `£${n0(summary.supportedPsf)}` : '—'}
            tone="#14503B"
            sub={`from ${comps.length} comparable${comps.length === 1 ? '' : 's'}`}
          />
          <StatCard
            label="Adjusted range"
            value={summary && comps.length ? `£${n0(summary.range.lo)}–£${n0(summary.range.hi)}` : '—'}
            sub="per ft², after adjustment"
          />
          <StatCard
            label="Avg gross adj"
            value={comps.length ? `${avgGross.toFixed(1)}pts` : '—'}
            tone={conf.color}
            sub={`${conf.label} confidence`}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,1fr)_340px]">
          {/* LEFT — approaches + comps grid */}
          <div className="min-w-0 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {APPROACHES.map((a) => (
                <div key={a.key} className="bg-surface border border-border-strong rounded-card shadow-rest p-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-[2px]" style={{ background: a.dot }} />
                    <span className="text-[13px] font-semibold">{a.label}</span>
                  </div>
                  <div className="fig mt-3 text-[21px] font-semibold tracking-[-1px]">{formatMoneyFull(values[a.key])}</div>
                  <div className="mt-0.5 text-[11px] text-ink-3">{a.sub}</div>
                  <div className="mt-3.5 flex flex-col gap-2.5">
                    <label className="block">
                      <span className="label-mono text-ink-3 block mb-1">Value (£)</span>
                      <input
                        type="number"
                        className="w-full fig text-right"
                        value={values[a.key]}
                        onChange={(e) => setValue(a.key, Math.max(0, parseFloat(e.target.value) || 0))}
                      />
                    </label>
                    <label className="block">
                      <span className="label-mono text-ink-3 block mb-1">Weight (%)</span>
                      <div className="flex items-center gap-2.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="w-[72px] fig text-right"
                          value={weights[a.wKey]}
                          onChange={(e) => setWeight(a.wKey, parseFloat(e.target.value) || 0)}
                        />
                        <div className="flex-1 h-1.5 rounded-[3px] bg-border-std overflow-hidden">
                          <div className="h-full rounded-[3px] transition-all" style={{ width: `${wSum > 0 ? (weights[a.wKey] / wSum) * 100 : 0}%`, background: a.dot }} />
                        </div>
                        <span className="fig text-[11px] font-semibold w-9 text-right">{wSum > 0 ? Math.round((weights[a.wKey] / wSum) * 100) : 0}%</span>
                      </div>
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <Panel
              title="Comparable evidence grid"
              right={
                <span className="inline-flex items-center gap-1.5 rounded-chip bg-tint-success px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#14503B" aria-hidden="true"><path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z" /></svg>
                  Auto-adjusted
                </span>
              }
            >
              {comps.length === 0 ? (
                <EmptyState
                  cta={
                    <Button to={`/deal/${dealId}/comparables`} variant="secondary" size="sm">
                      Add comparables →
                    </Button>
                  }
                >
                  No comparable evidence on this deal yet.
                </EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr>
                        <Th>Comparable</Th>
                        <Th right>Base £/ft²</Th>
                        <Th right>Size</Th>
                        <Th right>Cond.</Th>
                        <Th right>Date</Th>
                        <Th right>Location</Th>
                        <Th right>Net adj</Th>
                        <Th right>Adj £/ft²</Th>
                        <Th right>Weight</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {comps.map((c, i) => {
                        const r = summary!.comps[i];
                        return (
                          <tr key={c.id} className="hover:bg-sunken">
                            <Td>
                              <div className="font-semibold text-[12.5px]">{c.address}</div>
                              {c.meta && <div className="text-[11px] text-ink-3">{c.meta}</div>}
                            </Td>
                            <Td right fig>£{n0(c.basePsf)}</Td>
                            <Td right fig style={{ color: adjColor(c.adjSize) }}>{adjFmt(c.adjSize)}</Td>
                            <Td right fig style={{ color: adjColor(c.adjCondition) }}>{adjFmt(c.adjCondition)}</Td>
                            <Td right fig style={{ color: adjColor(c.adjDate) }}>{adjFmt(c.adjDate)}</Td>
                            <Td right fig style={{ color: adjColor(c.adjLocation) }}>{adjFmt(c.adjLocation)}</Td>
                            <Td right fig className="font-semibold" style={{ color: adjColor(r.netAdjustment) }}>{adjFmt(r.netAdjustment)}</Td>
                            <Td right fig className="font-semibold" style={{ color: '#14503B' }}>£{n0(r.adjustedPsf)}</Td>
                            <Td right>
                              <span className="inline-flex items-center gap-2 justify-end">
                                <span className="w-14 h-1.5 rounded-[3px] bg-border-std overflow-hidden inline-block">
                                  <span className="block h-full rounded-[3px] bg-brand-500" style={{ width: `${(r.weight / compWeightSum) * 100}%` }} />
                                </span>
                                <span className="fig text-[11px] font-semibold">{Math.round((r.weight / compWeightSum) * 100)}%</span>
                              </span>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {summary && comps.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border-std flex gap-6 flex-wrap text-[12px] text-ink-2">
                  <span>Supported <b className="fig text-brand-700">£{n0(summary.supportedPsf)}/ft²</b></span>
                  {nia > 0 && <span>× {n0(nia)} ft² NIA → <b className="fig text-brand-700">{formatMoneyFull(Math.round(summary.supportedPsf * nia))}</b></span>}
                  <span>Avg gross adjustment <b className="fig" style={{ color: conf.color }}>{avgGross.toFixed(1)}pts</b></span>
                </div>
              )}
            </Panel>
          </div>

          {/* RIGHT — reconciliation + evidence + field inspection */}
          <aside className="flex flex-col gap-4 min-w-0">
            <Panel
              title="Reconciliation"
              right={
                <span className="inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-[10.5px] font-semibold" style={{ color: conf.color, background: conf.bg }}>
                  <Dot color={conf.dot} size={6} /> {conf.label}
                </span>
              }
            >
              <div className="fig text-[29px] font-semibold tracking-[-1.6px]">{formatMoneyFull(Math.round(reconciled))}</div>
              <div className="mt-1 text-[11px] text-ink-3">Basis: Market Value · RICS Red Book (VPS 4)</div>
              {rangeLow != null && rangeHigh != null && (
                <div className="mt-3.5">
                  <div className="relative h-[7px] rounded-[4px] bg-sunken-2">
                    <div className="absolute top-0 bottom-0 rounded-[4px]" style={{ left: '8%', right: '10%', background: 'linear-gradient(90deg,#1E9E6A,#14503B)' }} />
                    <div className="absolute -top-[3px] w-[13px] h-[13px] rounded-full bg-brand-700 border-2 border-surface -translate-x-1/2" style={{ left: `${marker}%`, boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
                  </div>
                  <div className="mt-1.5 flex justify-between fig text-[11px] font-medium text-ink-3">
                    <span>{formatMoneyFull(rangeLow)}</span>
                    <span>{formatMoneyFull(rangeHigh)}</span>
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-col gap-2.5">
                {APPROACHES.map((a) => (
                  <div key={a.key}>
                    <div className="flex justify-between text-[12px]">
                      <span className="font-medium">{a.label}</span>
                      <span className="fig font-semibold text-brand-700">{wSum > 0 ? Math.round((weights[a.wKey] / wSum) * 100) : 0}%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-[3px] bg-border-std overflow-hidden">
                      <div className="h-full rounded-[3px] transition-all" style={{ width: `${wSum > 0 ? (weights[a.wKey] / wSum) * 100 : 0}%`, background: a.dot }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Evidence & confidence">
              {(
                [
                  ['Comparables', comps.length ? `${comps.length}` : '—'],
                  ['Supported £/ft²', summary && comps.length ? `£${n0(summary.supportedPsf)}` : '—'],
                  ['Adjusted range', summary && comps.length ? `£${n0(summary.range.lo)}–£${n0(summary.range.hi)}` : '—'],
                  ['Avg gross adjustment', comps.length ? `${avgGross.toFixed(1)}pts` : '—'],
                  ['Subject NIA', nia > 0 ? `${n0(nia)} ft²` : '—'],
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 border-t border-border-faint first:border-t-0 text-[12.5px]">
                  <span className="text-ink-2">{k}</span>
                  <span className="fig font-semibold">{v}</span>
                </div>
              ))}
              {comps.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-border-std text-[11.5px] text-ink-2 leading-[1.5]">
                  {comps.length} comp{comps.length === 1 ? '' : 's'} with gross adjustments averaging {avgGross.toFixed(1)}pts —{' '}
                  supports a <b style={{ color: conf.color }}>{conf.label.toLowerCase()} confidence</b> rating.
                </div>
              )}
            </Panel>

            <Panel
              title="Field inspection"
              right={
                inspection ? (
                  <span
                    className="label-mono px-2 py-[3px] rounded-[7px]"
                    style={isSynced ? { color: '#1E7A55', background: '#E4F1EA' } : { color: '#9A6212', background: '#F8F0DE' }}
                  >
                    {isSynced ? 'SUBMITTED' : 'DRAFT'}
                  </span>
                ) : undefined
              }
            >
              {inspection ? (
                <>
                  <div className="text-[11.5px] text-ink-3 mb-2">Inspected {inspectedOn} · {photoTotal} photos</div>
                  {rooms.map((r) => (
                    <div key={r.name} className="flex items-center gap-2.5 py-2 border-t border-border-faint first:border-t-0">
                      <span className="flex-1 text-[12.5px] font-medium">{r.name}</span>
                      <span className="flex gap-[3px]">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span key={n} className="w-[7px] h-[7px] rounded-full" style={{ background: r.condition >= n ? '#14503B' : '#ECEBE5' }} />
                        ))}
                      </span>
                      <span className="fig w-14 text-right text-[11px] text-ink-2">
                        {r.condition > 0 ? `C${r.condition}` : '—'} · {r.photos}ph
                      </span>
                    </div>
                  ))}
                  {rooms.some((r) => r.notes) && (
                    <div className="mt-2.5 pt-2.5 border-t border-border-std flex flex-col gap-1.5">
                      {rooms.filter((r) => r.notes).map((r) => (
                        <div key={r.name} className="text-[11.5px] text-ink-2"><b>{r.name}:</b> {r.notes}</div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <EmptyState
                  icon={
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
                  }
                  cta={
                    <Button to="/field" variant="secondary" size="sm">
                      Open the field app →
                    </Button>
                  }
                >
                  No field inspection yet — capture the subject on site and it will sync here.
                </EmptyState>
              )}
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
