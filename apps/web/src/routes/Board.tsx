import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { fM } from '../lib/format';
import { AssetTag, Avatar, Button, Dot, Drawer, EmptyState, Spinner, StatCard, StatusChip, TopBar } from '../components/ui';
import type { StatusKey } from '@apex/ui-tokens';

const STAGES: Array<{ key: string; label: string; accent: string }> = [
  { key: 'SOURCING', label: 'Sourcing', accent: '#9AA09A' },
  { key: 'APPRAISAL', label: 'Appraisal', accent: '#C08A2E' },
  { key: 'OFFER', label: 'Offer / Bid', accent: '#2D5BA8' },
  { key: 'ACQUISITION', label: 'Acquisition', accent: '#1E7A55' },
  { key: 'CONSTRUCTION', label: 'Construction', accent: '#14503B' },
  { key: 'SALES_LETTING', label: 'Sales / Letting', accent: '#1E9E6A' },
  { key: 'COMPLETED', label: 'Completed', accent: '#6E7269' },
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

const rocColor = (r: number) => (r >= 0.2 ? '#1E7A55' : r >= 0.15 ? '#9A6212' : '#B23A2E');

export default function Board() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.deals.list.useQuery({});
  const setStage = trpc.deals.setStage.useMutation({ onSuccess: () => utils.deals.list.invalidate() });
  const createDeal = trpc.deals.create.useMutation({
    onSuccess: (d) => {
      utils.deals.list.invalidate();
      setNewOpen(false);
      navigate(`/deal/${d.id}/auto`);
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
          <>
            <input placeholder="Search deals…" value={q} onChange={(e) => setQ(e.target.value)} className="w-44 h-9" />
            <Button onClick={() => setNewOpen(true)}>New deal from documents</Button>
          </>
        }
      />
      <main className="max-w-[1640px] mx-auto px-6 pb-12">
        {/* portfolio roll-up (computed server-side) */}
        <div className="mt-5 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[150px] rounded-card p-4 text-white shadow-rest" style={{ background: 'linear-gradient(135deg,#1B6048,#14503B)' }}>
            <div className="font-mono uppercase text-[10px] tracking-[1.2px] text-accent-muted-3 font-semibold">Pipeline GDV</div>
            <div className="fig mt-1.5 text-[21px] font-semibold tracking-[-1px] text-accent-300">{R ? fM(R.pipelineGdv) : '—'}</div>
          </div>
          <StatCard label="Wtd. GDV" value={R ? fM(R.weightedGdv) : '—'} />
          <StatCard label="Forecast profit" value={R ? fM(R.forecastProfit) : '—'} tone="#1E7A55" />
          <StatCard label="Equity required" value={R ? fM(R.equityRequired) : '—'} />
          <StatCard label="Active deals" value={R ? String(R.activeCount) : '—'} />
        </div>

        {/* asset-type filters */}
        <div className="mt-4 flex gap-2">
          {FILTERS.map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="rounded-pill border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
                style={on ? { background: '#14503B', color: '#fff', borderColor: '#14503B' } : { background: '#fff', color: '#5F665F', borderColor: '#E6E5DE' }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* lifecycle board */}
        {isLoading ? (
          <div className="mt-10 flex justify-center"><Spinner /></div>
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
                          to={`/deal/${d.id}/appraisal`}
                          className="block bg-surface border border-border-strong rounded-card shadow-rest p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-float"
                          style={{ borderTop: `3px solid ${st.accent}` }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[13px] font-semibold leading-tight">{d.name}</div>
                            <StatusChip status={chip.key} label={chip.label} />
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-3">{d.address}</div>
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
                            <span className="text-[11px] text-ink-2">{d.nextMilestone ?? '—'}</span>
                            <span className="ml-auto">{d.owner && <Avatar initials={d.owner.initials} size={22} />}</span>
                          </div>
                          {st.key !== 'COMPLETED' && (
                            <button
                              className="mt-2 w-full text-[10.5px] label-mono text-ink-3 hover:text-brand-700 text-center"
                              onClick={(e) => {
                                e.preventDefault();
                                const next = STAGES[Math.min(STAGES.findIndex((s) => s.key === st.key) + 1, STAGES.length - 1)].key;
                                setStage.mutate({ id: d.id, stage: next as never });
                              }}
                            >
                              Advance stage →
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
          <label className="label-mono text-ink-3">Deal name</label>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Foundry Lane" />
          <label className="label-mono text-ink-3">Address</label>
          <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Street, town" />
          <label className="label-mono text-ink-3">Asset type</label>
          <select value={draft.assetType} onChange={(e) => setDraft({ ...draft, assetType: e.target.value })}>
            {FILTERS.slice(1).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <label className="label-mono text-ink-3">Indicative GDV (£)</label>
          <input type="number" value={draft.gdv || ''} onChange={(e) => setDraft({ ...draft, gdv: parseFloat(e.target.value) || 0 })} />
          <label className="label-mono text-ink-3">Probability %</label>
          <input type="number" value={draft.probability} onChange={(e) => setDraft({ ...draft, probability: parseInt(e.target.value) || 0 })} />
          <div className="mt-2 flex gap-2">
            <Button
              disabled={!draft.name || !draft.address || createDeal.isPending}
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
              {createDeal.isPending ? <Spinner /> : 'Create & appraise from documents'}
            </Button>
            <Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
