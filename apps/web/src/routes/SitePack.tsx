import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { SQFT_PER_SQM } from '@apex/appraisal-engine';
import { useUnits } from '../lib/region';
import { useToast } from '../components/Toast';
import { Button, Dot, EmptyState, Panel, Skeleton, SkeletonRows, Spinner, StatCard, StatusChip, Td, Th, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';
import { SiteMap, type MapPin } from '../components/SiteMap';
import { brand, brandInk, neutral, onFill } from '@apex/ui-tokens';

const CONSTRAINT_LABELS: Record<string, string> = {
  'conservation-area': 'Conservation area',
  'green-belt': 'Green belt',
  'flood-risk-zone': 'Flood risk zone',
  'listed-building-outline': 'Listed building',
  'article-4-direction-area': 'Article 4 direction',
  'tree-preservation-zone': 'Tree preservation',
  'area-of-outstanding-natural-beauty': 'AONB',
  'site-of-special-scientific-interest': 'SSSI',
  'scheduled-monument': 'Scheduled monument',
  'brownfield-land': 'Brownfield register',
};

const fdate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const AMENITY_META: Record<string, [string, string]> = {
  station: ['Stations', '🚉'],
  school: ['Schools', '🎓'],
  supermarket: ['Supermarkets', '🛒'],
  pharmacy: ['Pharmacies', '💊'],
};

export default function SitePack() {
  /** floor areas and rates in the firm's own unit — words and units only */
  const U = useUnits();
  const { dealId = '' } = useParams();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [postcodeInput, setPostcodeInput] = useState('');
  const [postcodeOverride, setPostcodeOverride] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [companyQ, setCompanyQ] = useState('');
  const [companyQuery, setCompanyQuery] = useState('');
  const [companyNo, setCompanyNo] = useState<string | null>(null);
  const companySearch = trpc.sitePack.companySearch.useQuery({ q: companyQuery }, { enabled: companyQuery.length >= 2, retry: 0 });
  const company = trpc.sitePack.company.useQuery({ companyNumber: companyNo ?? '' }, { enabled: !!companyNo, retry: 0 });

  const { data, isLoading, isFetching, refetch } = trpc.sitePack.get.useQuery(
    { dealId, postcode: postcodeOverride },
    { enabled: !!dealId, staleTime: 60_000, retry: 0 },
  );
  const apply = trpc.sitePack.applyComps.useMutation({
    onSuccess: (res) => {
      toast.success(`Imported ${res.created} comparable${res.created === 1 ? '' : 's'} from HM Land Registry`);
      setSelected(new Set());
      utils.comparables.list.invalidate(dealId);
      utils.documents.activity.invalidate(dealId);
    },
  });

  const ok = data?.status === 'ok' ? data : null;

  /**
   * A panel that missed the server's deadline is still being fetched behind the
   * request, and lands in the shared cache when it arrives. So the page asks
   * once more, shortly — which is why the first open of a slow site fills in
   * rather than staying half-drawn, and why nobody waits eleven seconds for the
   * Environment Agency before seeing the sold prices that arrived in 400ms.
   */
  useEffect(() => {
    if (!ok?.incomplete) return;
    const t = setTimeout(() => void refetch(), 4_000);
    return () => clearTimeout(t);
  }, [ok?.incomplete, ok?.fetchedAt, refetch]);

  /**
   * When the data was actually fetched, said out loud on anything served from
   * the shared cache. Without it the screen implies every panel was pulled the
   * moment it was opened — which on a site pack that now answers in a fraction
   * of a second would be a claim about the Land Registry, not about us.
   */
  const asAtNote = (asAt?: string) => {
    if (!asAt) return null;
    const ageMs = Date.now() - new Date(asAt).getTime();
    if (ageMs < 60_000) return null; // fetched during this request; nothing to caveat
    const d = new Date(asAt);
    return ` Data as at ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`;
  };

  /** "still coming" and "refused" are different statements to a valuer. */
  const stateNote = (status: string, source: string) =>
    status === 'slow' ? `Still fetching from ${source} — this panel fills in shortly.` : `${source} unreachable right now.`;
  const soldItems = ok?.soldPrices.status === 'ok' ? ok.soldPrices.items : [];
  const keyOf = (s: { address: string; date: string; price: number }) => `${s.address}|${s.date}|${s.price}`;
  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else if (next.size < 10) next.add(k);
      return next;
    });

  /**
   * Saving the postcode is a MUTATION, and used to happen inside the lookup.
   *
   * `sitePack.get` is a query and it persisted whatever postcode it was passed,
   * which put a write outside both sweeps that guard writes — measured, a
   * VIEWER could move a scheme to a different postcode and nothing recorded it.
   * `deals.update` already takes a postcode, refuses a viewer and records what
   * changed, so the deal is edited through it and the lookup only reads.
   */
  const saveDeal = trpc.deals.update.useMutation({
    onSuccess: () => {
      void utils.deals.get.invalidate(dealId);
      void refetch();
    },
  });

  const runLookup = () => {
    const pc = postcodeInput.trim();
    if (!pc) {
      void refetch();
      return;
    }
    setPostcodeOverride(pc);
    // adopt it onto the deal only when it differs — an unchanged value would
    // otherwise write an "edited deal details" line every time somebody looked
    if (pc.toUpperCase() !== (ok?.geo.postcode ?? '').toUpperCase()) {
      saveDeal.mutate({ id: dealId, patch: { postcode: pc } });
    } else {
      void refetch();
    }
  };

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to={`/deal/${dealId}`} className="text-inactive hover:text-brand-ink">{data?.dealName ?? 'Deal'}</Link>
            {' / '}Site pack
          </span>
        }
        right={
          ok && (
            <span className="inline-flex items-center gap-2 rounded-[9px] bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-ink">
              <Dot color="rgb(var(--status-green, 30 122 85))" /> Live public data · {ok.geo.postcode}
            </span>
          )
        }
      />
      <DealNav dealId={dealId} active="sitepack" />

      <main className="max-w-[1480px] mx-auto px-6 pb-14">
        <div className="mt-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Public record</div>
            <h1 className="mt-1.5 text-[32px] font-bold tracking-[-1.2px]">Site pack</h1>
            <div className="mt-1 text-[13.5px] text-ink-2 max-w-[560px]">
              Real sold prices, planning constraints and flood zones for this site — pulled live from
              HM Land Registry and planning.data.gov.uk, with provenance on every figure.
            </div>
          </div>
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="label-mono text-ink-3 block mb-1">Site postcode</span>
              <input
                className="w-36 fig uppercase"
                placeholder={ok?.geo.postcode ?? 'e.g. BH8 8EW'}
                value={postcodeInput}
                onChange={(e) => setPostcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runLookup()}
              />
            </label>
            <Button onClick={runLookup} loading={isFetching}>
              Pull live data
            </Button>
          </div>
        </div>

        {isLoading ? (
          <>
            <div className="mt-6 flex items-center gap-3">
              <Spinner />
              <div className="text-[12.5px] text-ink-3">Querying HM Land Registry · planning.data.gov.uk · postcodes.io…</div>
            </div>
            {/* stat strip skeleton */}
            <div className="mt-4 flex gap-3 flex-wrap">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex-1 min-w-[130px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
                  <Skeleton height={10} width="55%" />
                  <Skeleton height={20} width="70%" className="mt-2" />
                </div>
              ))}
            </div>
            {/* sold-price table + map placeholder skeletons */}
            <div className="mt-5 grid gap-4 lg:[grid-template-columns:minmax(0,1fr)_360px]">
              <Panel>
                <Skeleton height={18} width={260} />
                <div className="mt-4">
                  <SkeletonRows rows={8} height={16} />
                </div>
              </Panel>
              <div className="flex flex-col gap-4">
                <Panel>
                  <Skeleton height={260} className="rounded-[10px]" />
                </Panel>
                <Panel>
                  <SkeletonRows rows={3} height={14} />
                </Panel>
              </div>
            </div>
          </>
        ) : data?.status === 'no-postcode' ? (
          <div className="mt-8">
            <EmptyState>
              No postcode on this deal yet — enter the site postcode above and pull the public record.
            </EmptyState>
          </div>
        ) : data?.status === 'bad-postcode' ? (
          <div className="mt-8">
            <EmptyState>“{data.postcode}” isn’t a recognised UK postcode — check it and try again.</EmptyState>
          </div>
        ) : data?.status === 'unavailable' ? (
          /**
           * Not the same sentence as bad-postcode, deliberately. This screen used
           * to tell a valuer their postcode was wrong whenever the geocoder was
           * merely unreachable — sending them to correct data that was already
           * correct. The postcode is theirs; the outage is ours.
           */
          <div className="mt-8">
            <EmptyState>
              The postcode lookup is unavailable right now, so “{data.postcode}” could not be placed. Nothing is wrong
              with the deal — try again shortly.
            </EmptyState>
          </div>
        ) : ok ? (
          <>
            {/* location strip */}
            <div className="mt-6 flex gap-3 flex-wrap">
              <StatCard label="Postcode" value={ok.geo.postcode} />
              <StatCard label="District" value={<span className="text-[15px]">{ok.geo.district}</span>} />
              <StatCard label="Region" value={<span className="text-[15px]">{ok.geo.region}</span>} />
              <StatCard label="Sold records" value={String(soldItems.length)} tone="rgb(var(--brand-ink, 20 80 59))" />
              <StatCard
                label="Constraints hit"
                value={String(ok.constraints.hits.length)}
                tone={ok.constraints.hits.length ? 'rgb(var(--status-amber, 154 98 18))' : 'rgb(var(--status-green, 30 122 85))'}
              />
            </div>

            <div className="mt-5 grid gap-4 lg:[grid-template-columns:minmax(0,1fr)_360px]">
              {/* sold prices */}
              <Panel
                title="Sold prices — HM Land Registry"
                right={
                  <Button writes
                    loading={apply.isPending}
                    disabled={selected.size === 0}
                    onClick={() =>
                      apply.mutate({
                        dealId,
                        comps: soldItems
                          .filter((s) => selected.has(keyOf(s)))
                          .map((s) => ({ address: s.address, date: s.date, price: s.price, propertyType: s.propertyType, psf: s.psf, lat: s.lat, lng: s.lng })),
                      })
                    }
                  >
                    {`Add ${selected.size || ''} as comparables`}
                  </Button>
                }
              >
                {ok.soldPrices.status !== 'ok' ? (
                  <EmptyState>{stateNote(ok.soldPrices.status, 'HM Land Registry')}</EmptyState>
                ) : soldItems.length === 0 ? (
                  <EmptyState>No sold-price records within ~1km of {ok.geo.postcode} in the Price Paid dataset.</EmptyState>
                ) : (
                  <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
                    <table className="w-full min-w-[640px]">
                      <thead className="sticky top-0 bg-surface">
                        <tr>
                          <Th className="w-8" />
                          <Th>Address</Th>
                          <Th right>Sold</Th>
                          <Th right>Price</Th>
                          <Th right>£/{U.unit}</Th>
                          <Th>Type</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {soldItems.map((s) => {
                          const k = keyOf(s);
                          return (
                            <tr key={k} className="hover:bg-sunken cursor-pointer" onClick={() => toggle(k)}>
                              <Td>
                                <button
                                  type="button"
                                  aria-label={`Select ${s.address}`}
                                  aria-pressed={selected.has(k)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(k);
                                  }}
                                  className="inline-flex w-[15px] h-[15px] rounded-[4px] border items-center justify-center"
                                  style={{ background: selected.has(k) ? brand[700] : neutral.surface, borderColor: selected.has(k) ? brand[700] : 'rgb(var(--checkbox-border, 210 209 202))' }}
                                >
                                  {selected.has(k) && (
                                    <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={onFill} strokeWidth="3.2"><path d="M4 12l5 5L20 7" /></svg>
                                  )}
                                </button>
                              </Td>
                              <Td>
                                <div className="text-[12px] font-medium leading-tight">{s.address}</div>
                                <div className="text-[10px] text-ink-3 fig">{s.postcode}{s.newBuild ? ' · new build' : ''}{s.estateType ? ` · ${s.estateType}` : ''}</div>
                              </Td>
                              <Td right fig className="whitespace-nowrap text-[11.5px]">{fdate(s.date)}</Td>
                              <Td right fig className="font-semibold">£{Math.round(s.price).toLocaleString('en-GB')}</Td>
                              <Td right fig>{s.psf ? `£${s.psf}` : <span className="text-ink-3b">—</span>}</Td>
                              <Td><span className="text-[11px] text-ink-2 capitalize">{s.propertyType.replace(/-/g, ' ')}</span></Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3 text-[10.5px] text-ink-3">
                  Contains HM Land Registry data © Crown copyright, licensed under the Open Government Licence v3.0.
                  £/{U.unit} shown where an EPC floor-area match exists.
                </div>
              </Panel>

              {/* right rail: map + constraints + EPC */}
              <div className="flex flex-col gap-4">
                <Panel title="Location of evidence">
                  <SiteMap
                    height={260}
                    pins={[
                      { lat: ok.geo.latitude, lng: ok.geo.longitude, label: ok.dealName, sub: `${ok.address} · subject site`, kind: 'subject' as const },
                      ...soldItems
                        .filter((s): s is typeof s & { lat: number; lng: number } => s.lat != null && s.lng != null)
                        .slice(0, 30)
                        .map((s): MapPin => ({
                          lat: s.lat,
                          lng: s.lng,
                          label: s.address,
                          sub: `£${Math.round(s.price).toLocaleString('en-GB')} · ${fdate(s.date)}`,
                          kind: 'comp' as const,
                        })),
                    ]}
                  />
                  <div className="mt-2 flex gap-4 text-[11px] text-ink-2">
                    <span className="inline-flex items-center gap-1.5"><Dot color={brandInk} /> Subject site</span>
                    <span className="inline-flex items-center gap-1.5"><Dot color={brand[400]} /> Sold within ~1km</span>
                  </div>
                </Panel>

                <Panel title="Planning constraints">
                  {ok.constraints.status !== 'ok' ? (
                    <EmptyState>planning.data.gov.uk is unreachable right now.</EmptyState>
                  ) : ok.constraints.hits.length === 0 ? (
                    <div className="rounded-[10px] bg-tint-success-2 px-3.5 py-3 text-[12.5px] text-brand-ink font-medium">
                      Clean screen — none of the {ok.constraints.checked.length} constraint layers intersect this point.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {ok.constraints.hits.map((h, i) => (
                        <div key={i} className="flex items-start gap-2.5 rounded-[10px] bg-status-amber-bg px-3 py-2.5">
                          <Dot color="rgb(var(--status-amber-dot, 199 169 91))" size={7} />
                          <div>
                            <div className="text-[12.5px] font-semibold text-status-amber">
                              {CONSTRAINT_LABELS[h.dataset] ?? h.dataset}
                            </div>
                            <div className="text-[11px] text-ink-2">{h.name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {ok.constraints.checked.map((c) => (
                      <span key={c} className="label-mono text-ink-3 bg-sunken-2 rounded-[5px] px-1.5 py-[2px]">
                        {CONSTRAINT_LABELS[c] ?? c}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-[10.5px] text-ink-3">
                    Source: planning.data.gov.uk (OGL). Screening only — not a legal search.
                    {ok.constraints.status === 'ok' && asAtNote((ok.constraints as { asAt?: string }).asAt)}
                  </div>
                </Panel>

                <Panel title="EPC register" right={<StatusChip status={ok.epc.status === 'ok' ? 'green' : 'neutral'} label={ok.epc.status === 'ok' ? 'LIVE' : 'NOT CONFIGURED'} />}>
                  {ok.epc.status === 'ok' ? (
                    ok.epc.records.length === 0 ? (
                      <EmptyState>No EPC records for {ok.geo.postcode}.</EmptyState>
                    ) : (
                      <div className="flex flex-col max-h-[260px] overflow-y-auto">
                        {ok.epc.records.slice(0, 12).map((r, i) => (
                          <div key={i} className="flex items-center gap-2.5 py-1.5 border-t border-border-faint first:border-t-0">
                            <span className="fig w-6 h-6 rounded-[6px] bg-tint-success-2 text-brand-ink text-[11px] font-semibold inline-flex items-center justify-center">
                              {r.rating || '—'}
                            </span>
                            <span className="flex-1 min-w-0 truncate text-[11.5px] leading-tight">{r.address}</span>
                            {/* the register states square metres; SQFT_PER_SQM is the engine's,
                                not a second copy of it — see appraisal-engine/src/format.ts */}
                            <span className="fig text-[11px] text-ink-2 whitespace-nowrap">{U.area(r.floorAreaSqm * SQFT_PER_SQM)}</span>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="text-[12px] text-ink-2 leading-relaxed">
                      {ok.epc.note ?? 'EPC lookups need a free API key.'}
                      <div className="mt-1.5 text-[11px] text-ink-3">
                        With EPC connected, sold prices gain automatic £/{U.unit} from matched floor areas.
                      </div>
                    </div>
                  )}
                </Panel>

                {/*
                  The chip used to read NONE — a green all-clear — whenever the
                  feed failed, because it was driven by an empty item list rather
                  than by whether anything had been checked. "No warnings" and
                  "not checked" are the same picture and opposite facts, on the
                  panel a valuer would quote to a lender.
                */}
                <Panel
                  title="Live flood warnings"
                  right={
                    <StatusChip
                      status={ok.floodWarnings.status !== 'ok' ? 'neutral' : ok.floodWarnings.items.length ? 'red' : 'green'}
                      label={
                        ok.floodWarnings.status === 'slow'
                          ? 'CHECKING'
                          : ok.floodWarnings.status !== 'ok'
                            ? 'UNAVAILABLE'
                            : ok.floodWarnings.items.length
                              ? 'ACTIVE'
                              : 'NONE'
                      }
                    />
                  }
                >
                  {ok.floodWarnings.status !== 'ok' ? (
                    <div className="text-[11.5px] text-ink-3">{stateNote(ok.floodWarnings.status, 'The Environment Agency feed')}</div>
                  ) : ok.floodWarnings.items.length === 0 ? (
                    <div className="rounded-[10px] bg-tint-success-2 px-3.5 py-3 text-[12.5px] text-brand-ink font-medium">
                      No live flood warnings within 10km of the site.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {ok.floodWarnings.items.map((w, i) => (
                        <div key={i} className="rounded-[10px] px-3 py-2.5" style={{ background: w.severityLevel <= 2 ? 'rgb(var(--status-red-bg, 249 234 231))' : 'rgb(var(--status-amber-bg, 248 240 222))' }}>
                          <div className="text-[12px] font-semibold" style={{ color: w.severityLevel <= 2 ? 'rgb(var(--status-red, 178 58 46))' : 'rgb(var(--status-amber, 154 98 18))' }}>{w.severity}</div>
                          <div className="text-[11px] text-ink-2">{w.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-[10.5px] text-ink-3">
                    Source: Environment Agency real-time flood monitoring (OGL).
                    {ok.floodWarnings.status === 'ok' && asAtNote((ok.floodWarnings as { asAt?: string }).asAt)}
                  </div>
                </Panel>

                <Panel title="Walkable amenities · 800m">
                  {ok.amenities.status !== 'ok' ? (
                    <div className="text-[11.5px] text-ink-3">{stateNote(ok.amenities.status, 'The OpenStreetMap amenity lookup')}</div>
                  ) : ok.amenities.items.length === 0 ? (
                    <div className="text-[11.5px] text-ink-3">No stations, schools, supermarkets or pharmacies mapped within 800m.</div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(AMENITY_META).map(([kind, [label, glyph]]) => {
                          const n = ok.amenities.items.filter((a) => a.kind === kind).length;
                          if (!n) return null;
                          return (
                            <span key={kind} className="inline-flex items-center gap-1.5 rounded-[9px] bg-sunken-2 px-2.5 py-1.5 text-[11.5px] font-medium">
                              <span aria-hidden="true">{glyph}</span> {n} {label.toLowerCase()}
                            </span>
                          );
                        })}
                      </div>
                      <div className="mt-2.5 flex flex-col gap-1 max-h-[120px] overflow-y-auto">
                        {ok.amenities.items.slice(0, 8).map((a, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11.5px] text-ink-2 min-w-0">
                            <span aria-hidden="true">{AMENITY_META[a.kind]?.[1]}</span>
                            <span className="truncate">{a.name}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="mt-2 text-[10.5px] text-ink-3">
                    Source: OpenStreetMap contributors (ODbL).
                    {ok.amenities.status === 'ok' && asAtNote((ok.amenities as { asAt?: string }).asAt)}
                  </div>
                </Panel>

                <Panel title="Counterparty check" right={<StatusChip status={companySearch.data?.status === 'not-configured' ? 'neutral' : 'green'} label={companySearch.data?.status === 'not-configured' ? 'KEY NEEDED' : 'COMPANIES HOUSE'} />}>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 min-w-0"
                      placeholder="Search a company, e.g. the vendor"
                      aria-label="Company search"
                      value={companyQ}
                      onChange={(e) => setCompanyQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setCompanyNo(null); setCompanyQuery(companyQ.trim()); } }}
                    />
                    <Button variant="secondary" disabled={companyQ.trim().length < 2} onClick={() => { setCompanyNo(null); setCompanyQuery(companyQ.trim()); }}>
                      Search
                    </Button>
                  </div>
                  {companySearch.data?.status === 'not-configured' && (
                    <div className="mt-2.5 text-[11.5px] text-ink-2 leading-relaxed">{companySearch.data.note}</div>
                  )}
                  {companySearch.isFetching && <div className="mt-3"><Spinner /></div>}
                  {companySearch.data?.status === 'ok' && !companyNo && (
                    <div className="mt-2.5 flex flex-col gap-1">
                      {companySearch.data.results.length === 0 && <div className="text-[11.5px] text-ink-3">No companies matched.</div>}
                      {companySearch.data.results.map((c) => (
                        <button key={c.companyNumber} className="text-left rounded-[9px] px-2.5 py-2 hover:bg-sunken transition-colors" onClick={() => setCompanyNo(c.companyNumber)}>
                          <div className="text-[12px] font-semibold truncate">{c.name}</div>
                          <div className="fig text-[10px] text-ink-3">{c.companyNumber} · {c.status} · {c.address}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {companyNo && company.data && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold truncate">{company.data.summary.name}</span>
                        <StatusChip status={company.data.summary.status === 'active' ? 'green' : 'red'} label={company.data.summary.status.toUpperCase()} />
                      </div>
                      <div className="fig mt-1 text-[10.5px] text-ink-3">{company.data.summary.companyNumber} · inc. {company.data.summary.incorporated} · {company.data.summary.address}</div>
                      {company.data.accountsOverdue && <div className="mt-2 rounded-[8px] bg-status-red-bg px-2.5 py-1.5 text-[11px] font-semibold text-status-red">Accounts overdue</div>}
                      <div className="mt-2.5 label-mono text-ink-3">Officers</div>
                      {company.data.officers.map((o, i) => (
                        <div key={i} className="text-[11.5px] text-ink-2 py-0.5">{o.name} · {o.role}</div>
                      ))}
                      {/*
                        "at least" when the register holds more charges than one
                        page returned. The count used to be taken from the three
                        rows below and printed as though it were the whole
                        register — on the panel that says how much of a
                        counterparty's assets a lender already holds.
                      */}
                      <div className="mt-2.5 label-mono text-ink-3">
                        Charges · {company.data.charges.complete ? '' : 'at least '}
                        {company.data.charges.outstanding} outstanding of {company.data.charges.total}
                      </div>
                      {company.data.charges.items.slice(0, 3).map((c, i) => (
                        <div key={i} className="text-[11.5px] text-ink-2 py-0.5 min-w-0">
                          <span className={c.status === 'outstanding' ? 'text-status-red font-medium' : ''}>{c.status}</span> · {c.personsEntitled.join(', ') || c.description}
                        </div>
                      ))}
                      <button className="mt-2 text-[11.5px] font-semibold text-brand-ink hover:text-brand-ink" onClick={() => setCompanyNo(null)}>← Back to results</button>
                    </div>
                  )}
                  <div className="mt-2 text-[10.5px] text-ink-3">Source: Companies House public data.</div>
                </Panel>

                <div className="text-[11px] text-ink-3 leading-relaxed px-1">
                  Fetched {new Date(ok.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                  <Link to={`/deal/${dealId}/comparables`} className="text-brand-ink font-semibold hover:text-brand-ink">
                    Open comparables →
                  </Link>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-8"><EmptyState>Couldn’t load the site pack — try again.</EmptyState></div>
        )}
      </main>
    </div>
  );
}
