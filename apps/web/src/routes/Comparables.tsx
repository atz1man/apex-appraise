import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { weightedComparables } from '@apex/appraisal-engine';
import { assetLabel } from '@apex/types/asset-classes';
import { useUnits } from '../lib/region';
import { trpc } from '../lib/trpc';
import { Button, Dot, EmptyState, Icon, Panel, ProgressBar, Skeleton, SkeletonRows, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';
import { SiteMap } from '../components/SiteMap';
import { brand, onFill } from '@apex/ui-tokens';

const GREEN = 'rgb(var(--status-green, 30 122 85))';
const RED = 'rgb(var(--status-red, 178 58 46))';
const AMBER = 'rgb(var(--status-amber, 154 98 18))';
const NEUTRAL = 'rgb(var(--inactive, 138 144 138))';
const PIN = brand[400];

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
  const remove = trpc.comparables.remove.useMutation({ onSuccess: () => utils.comparables.list.invalidate(dealId) });
  // this screen shows the error where it happened; see App.tsx
  const apply = trpc.comparables.applyToAppraisal.useMutation({ meta: { inlineError: true } });

  // local overlay of adjustment edits for live recompute; persisted onBlur via upsert
  const [edits, setEdits] = useState<Record<string, Partial<Record<AdjKey, number>>>>({});

  /**
   * The subject's coordinates come from the API, which geocodes and caches them
   * alongside this deal's comps. They used to be fetched from api.postcodes.io by
   * the browser, which handed a third party the visitor's IP and left the map
   * blank for anyone behind an ad blocker or a corporate proxy.
   */
  const subject = data?.subject;
  const subjectCoords = subject?.status === 'located' ? { lat: subject.geo.latitude, lng: subject.geo.longitude } : null;

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

  const locatedComps = useMemo(
    () => comps.filter((c): c is typeof c & { lat: number; lng: number } => c.lat != null && c.lng != null),
    [comps],
  );

  const mappable = useMemo(
    () => [
      ...(subjectCoords
        ? [{ lat: subjectCoords.lat, lng: subjectCoords.lng, label: deal?.name ?? 'Subject', sub: deal?.address, kind: 'subject' as const }]
        : []),
      ...locatedComps.map((c) => ({ lat: c.lat, lng: c.lng, label: c.address, sub: c.meta || undefined, kind: 'comp' as const })),
    ],
    [subjectCoords, locatedComps, deal?.name, deal?.address],
  );

  /**
   * Why the subject is not on the map — four different facts that used to share
   * one sentence telling the valuer to add a postcode. Only the first of these
   * is actually about a missing postcode; the others sent people to correct data
   * that was already correct.
   */
  const subjectNote = !subject
    ? 'Locating the site…'
    : subject.status === 'no-postcode'
      ? (
          <>
            No site postcode on this deal yet — add one on the{' '}
            <Link to={`/deal/${dealId}/sitepack`} className="text-brand-ink font-semibold hover:text-brand-ink">
              Site pack
            </Link>{' '}
            to place the subject.
          </>
        )
      : subject.status === 'bad-postcode'
        ? `“${subject.postcode}” isn’t a recognised UK postcode, so the subject can’t be placed.`
        : subject.status === 'unavailable'
          ? 'The postcode lookup is unavailable, so the subject can’t be placed right now — the deal is fine.'
          : '';

  /** rates print in the firm's own unit; the engine and the database hold £/ft² */
  const U = useUnits();
  const supported = comps.length ? Math.round(summary.supportedPsf) : 0;
  const avgGross = summary.avgGrossAdjustment;
  const conf =
    avgGross <= 8
      ? { label: 'High', color: GREEN, bg: 'rgb(var(--tint-success-2, 228 241 234))' }
      : avgGross <= 15
        ? { label: 'Medium', color: AMBER, bg: 'rgb(var(--status-amber-bg, 248 240 222))' }
        : { label: 'Low', color: RED, bg: 'rgb(var(--status-red-bg, 249 234 231))' };

  const setAdj = (id: string, key: AdjKey, v: number) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: v } }));

  /**
   * Only what this person actually changed.
   *
   * `edits[id]` holds exactly the columns they touched, so sending the merged
   * row would write six more from whatever copy the page was holding — and
   * another valuer's adjustment on the same comparable would vanish on blur.
   */
  const persist = (c: (typeof comps)[number]) => {
    const changed = edits[c.id];
    if (!changed || !Object.keys(changed).length) return;
    upsert.mutate({ id: c.id, dealId, ...changed });
  };

  const addComp = () =>
    upsert.mutate({
      dealId,
      address: `Comparable ${comps.length + 1}`,
      meta: 'New evidence — set the base rate and adjustments',
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
        <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14">
          <div className="mt-5 grid grid-cols-1 gap-5 items-start lg:[grid-template-columns:minmax(0,1fr)_360px]">
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
            <Link to={`/deal/${dealId}/appraisal`} className="text-inactive hover:text-brand-ink">{deal?.name ?? 'Deal'}</Link>
            {' / '}Comparable evidence
          </span>
        }
        right={
          comps.length > 0 && (
            <span className="inline-flex items-center rounded-[9px] bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-ink">
              Derived: {U.rate(supported)}
            </span>
          )
        }
      />

      <DealNav dealId={dealId} active="comparables" />
      <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14">
        <div className="mt-5 grid grid-cols-1 gap-5 items-start lg:[grid-template-columns:minmax(0,1fr)_360px]">
          {/* LEFT: adjustment grid + map */}
          <div className="flex flex-col gap-4">
            <Panel
              title={
                <div>
                  <div className="text-[17px] font-bold tracking-[-0.4px]">Sales comparison — adjustment grid</div>
                  <div className="mt-0.5 text-[12.5px] text-ink-3 font-normal">
                    Adjust each comp to the subject; the grid derives a supported £/{U.unit}.
                  </div>
                </div>
              }
              right={
                <Button variant="secondary" onClick={addComp} disabled={upsert.isPending}>
                  <Icon d="M12 5v14|M5 12h14" size={14} color="rgb(var(--brand-ink))" /> Add comp
                </Button>
              }
            >
              {comps.length === 0 ? (
                <EmptyState title="No comparable evidence yet" cta={<Button onClick={addComp} disabled={upsert.isPending}>Add your first comp</Button>}>
                  Add sold comparables to derive a supported £/{U.unit} for the valuation.
                </EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    {/* header */}
                    <div className="flex label-mono text-ink-3 border-b border-border-std">
                      <div className="pb-2 px-2.5" style={{ flex: 2 }}>Comparable</div>
                      <div className="pb-2 px-1.5 text-right" style={{ flex: 1.1 }}>Sale £/{U.unit}</div>
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
                        <div key={c.id} className="flex items-center border-b border-border-faint py-2.5 hover:bg-sunken transition-colors">
                          <div className="px-2.5 min-w-0" style={{ flex: 2 }}>
                            <div className="flex items-center gap-2 min-w-0">
                              <Dot color={PIN} size={9} />
                              <span className="text-[13px] font-semibold truncate">{c.address}</span>
                            </div>
                            <div className="mt-0.5 pl-[17px] text-[10.5px] text-ink-3 truncate">{c.meta}</div>
                          </div>
                          <div className="fig px-1.5 text-right text-[13px] font-semibold" style={{ flex: 1.1 }}>£{U.rateNum(c.basePsf)}</div>
                          {ADJ_COLS.map(([k, label]) => (
                            <div key={k} className="px-1 flex justify-center" style={{ flex: 1 }}>
                              <input
                                type="number"
                                aria-label={`${c.address} ${label} adjustment %`}
                                className="fig w-[52px] h-[30px] p-0 text-center rounded-[7px] text-[11.5px] font-medium"
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
                            <div className="fig text-[14px] font-semibold text-brand-ink">£{U.rateNum(r.adjustedPsf)}</div>
                            <div className="fig text-[10px]" style={{ color: adjColor(r.netAdjustment) }}>{netFmt}</div>
                          </div>
                          {/*
                            Withdraw the comp. Until this existed the only way out of a
                            mistaken comparable was to overwrite it with a different
                            property — and the row went on carrying weight in the
                            supported £/ft² either way.
                          */}
                          <button
                            aria-label={`Remove ${c.address}`}
                            title="Remove this comparable"
                            className="shrink-0 w-7 h-7 mr-1 rounded-[7px] inline-flex items-center justify-center text-ink-3 hover:text-status-red hover:bg-status-red-bg transition-colors"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (confirm(`Remove ${c.address} from the evidence? The supported £/${U.unit} will be recalculated without it.`)) remove.mutate(c.id);
                            }}
                          >
                            <Icon d="M18 6 6 18M6 6l12 12" size={14} color="currentColor" />
                          </button>
                        </div>
                      );
                    })}

                    {/* derived */}
                    <div className="mt-2.5 flex items-center rounded-[10px] bg-tint-success py-3">
                      <div className="px-2.5 text-[13.5px] font-bold text-brand-ink" style={{ flex: 2 }}>Weighted supported value</div>
                      <div style={{ flex: 1.1 }} /><div style={{ flex: 1 }} /><div style={{ flex: 1 }} /><div style={{ flex: 1 }} /><div style={{ flex: 1 }} />
                      <div className="fig px-2.5 text-right text-[16px] font-bold text-brand-ink" style={{ flex: 1.2 }}>£{supported}</div>
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
              {/**
                * The map is drawn whenever ANYTHING can be placed on it.
                *
                * It used to be gated entirely on the subject, so a subject that
                * could not be geocoded threw away every located comparable with
                * it — hiding the evidence the valuer is actually weighing, and
                * printing one sentence ("add the site postcode") for four
                * different situations, only one of which it described.
                */}
              {mappable.length ? (
                <>
                  <SiteMap height={260} pins={mappable} />
                  <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-2 flex-wrap">
                    {subjectCoords ? (
                      <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: 'rgb(var(--brand-ink, 20 80 59))' }} /> Subject</span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: PIN }} /> Comparables ({locatedComps.length} of {comps.length} geolocated)</span>
                  </div>
                  {/* the subject is missing from a map that still has comps on it — say why */}
                  {subjectCoords ? null : <div className="mt-2 text-[11px] text-ink-3">{subjectNote}</div>}
                </>
              ) : (
                <div className="text-[12px] text-ink-3 py-6 text-center">{subjectNote}</div>
              )}
            </Panel>
          </div>

          {/* RIGHT: subject + evidence quality + apply */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-[78px]">
            <div className="rounded-card p-5 text-white shadow-rest" style={{ background: `linear-gradient(155deg,${brand[600]},${brand[700]})` }}>
              <div className="fig text-[10px] font-medium uppercase tracking-[0.7px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Subject</div>
              <div className="mt-1.5 text-[17px] font-semibold">{deal?.name ?? '—'}</div>
              <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {deal ? `${assetLabel(deal.assetType)} · ${deal.address}` : ''}
              </div>
              <div className="mt-4 pt-3.5 flex items-end justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.75)' }}>Supported blended value</span>
                <span className="fig text-[24px] font-semibold tracking-[-1px]">
                  £{U.rateNum(supported)}
                  <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.6)' }}>/{U.unit}</span>
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
                Push the supported {U.rate(supported)} into the revenue tab of the development appraisal.
              </div>
              {apply.isSuccess ? (
                <div className="mt-3">
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-[9px] bg-tint-success-2">
                    <Icon d="M4 12l5 5L20 7" size={15} color={GREEN} strokeWidth={2.5} />
                    <span className="text-[12px] font-semibold text-status-green">
                      Applied — unit caps set to {U.rate(apply.data.supportedPsf)}
                    </span>
                  </div>
                  <Button to={`/deal/${dealId}/appraisal`} size="lg" className="mt-3 w-full">
                    Open appraisal
                    <Icon d="M5 12h14|M13 6l6 6-6 6" size={15} color={onFill} strokeWidth={2.2} />
                  </Button>
                </div>
              ) : (
                <Button writes
                  size="lg"
                  className="mt-3.5 w-full"
                  loading={apply.isPending}
                  disabled={comps.length === 0}
                  onClick={() => apply.mutate(dealId)}
                >
                  {!apply.isPending && (
                    <>
                      Apply &amp; open appraisal
                      <Icon d="M5 12h14|M13 6l6 6-6 6" size={15} color={onFill} strokeWidth={2.2} />
                    </>
                  )}
                </Button>
              )}
              {apply.error && <div className="mt-2 text-[11.5px] text-status-red">{apply.error.message}</div>}
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
