import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { weightedComparables } from '@apex/appraisal-engine';
import { trpc } from '../lib/trpc';
import { Button, Dot, EmptyState, Icon, Panel, ProgressBar, Skeleton, SkeletonRows, Spinner, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';
import { SiteMap } from '../components/SiteMap';

const GREEN = '#1E7A55';
const RED = '#B23A2E';
const AMBER = '#9A6212';
const NEUTRAL = '#8A908A';
const PIN = '#1E9E6A';

const adjColor = (v: number) => (v > 0 ? GREEN : v < 0 ? RED : NEUTRAL);

const ADJ_COLS: Array<[AdjKey, string]> = [
  ['adjSize', 'Size'],
  ['adjCondition', 'Cond.'],
  ['adjDate', 'Date'],
  ['adjLocation', 'Loc.'],
];

type AdjKey = 'adjSize' | 'adjCondition' | 'adjDate' | 'adjLocation';

export default function Comparables() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data, isLoading } = trpc.comparables.list.useQuery(dealId, { enabled: !!dealId });
  const upsert = trpc.comparables.upsert.useMutation({ onSuccess: () => utils.comparables.list.invalidate(dealId) });
  const apply = trpc.comparables.applyToAppraisal.useMutation();

  // local overlay of adjustment edits for live recompute; persisted onBlur via upsert
  const [edits, setEdits] = useState<Record<string, Partial<Record<AdjKey, number>>>>({});

  // subject coordinates from the deal's postcode (postcodes.io — free, no key)
  const [subjectCoords, setSubjectCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const pc = deal?.postcode?.replace(/\s+/g, '');
    if (!pc) return;
    let cancelled = false;
    fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.result) setSubjectCoords({ lat: j.result.latitude, lng: j.result.longitude });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [deal?.postcode]);

  const comps = useMemo(() => (data?.comps ?? []).map((c) => ({ ...c, ...edits[c.id] })), [data, edits]);

  // live summary through the shared engine — same maths as the server
  const summary = useMemo(
    () =>
      weightedComparables(
        comps.map((c) => ({
          address: c.address,
          basePsf: c.basePsf,
          adjustments: { size: c.adjSize, condition: c.adjCondition, date: c.adjDate, location: c.adjLocation },
        })),
      ),
    [comps],
  );

  const supported = comps.length ? Math.round(summary.supportedPsf) : 0;
  const avgGross = summary.avgGrossAdjustment;
  const conf =
    avgGross <= 8
      ? { label: 'High', color: GREEN, bg: '#E4F1EA' }
      : avgGross <= 15
        ? { label: 'Medium', color: AMBER, bg: '#F8F0DE' }
        : { label: 'Low', color: RED, bg: '#F9EAE7' };

  const setAdj = (id: string, key: AdjKey, v: number) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: v } }));

  const persist = (c: (typeof comps)[number]) =>
    upsert.mutate({
      id: c.id,
      dealId,
      address: c.address,
      meta: c.meta,
      basePsf: c.basePsf,
      adjSize: c.adjSize,
      adjCondition: c.adjCondition,
      adjDate: c.adjDate,
      adjLocation: c.adjLocation,
    });

  const addComp = () =>
    upsert.mutate({
      dealId,
      address: `Comparable ${comps.length + 1}`,
      meta: 'New evidence — set base £/ft² and adjustments',
      basePsf: 220,
      adjSize: 0,
      adjCondition: 0,
      adjDate: 0,
      adjLocation: 0,
    });

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Comparable evidence" />
        <DealNav dealId={dealId} active="comparables" />
        <main className="max-w-[1640px] mx-auto px-6 pb-14">
          <div className="mt-5 grid gap-5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
            {/* adjustment-grid skeleton */}
            <div className="flex flex-col gap-4">
              <Panel>
                <Skeleton height={18} width={280} />
                <div className="mt-4">
                  <SkeletonRows rows={7} height={18} />
                </div>
              </Panel>
              <Panel>
                <Skeleton height={200} className="rounded-[10px]" />
              </Panel>
            </div>
            {/* right-rail skeleton */}
            <aside className="flex flex-col gap-4">
              <Skeleton height={150} className="rounded-card" />
              <Panel>
                <SkeletonRows rows={4} height={14} />
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
            <Link to={`/deal/${dealId}/appraisal`} className="text-inactive hover:text-brand-700">{deal?.name ?? 'Deal'}</Link>
            {' / '}Comparable evidence
          </span>
        }
        right={
          comps.length > 0 && (
            <span className="inline-flex items-center rounded-[9px] bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-700">
              Derived: £{supported}/ft²
            </span>
          )
        }
      />

      <DealNav dealId={dealId} active="comparables" />
      <main className="max-w-[1640px] mx-auto px-6 pb-14">
        <div className="mt-5 grid gap-5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
          {/* LEFT: adjustment grid + map */}
          <div className="flex flex-col gap-4">
            <Panel
              title={
                <div>
                  <div className="text-[17px] font-bold tracking-[-0.4px]">Sales comparison — adjustment grid</div>
                  <div className="mt-0.5 text-[12.5px] text-ink-3 font-normal">
                    Adjust each comp to the subject; the grid derives a supported £/ft².
                  </div>
                </div>
              }
              right={
                <Button variant="secondary" onClick={addComp} disabled={upsert.isPending}>
                  <Icon d="M12 5v14|M5 12h14" size={14} color="#14503B" /> Add comp
                </Button>
              }
            >
              {comps.length === 0 ? (
                <EmptyState cta={<Button onClick={addComp} disabled={upsert.isPending}>Add your first comp</Button>}>
                  No comparable evidence on this deal yet.
                </EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    {/* header */}
                    <div className="flex label-mono text-ink-3 border-b border-border-std">
                      <div className="pb-2 px-2.5" style={{ flex: 2 }}>Comparable</div>
                      <div className="pb-2 px-1.5 text-right" style={{ flex: 1.1 }}>Sale £/ft²</div>
                      {ADJ_COLS.map(([k, label]) => (
                        <div key={k} className="pb-2 px-1.5 text-center" style={{ flex: 1 }}>{label}</div>
                      ))}
                      <div className="pb-2 px-2.5 text-right" style={{ flex: 1.2 }}>Adjusted</div>
                    </div>

                    {/* rows */}
                    {comps.map((c, i) => {
                      const r = summary.comps[i];
                      const netFmt = `${r.netAdjustment > 0 ? '+' : r.netAdjustment < 0 ? '−' : ''}${Math.abs(r.netAdjustment)}%`;
                      return (
                        <div key={c.id} className="flex items-center border-b border-border-faint py-2.5">
                          <div className="px-2.5 min-w-0" style={{ flex: 2 }}>
                            <div className="flex items-center gap-2 min-w-0">
                              <Dot color={PIN} size={9} />
                              <span className="text-[13px] font-semibold truncate">{c.address}</span>
                            </div>
                            <div className="mt-0.5 pl-[17px] text-[10.5px] text-ink-3 truncate">{c.meta}</div>
                          </div>
                          <div className="fig px-1.5 text-right text-[13px] font-semibold" style={{ flex: 1.1 }}>£{c.basePsf}</div>
                          {ADJ_COLS.map(([k, label]) => (
                            <div key={k} className="px-1 flex justify-center" style={{ flex: 1 }}>
                              <input
                                type="number"
                                aria-label={`${c.address} ${label} adjustment %`}
                                className="fig w-[52px] h-[30px] p-0 text-center rounded-[7px] border-border-strong text-[11.5px] font-medium"
                                style={{ color: adjColor(c[k]) }}
                                value={c[k]}
                                onChange={(e) => setAdj(c.id, k, parseFloat(e.target.value) || 0)}
                                onBlur={() => persist(c)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                              />
                            </div>
                          ))}
                          <div className="px-2.5 text-right" style={{ flex: 1.2 }}>
                            <div className="fig text-[14px] font-semibold text-brand-700">£{r.adjustedPsf}</div>
                            <div className="fig text-[10px]" style={{ color: adjColor(r.netAdjustment) }}>{netFmt}</div>
                          </div>
                        </div>
                      );
                    })}

                    {/* derived */}
                    <div className="mt-2.5 flex items-center rounded-[10px] bg-tint-success py-3">
                      <div className="px-2.5 text-[13.5px] font-bold text-brand-700" style={{ flex: 2 }}>Weighted supported value</div>
                      <div style={{ flex: 1.1 }} /><div style={{ flex: 1 }} /><div style={{ flex: 1 }} /><div style={{ flex: 1 }} /><div style={{ flex: 1 }} />
                      <div className="fig px-2.5 text-right text-[16px] font-bold text-brand-700" style={{ flex: 1.2 }}>£{supported}</div>
                    </div>
                    <div className="mt-2 text-[11px] text-ink-3">
                      Adjustments are % to the subject — positive uplifts the comp toward the subject. Weighted by inverse gross adjustment (closest comps weigh most).
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            {/* real map — OpenStreetMap tiles, geocoded pins */}
            <Panel title={<span className="text-[14px] font-semibold">Location of evidence</span>}>
              {subjectCoords ? (
                <>
                  <SiteMap
                    height={260}
                    pins={[
                      { lat: subjectCoords.lat, lng: subjectCoords.lng, label: deal?.name ?? 'Subject', sub: deal?.address, kind: 'subject' as const },
                      ...comps
                        .filter((c): c is typeof c & { lat: number; lng: number } => c.lat != null && c.lng != null)
                        .map((c) => ({ lat: c.lat, lng: c.lng, label: c.address, sub: c.meta || undefined, kind: 'comp' as const })),
                    ]}
                  />
                  <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-2">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#14503B' }} /> Subject</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: PIN }} /> Comparables ({comps.filter((c) => c.lat != null).length} of {comps.length} geolocated)</span>
                  </div>
                </>
              ) : (
                <div className="text-[12px] text-ink-3 py-6 text-center">
                  Add the site postcode on the <Link to={`/deal/${dealId}/sitepack`} className="text-brand-500 font-semibold hover:text-brand-700">Site pack</Link> to place the evidence on a live map.
                </div>
              )}
            </Panel>
          </div>

          {/* RIGHT: subject + evidence quality + apply */}
          <aside className="flex flex-col gap-4 sticky top-[78px]">
            <div className="rounded-card p-5 text-white shadow-rest" style={{ background: 'linear-gradient(155deg,#1B6048,#14503B)' }}>
              <div className="fig text-[10px] font-medium uppercase tracking-[0.7px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Subject</div>
              <div className="mt-1.5 text-[17px] font-semibold">{deal?.name ?? '—'}</div>
              <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {deal ? `${deal.assetType.replace('_', ' / ')} · ${deal.address}` : ''}
              </div>
              <div className="mt-4 pt-3.5 flex items-end justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.75)' }}>Supported blended value</span>
                <span className="fig text-[24px] font-semibold tracking-[-1px]">
                  £{supported}
                  <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.6)' }}>/ft²</span>
                </span>
              </div>
            </div>

            <Panel title={<span className="text-[13px] font-semibold">Evidence quality</span>}>
              <div className="flex flex-col gap-3">
                <div>
                  <div className="flex justify-between text-[12px] text-ink-2b">
                    <span>Gross adjustment</span>
                    <span className="fig font-semibold text-ink">{avgGross.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar pct={Math.min(100, avgGross * 5)} color={conf.color} />
                  </div>
                </div>
                <div className="flex justify-between text-[12.5px] text-ink-2b">
                  <span>Comps within 0.8 mi</span>
                  <span className="fig font-semibold text-ink">{comps.length} / {comps.length}</span>
                </div>
                <div className="flex justify-between text-[12.5px] text-ink-2b">
                  <span>Range</span>
                  <span className="fig font-semibold text-ink">
                    {comps.length ? `£${summary.range.lo}–£${summary.range.hi}` : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-[9px]" style={{ background: conf.bg }}>
                  <Dot color={conf.color} size={8} />
                  <span className="text-[12px] font-semibold" style={{ color: conf.color }}>{conf.label} confidence</span>
                </div>
              </div>
            </Panel>

            <Panel title={<span className="text-[13px] font-semibold">Apply to appraisal</span>}>
              <div className="text-[12px] text-ink-2b leading-relaxed">
                Push the supported £{supported}/ft² into the revenue tab of the development appraisal.
              </div>
              {apply.isSuccess ? (
                <div className="mt-3">
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-[9px] bg-tint-success-2">
                    <Icon d="M4 12l5 5L20 7" size={15} color={GREEN} strokeWidth={2.5} />
                    <span className="text-[12px] font-semibold text-status-green">
                      Applied — unit caps set to £{apply.data.supportedPsf}/ft²
                    </span>
                  </div>
                  <Link
                    to={`/deal/${dealId}/appraisal`}
                    className="mt-3 flex items-center justify-center gap-2 h-[42px] rounded-[11px] bg-brand-700 text-white text-[13px] font-semibold hover:bg-brand-600 transition-colors"
                  >
                    Open appraisal
                    <Icon d="M5 12h14|M13 6l6 6-6 6" size={15} color="#fff" strokeWidth={2.2} />
                  </Link>
                </div>
              ) : (
                <button
                  className="mt-3.5 w-full flex items-center justify-center gap-2 h-[42px] rounded-[11px] bg-brand-700 text-white text-[13px] font-semibold hover:bg-brand-600 transition-colors disabled:opacity-50"
                  disabled={apply.isPending || comps.length === 0}
                  onClick={() => apply.mutate(dealId)}
                >
                  {apply.isPending ? <Spinner /> : (
                    <>
                      Apply &amp; open appraisal
                      <Icon d="M5 12h14|M13 6l6 6-6 6" size={15} color="#fff" strokeWidth={2.2} />
                    </>
                  )}
                </button>
              )}
              {apply.error && <div className="mt-2 text-[11.5px] text-status-red">{apply.error.message}</div>}
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
