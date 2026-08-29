import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { fM } from '../lib/format';
import { AssetTag, Avatar, Button, Dot, Drawer, EmptyState, Skeleton, Spinner, StatCard, StatusChip, TopBar } from '../components/ui';
import type { StatusKey } from '@apex/ui-tokens';

const STAGES: Array<{ key: string; label: string; accent: string }> = [
  { key: 'SOURCING', label: 'Sourcing', accent: 'rgb(var(--ink-3, 154 160 154))' },
  { key: 'APPRAISAL', label: 'Appraisal', accent: 'rgb(var(--stage-accent, 192 138 46))' },
  { key: 'OFFER', label: 'Offer / Bid', accent: 'rgb(var(--status-blue, 45 91 168))' },
  { key: 'ACQUISITION', label: 'Acquisition', accent: 'rgb(var(--status-green, 30 122 85))' },
  { key: 'CONSTRUCTION', label: 'Construction', accent: 'rgb(var(--brand-ink, 20 80 59))' },
  { key: 'SALES_LETTING', label: 'Sales / Letting', accent: '#1E9E6A' },
  { key: 'COMPLETED', label: 'Completed', accent: 'rgb(var(--ink-2b, 110 114 105))' },
];

const statusChip: Record<string, { key: StatusKey; label: string }> = {
  ESTIMATE: { key: 'neutral', label: 'Estimate' },
  COMMITTED: { key: 'blue', label: 'Committed' },
  ACTUAL: { key: 'green', label: 'Actual' },
};

const FILTERS: Array<[string, string]> = [
  ['all', 'All'],
  ['INDUSTRIAL', 'Industrial'],
  ['RESIDENTIAL', 'Residential'],
  ['COMMERCIAL', 'Commercial'],
  ['MIXED_USE', 'Mixed-use'],
];

const rocColor = (r: number) =>
  r >= 0.2
    ? 'rgb(var(--status-green, 30 122 85))'
    : r >= 0.15
      ? 'rgb(var(--status-amber, 154 98 18))'
      : 'rgb(var(--status-red, 178 58 46))';

export default function Board() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  /**
   * ?new=1 opens the deal form straight away — the Hub's primary call to action
   * links here, and arriving at a page that merely offers the same button again
   * is a step that exists for no reason.
   */
  const [search, setSearch] = useSearchParams();
  const [newOpen, setNewOpen] = useState(search.get('new') === '1');
  useEffect(() => {
    if (search.get('new') !== '1') return;
    setNewOpen(true);
    // drop the parameter so a refresh or a back-navigation does not reopen it
    search.delete('new');
    setSearch(search, { replace: true });
  }, [search, setSearch]);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.deals.list.useQuery({});
  const { data: exposure } = trpc.deals.exposure.useQuery(undefined, { staleTime: 30_000 });
  const setStage = trpc.deals.setStage.useMutation({ onSuccess: () => utils.deals.list.invalidate() });
  const createDeal = trpc.deals.create.useMutation({
    onSuccess: (d) => {
      utils.deals.list.invalidate();
      setNewOpen(false);
      navigate(`/deal/${d.id}/auto`);
    },
  });
  const loadSample = trpc.org.loadSampleDeal.useMutation({
    onSuccess: (res) => {
      utils.deals.list.invalidate();
      navigate(`/deal/${res.dealId}`);
    },
  });
  const [draft, setDraft] = useState({ name: '', address: '', assetType: 'RESIDENTIAL', gdv: 0, probability: 40 });

  const filtered = useMemo(() => {
    let deals = data?.deals ?? [];
    if (filter !== 'all') deals = deals.filter((d) => d.assetType === filter);
    if (q) deals = deals.filter((d) => (d.name + d.address).toLowerCase().includes(q.toLowerCase()));
    return deals;
  }, [data, filter, q]);

  const R = data?.rollup;

  return (
    <div className="min-h-screen">
      <TopBar
        crumb="Pipeline board"
        right={
          <div className="flex items-center gap-2.5 min-w-0 overflow-x-auto sm:overflow-visible">
            <input placeholder="Search deals…" aria-label="Search deals" value={q} onChange={(e) => setQ(e.target.value)} className="w-28 sm:w-44 h-9 shrink-0" />
            <Button className="shrink-0 whitespace-nowrap" onClick={() => setNewOpen(true)}>New deal from documents</Button>
          </div>
        }
      />
      <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-12">
        {/* portfolio roll-up (computed server-side) */}
        {isLoading ? (
          <div className="mt-5 flex gap-3 flex-wrap" role="status" aria-label="Loading">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex-1 min-w-[130px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
                <Skeleton height={10} width="55%" />
                <Skeleton height={21} width="40%" className="mt-2" />
              </div>
            ))}
          </div>
        ) : (
        <div className="mt-5 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[150px] rounded-card p-4 text-white shadow-rest" style={{ background: 'linear-gradient(135deg,#1B6048,#14503B)' }}>
            <div className="font-mono uppercase text-[10px] tracking-[1.2px] text-accent-muted-3 font-semibold">Pipeline GDV</div>
            <div className="fig mt-1.5 text-[21px] font-semibold tracking-[-1px] text-accent-300">{R ? fM(R.pipelineGdv) : '—'}</div>
          </div>
          <StatCard label="Wtd. GDV" value={R ? fM(R.weightedGdv) : '—'} />
          <StatCard label="Forecast profit" value={R ? fM(R.forecastProfit) : '—'} tone="rgb(var(--status-green, 30 122 85))" />
          <StatCard label="Equity required" value={R ? fM(R.equityRequired) : '—'} />
          <StatCard label="Active deals" value={R ? String(R.activeCount) : '—'} />
        </div>
        )}

        {/* Exposure — the lender's question, which no per-deal figure answers:
            how much of the book is riding on one scheme, one asset class, one
            town. Shown only once there is a book to have a shape. */}
        {exposure && exposure.totals.deals > 1 && (
          <section className="mt-4 bg-surface border border-border-strong rounded-panel shadow-rest p-4" data-exposure>
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <span className="text-[13px] font-semibold">Debt exposure</span>
              <span className="text-[11px] text-ink-3">
                {exposure.totals.deals} funded {exposure.totals.deals === 1 ? 'deal' : 'deals'} · recomputed from each appraisal
              </span>
            </div>
            <div className="mt-3 flex gap-5 flex-wrap">
              {([
                ['Facility', fM(exposure.totals.facility), null],
                ['Drawn', fM(exposure.totals.drawn), null],
                ['Undrawn', fM(exposure.totals.undrawn), null],
                [
                  'Utilisation',
                  `${Math.round(exposure.totals.utilisation * 100)}%`,
                  // drawn beyond the appraised facility is the single most
                  // important thing on this panel. Left as a bare "108%" it reads
                  // as a rounding glitch; said out loud it is the finding a lender
                  // opened the page for.
                  exposure.totals.utilisation > 1 ? 'over facility' : null,
                ],
                ['Loan to GDV', `${Math.round(exposure.totals.loanToGdv * 100)}%`, null],
              ] as Array<[string, string, string | null]>).map(([k, v, warn]) => (
                <div key={k}>
                  <div className="text-[10px] uppercase tracking-wide text-ink-3">{k}</div>
                  <div
                    className="fig text-[15px] font-semibold"
                    style={warn ? { color: 'rgb(var(--status-red, 178 58 46))' } : undefined}
                  >
                    {v}
                  </div>
                  {warn && <div className="text-[10px]" style={{ color: 'rgb(var(--status-red, 178 58 46))' }}>{warn}</div>}
                </div>
              ))}
            </div>
            {/* Covenant breaches: the firm's own limits, tested against each
                deal. Absent limits, nothing appears — the ratios are still on the
                panel, they are simply not judged. */}
            {exposure.positions.some((p) => (p.covenants?.breaches.length ?? 0) > 0) && (
              <div className="mt-3 pt-3 border-t border-border-std">
                <div className="text-[11px] uppercase tracking-wide" style={{ color: 'rgb(var(--status-red, 178 58 46))' }}>
                  Covenant breaches
                </div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {exposure.positions
                    .filter((p) => (p.covenants?.breaches.length ?? 0) > 0)
                    .map((p) => (
                      <div key={p.dealId} className="text-[12px]">
                        <span className="font-semibold">{p.name}</span>
                        {p.covenants!.breaches.map((b) => (
                          <span key={b.key} className="text-ink-2">
                            {' '}— {b.label} {b.actualPct.toFixed(1)}% against a{' '}
                            {b.direction === 'max' ? 'maximum' : 'minimum'} of {b.limitPct}%
                            <span className="fig" style={{ color: 'rgb(var(--status-red, 178 58 46))' }}>
                              {/* a real minus sign, as everywhere else in the product */}
                              {' '}({b.headroomPts < 0 ? '−' : ''}{Math.abs(b.headroomPts).toFixed(1)} pts)
                            </span>
                          </span>
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Deals drawing ahead of the works. Named individually because
                "one deal is overspending" is not actionable and "Harbour Reach is
                £250k ahead of its works" is. */}
            {exposure.positions.some((p) => p.drawdown?.status === 'overspending') && (
              <div className="mt-3 pt-3 border-t border-border-std">
                <div className="text-[11px] uppercase tracking-wide text-ink-3">Drawn ahead of works</div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {exposure.positions
                    .filter((p) => p.drawdown?.status === 'overspending')
                    .map((p) => (
                      <div key={p.dealId} className="text-[12px]">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-ink-2">
                          {' '}— {fM(p.drawn)} committed against {fM(p.drawdown!.expectedByProgress)} of works
                        </span>
                        <span className="fig" style={{ color: 'rgb(var(--status-red, 178 58 46))' }}>
                          {' '}+{fM(p.drawdown!.varianceOnProgress)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {exposure.largest && (
              <div className="mt-3 pt-3 border-t border-border-std text-[12px]">
                <span className="text-ink-2">Largest concentration: </span>
                <span className="font-semibold">
                  {Math.round(exposure.largest.share * 100)}% in{' '}
                  {exposure.largest.dimension === 'deal'
                    ? exposure.largest.key
                    : exposure.largest.dimension === 'region'
                      ? `postcode area ${exposure.largest.key}`
                      : exposure.largest.key.toLowerCase().replace('_', ' ')}
                </span>
                {/* a threshold worth stating rather than leaving to be eyeballed */}
                {exposure.largest.share >= 0.4 && (
                  <span style={{ color: 'rgb(var(--status-amber, 133 82 14))' }}> · above 40% of the book</span>
                )}
              </div>
            )}
          </section>
        )}

        {/* asset-type filters */}
        <div className="mt-4 flex gap-2 flex-wrap">
          {FILTERS.map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="inline-flex items-center rounded-pill border px-3.5 py-1.5 min-h-[40px] sm:min-h-0 text-[12.5px] font-semibold transition-colors"
                style={on ? { background: '#14503B', color: '#fff', borderColor: 'rgb(var(--brand-ink))' } : { background: 'rgb(var(--surface, 255 255 255))', color: 'rgb(var(--ink-2, 75 81 75))', borderColor: 'rgb(var(--control-border, 139 147 141))' }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* first-deal onboarding for fresh workspaces */}
        {data && data.deals.length === 0 && (
          <div className="mt-6 border border-dashed border-[rgb(var(--dashed,218_217_210))] rounded-panel bg-surface p-8 text-center">
            <div className="text-[15px] font-semibold">Your pipeline is empty</div>
            <p className="mt-1.5 text-[12.5px] text-ink-2">Add your first deal — it takes under a minute, and the AI appraisal does the heavy lifting.</p>
            <div className="mt-4 flex items-center justify-center gap-2.5 flex-wrap">
              <Button onClick={() => setNewOpen(true)}>New deal from documents</Button>
              <Button writes variant="secondary" loading={loadSample.isPending} onClick={() => loadSample.mutate()}>
                Explore with a sample deal
              </Button>
            </div>
          </div>
        )}

        {/* lifecycle board */}
        {isLoading ? (
          <div className="mt-5 flex gap-3.5 overflow-x-auto pb-4 items-start" role="status" aria-label="Loading">
            {Array.from({ length: 4 }, (_, col) => (
              <div key={col} className="w-[264px] shrink-0">
                <div className="flex items-center gap-2 px-1 pb-2.5">
                  <Skeleton height={12} width="45%" />
                </div>
                <div className="flex flex-col gap-2.5">
                  {Array.from({ length: 3 - (col % 2) }, (_, i) => (
                    <div key={i} className="bg-surface border border-border-strong rounded-card shadow-rest p-3.5">
                      <Skeleton height={13} width="70%" />
                      <Skeleton height={10} width="50%" className="mt-2" />
                      <Skeleton height={12} width="100%" className="mt-3" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 flex gap-3.5 overflow-x-auto pb-4 items-start">
            {STAGES.map((st) => {
              const cards = filtered.filter((d) => d.stage === st.key);
              const stageGdv = cards.reduce((a, d) => a + d.gdv, 0);
              return (
                <section key={st.key} className="w-[264px] shrink-0">
                  <header className="flex items-center gap-2 px-1 pb-2.5">
                    <Dot color={st.accent} />
                    <span className="text-[12.5px] font-semibold">{st.label}</span>
                    <span className="fig text-[11px] text-ink-3">{cards.length}</span>
                    <span className="fig ml-auto text-[11px] text-ink-3">{cards.length ? fM(stageGdv) : '—'}</span>
                  </header>
                  <div className="flex flex-col gap-2.5">
                    {cards.length === 0 && <EmptyState>No deals at this stage</EmptyState>}
                    {cards.map((d) => {
                      const chip = statusChip[d.figureStatus] ?? statusChip.ESTIMATE;
                      return (
                        <Link
                          key={d.id}
                          to={`/deal/${d.id}`}
                          className="block bg-surface border border-border-strong rounded-card shadow-rest p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-float"
                          style={{ borderTop: `3px solid ${st.accent}` }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[13px] font-semibold leading-tight min-w-0 flex-1">{d.name}</div>
                            <StatusChip status={chip.key} label={chip.label} />
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-3 truncate" title={d.address}>{d.address}</div>
                          <div className="mt-2"><AssetTag type={d.assetType} /></div>
                          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                            {(
                              [
                                ['GDV', fM(d.gdv), undefined],
                                ['Profit', fM(d.forecastProfit), undefined],
                                ['RoC', `${Math.round(d.roc * 100)}%`, rocColor(d.roc)],
                              ] as Array<[string, string, string | undefined]>
                            ).map(([l, v, tone]) => (
                              <div key={l}>
                                <div className="label-mono text-ink-3">{l}</div>
                                <div className="fig text-[12.5px] font-semibold" style={tone ? { color: tone } : undefined}>{v}</div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2.5 pt-2 border-t border-border-faint flex items-center gap-1.5">
                            <Dot color={rocColor(d.roc)} size={6} />
                            <span className="text-[11px] text-ink-2 min-w-0 flex-1 truncate">{d.nextMilestone ?? '—'}</span>
                            <span className="ml-auto">{d.owner && <Avatar initials={d.owner.initials} size={22} />}</span>
                          </div>
                          {st.key !== 'COMPLETED' && (
                            <button
                              className="mt-2 w-full text-[10.5px] label-mono text-ink-3 hover:text-brand-ink text-center cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-default"
                              disabled={setStage.isPending}
                              onClick={(e) => {
                                e.preventDefault();
                                const next = STAGES[Math.min(STAGES.findIndex((s) => s.key === st.key) + 1, STAGES.length - 1)].key;
                                setStage.mutate({ id: d.id, stage: next as never });
                              }}
                            >
                              {setStage.isPending && setStage.variables?.id === d.id ? <Spinner /> : <>Advance stage →</>}
                            </button>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      {/* New deal drawer */}
      <Drawer open={newOpen} onClose={() => setNewOpen(false)} title="New deal">
        <div className="flex flex-col gap-3">
          <label className="label-mono text-ink-3" htmlFor="new-deal-name">Deal name</label>
          <input id="new-deal-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Foundry Lane" />
          <label className="label-mono text-ink-3" htmlFor="new-deal-address">Address</label>
          <input id="new-deal-address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Street, town" />
          <label className="label-mono text-ink-3" htmlFor="new-deal-asset-type">Asset type</label>
          <select id="new-deal-asset-type" value={draft.assetType} onChange={(e) => setDraft({ ...draft, assetType: e.target.value })}>
            {FILTERS.slice(1).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <label className="label-mono text-ink-3" htmlFor="new-deal-gdv">Indicative GDV (£)</label>
          <input id="new-deal-gdv" type="number" value={draft.gdv || ''} onChange={(e) => setDraft({ ...draft, gdv: parseFloat(e.target.value) || 0 })} />
          <label className="label-mono text-ink-3" htmlFor="new-deal-probability">Probability %</label>
          <input id="new-deal-probability" type="number" value={draft.probability} onChange={(e) => setDraft({ ...draft, probability: parseInt(e.target.value) || 0 })} />
          <div className="mt-2 flex gap-2">
            <Button writes
              loading={createDeal.isPending}
              disabled={!draft.name || !draft.address}
              onClick={() =>
                createDeal.mutate({
                  name: draft.name,
                  address: draft.address,
                  assetType: draft.assetType as never,
                  gdv: draft.gdv,
                  probability: draft.probability,
                  stage: 'SOURCING',
                  forecastProfit: 0,
                  equityRequired: 0,
                })
              }
            >
              Create & appraise from documents
            </Button>
            <Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
