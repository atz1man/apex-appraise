import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { status as statusTokens, neutral, brand, type StatusKey } from '@apex/ui-tokens';
import { trpc } from '../lib/trpc';
import { fM, formatDelta, formatPct } from '../lib/format';
import {
  AssetTag,
  Avatar,
  Button,
  Dot,
  EmptyState,
  Icon,
  Panel,
  ProgressBar,
  Skeleton,
  SkeletonRows,
  Spinner,
  StatCard,
  StatusChip,
  TopBar,
  SPARKLE,
} from '../components/ui';
import { DealNav } from '../components/DealNav';

// ---------- Deal lifecycle ----------

const STAGES: Array<{ key: string; label: string }> = [
  { key: 'SOURCING', label: 'Sourcing' },
  { key: 'APPRAISAL', label: 'Appraisal' },
  { key: 'OFFER', label: 'Offer / Bid' },
  { key: 'ACQUISITION', label: 'Acquisition' },
  { key: 'CONSTRUCTION', label: 'Construction' },
  { key: 'SALES_LETTING', label: 'Sales / Letting' },
  { key: 'COMPLETED', label: 'Completed' },
];

const figuresChip: Record<string, { key: StatusKey; label: string }> = {
  ESTIMATE: { key: 'neutral', label: 'Estimate' },
  COMMITTED: { key: 'blue', label: 'Committed' },
  ACTUAL: { key: 'green', label: 'Actual' },
};

const viabilityPill: Record<string, { label: string; t: { text: string; bg: string; dot: string } }> = {
  PROCEED: { label: 'Proceed', t: statusTokens.green },
  CAUTION: { label: 'Caution', t: statusTokens.amber },
  DECLINE: { label: 'Decline', t: statusTokens.red },
};

/** RoC traffic light — ≥17% green, ≥10% amber, below red. */
const rocTone = (r: number) => (r >= 0.17 ? statusTokens.green.text : r >= 0.1 ? statusTokens.amber.text : statusTokens.red.text);
/** Cost variance: positive = forecast over appraisal = bad. */
const varTone = (v: number) => (v > 0 ? statusTokens.red.text : v < 0 ? statusTokens.green.text : neutral.ink3);

const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtAt = (d: Date) =>
  `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

// ---------- Workfile tool cards ----------

const ICONS: Record<string, string> = {
  appraisal: 'M4 4h16v16H4z|M8 12h8|M8 8h8|M8 16h5',
  auto: SPARKLE,
  comps: 'M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z|M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  scenarios: 'M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01',
  costs: 'M12 2v20|M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  sales: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M22 21v-2a4 4 0 0 0-3-3.87',
  dataroom: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  workbench: 'M3 3h7v7H3z|M14 3h7v7h-7z|M14 14h7v7h-7z|M3 14h7v7H3z',
  report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M8 13h8|M8 17h5',
  redbook: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20|M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export default function DealOverview() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();

  const { data: deal, isLoading: dealLoading, error: dealError } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: appraisal, isLoading: appraisalLoading } = trpc.appraisal.getCurrent.useQuery(dealId, { enabled: !!dealId });
  const { data: tasks, isLoading: tasksLoading } = trpc.tasks.list.useQuery({ dealId }, { enabled: !!dealId });
  const { data: activity, isLoading: activityLoading } = trpc.documents.activity.useQuery(dealId, { enabled: !!dealId });
  const { data: cost, isLoading: costLoading } = trpc.cost.packages.useQuery(dealId, { enabled: !!dealId });
  const { data: sales, isLoading: salesLoading } = trpc.sales.units.useQuery(dealId, { enabled: !!dealId });

  const setStage = trpc.deals.setStage.useMutation({
    onSuccess: () => {
      utils.deals.get.invalidate(dealId);
      utils.deals.list.invalidate();
      utils.documents.activity.invalidate(dealId);
    },
  });

  if (dealLoading) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Deal overview" />
        <main className="max-w-[1480px] mx-auto px-6 pb-14" role="status" aria-label="Loading">
          {/* header skeleton */}
          <div className="mt-6">
            <Skeleton height={11} width={110} />
            <Skeleton height={27} width={320} className="mt-2" />
            <Skeleton height={13} width={240} className="mt-2.5" />
          </div>
          {/* lifecycle strip skeleton */}
          <div className="mt-5 bg-surface border border-border-strong rounded-panel shadow-rest p-5">
            <Skeleton height={30} />
          </div>
          {/* KPI strip skeleton */}
          <div className="mt-4 flex gap-3 flex-wrap">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex-1 min-w-[130px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
                <Skeleton height={10} width="55%" />
                <Skeleton height={21} width="45%" className="mt-2" />
              </div>
            ))}
          </div>
          {/* two-column body skeleton */}
          <div className="mt-6 grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))' }}>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="bg-surface border border-border-strong rounded-panel shadow-rest p-4">
                  <Skeleton height={32} width={32} />
                  <Skeleton height={13} width="60%" className="mt-2.5" />
                  <Skeleton height={11} width="85%" className="mt-1.5" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-4">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="bg-surface border border-border-strong rounded-panel shadow-rest p-5">
                  <Skeleton height={13} width="50%" />
                  <div className="mt-3.5"><SkeletonRows rows={3} /></div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (dealError || !deal) {
    return (
      <div className="min-h-screen">
        <TopBar crumb={<span><Link to="/board" className="hover:text-brand-700">Pipeline</Link> / Deal overview</span>} />
        <main className="max-w-[720px] mx-auto px-6 py-16">
          <EmptyState cta={<Link to="/board"><Button variant="secondary">Back to pipeline</Button></Link>}>
            This deal could not be loaded — it may have been removed or you may not have access.
          </EmptyState>
        </main>
      </div>
    );
  }

  const chip = figuresChip[deal.figureStatus] ?? figuresChip.ESTIMATE;
  const viability = viabilityPill[deal.viability] ?? viabilityPill.CAUTION;
  const stageIdx = Math.max(0, STAGES.findIndex((s) => s.key === deal.stage));
  const nextStage = STAGES[stageIdx + 1];
  const result = appraisal?.result ?? null;

  const counts = deal.counts;
  const tools: Array<{ icon: string; title: string; desc: string; path: string; count?: string }> = [
    { icon: ICONS.appraisal, title: 'Appraisal', desc: 'Residual, cashflow, finance & returns', path: 'appraisal', count: appraisal ? 'Current saved' : 'Not run yet' },
    { icon: ICONS.auto, title: 'Auto-Appraisal', desc: 'Documents in → appraisal out, AI or manual', path: 'auto' },
    { icon: ICONS.comps, title: 'Comparables', desc: 'Adjustment grid → supported £/ft²', path: 'comparables', count: plural(counts.comparables, 'comparable') },
    { icon: ICONS.scenarios, title: 'Scenarios', desc: 'Compare scheme options side-by-side', path: 'scenarios', count: plural(counts.scenarios, 'scenario') },
    { icon: ICONS.costs, title: 'Costs', desc: 'Budget vs actual, contractors, photo log', path: 'costs', count: plural(counts.costPackages, 'package') },
    { icon: ICONS.sales, title: 'Sales & lettings', desc: 'Unit tracker, progression, rent roll', path: 'sales', count: plural(counts.units, 'unit') },
    { icon: ICONS.dataroom, title: 'Data room', desc: 'Deal documents with live extraction', path: 'dataroom', count: plural(counts.documents, 'document') },
    { icon: ICONS.workbench, title: 'Workbench', desc: 'Valuation workbench — evidence to figure', path: 'workbench' },
    { icon: ICONS.report, title: 'Report', desc: 'Print-ready investment pack', path: 'report' },
    { icon: ICONS.redbook, title: 'Red Book', desc: 'RICS Red Book valuation report', path: 'redbook' },
  ];

  const openTasks = (tasks ?? []).filter((t) => !t.done);
  const costRollup = cost?.rollup;
  const hasCost = (cost?.packages.length ?? 0) > 0;
  const salesRollup = sales?.rollup;
  const hasSales = (salesRollup?.total ?? 0) > 0;
  const costOver = (costRollup?.variance ?? 0) > 0;

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-700">Pipeline</Link> / {deal.name}
          </span>
        }
        right={
          <>
            <span
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[11.5px] font-semibold"
              style={{ background: viability.t.bg, color: viability.t.text }}
            >
              <Dot color={viability.t.dot} /> {viability.label}
            </span>
            <StatusChip status={chip.key} label={chip.label} />
          </>
        }
      />

      <DealNav dealId={dealId} active="overview" />
      <main className="max-w-[1480px] mx-auto px-6 pb-14">
        {/* ===== Header block ===== */}
        <div className="mt-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Deal overview</div>
            <h1 className="mt-1.5 text-[27px] font-bold tracking-[-0.8px] leading-tight">{deal.name}</h1>
            <div className="mt-2 flex items-center gap-3 text-[13px] text-ink-2 flex-wrap">
              <span>{deal.address}</span>
              <AssetTag type={deal.assetType} />
              {deal.owner && (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar initials={deal.owner.initials} size={22} />
                  <span className="font-medium">{deal.owner.name}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div>
              <div className="label-mono text-ink-3">Probability</div>
              <div className="fig mt-0.5 text-[17px] font-semibold tracking-[-0.5px]">{deal.probability}%</div>
            </div>
            <div>
              <div className="label-mono text-ink-3">Next milestone</div>
              <div className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold">
                <Dot color={brand[500]} size={6} />
                {deal.nextMilestone ?? '—'}
              </div>
            </div>
          </div>
        </div>

        {/* ===== Lifecycle strip ===== */}
        <Panel className="mt-5 !py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-start flex-1 min-w-0 overflow-x-auto py-1">
              {STAGES.map((s, i) => {
                const done = i < stageIdx;
                const current = i === stageIdx;
                return (
                  <Fragment key={s.key}>
                    {i > 0 && (
                      <div
                        className="flex-1 min-w-[18px] h-[2px] mt-[13px]"
                        style={{ background: i <= stageIdx ? brand[700] : neutral.borderStrong }}
                      />
                    )}
                    <div className="flex flex-col items-center gap-1.5 shrink-0 px-1" style={{ width: 96 }}>
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full"
                        style={
                          done
                            ? { background: brand[700] }
                            : current
                              ? { background: '#fff', border: `2px solid ${brand[700]}` }
                              : { background: neutral.sunken2, border: `1px solid ${neutral.borderStrong}` }
                        }
                      >
                        {done ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 12l5 5L20 7" />
                          </svg>
                        ) : (
                          <span className="fig text-[10.5px] font-semibold" style={{ color: current ? brand[700] : neutral.ink3 }}>{i + 1}</span>
                        )}
                      </span>
                      <span
                        className="text-[10.5px] text-center leading-tight whitespace-nowrap"
                        style={{
                          color: current ? neutral.ink : done ? brand[700] : neutral.ink3,
                          fontWeight: current ? 700 : done ? 600 : 500,
                        }}
                      >
                        {s.label}
                      </span>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <Button
              variant="secondary"
              disabled={!nextStage || setStage.isPending}
              onClick={() => nextStage && setStage.mutate({ id: dealId, stage: nextStage.key as never })}
            >
              {setStage.isPending ? <Spinner /> : nextStage ? `Advance stage →` : 'Completed'}
            </Button>
          </div>
          {setStage.error && <div className="mt-2 text-[11.5px] text-status-red">{setStage.error.message}</div>}
        </Panel>

        {/* ===== KPI strip ===== */}
        {appraisalLoading ? (
          <div className="mt-4 flex gap-3 flex-wrap" role="status" aria-label="Loading">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex-1 min-w-[130px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
                <Skeleton height={10} width="55%" />
                <Skeleton height={21} width="45%" className="mt-2" />
              </div>
            ))}
          </div>
        ) : result ? (
          <div className="mt-4 flex gap-3 flex-wrap">
            <StatCard label="GDV" value={fM(result.gdv)} />
            <StatCard label="Residual land" value={fM(result.residualNet)} sub="net of acquisition costs" />
            <StatCard label="Profit" value={fM(result.profit)} tone={statusTokens.green.text} />
            <StatCard label="RoC" value={formatPct(result.poc)} tone={rocTone(result.poc)} sub={`RoGDV ${formatPct(result.rogdv)}`} />
            <StatCard label="Project IRR" value={result.cash?.projIrr != null ? formatPct(result.cash.projIrr) : '—'} sub={result.cash?.eqIrr != null ? `Equity IRR ${formatPct(result.cash.eqIrr)}` : undefined} />
            <StatCard label="Equity" value={fM(result.equity)} />
            <StatCard label="Peak debt" value={fM(result.facility)} sub="senior facility" />
          </div>
        ) : (
          <div className="mt-4 flex gap-3 flex-wrap items-stretch">
            <StatCard label="GDV" value={fM(deal.gdv)} sub="headline estimate" />
            <StatCard label="Forecast profit" value={fM(deal.forecastProfit)} />
            <StatCard label="RoC" value={formatPct(deal.roc)} tone={rocTone(deal.roc)} />
            <StatCard label="Equity required" value={fM(deal.equityRequired)} />
            <div className="flex-[1.6] min-w-[280px]">
              <EmptyState
                icon={<span aria-hidden="true" className="inline-flex"><Icon d={SPARKLE} size={22} /></span>}
                cta={
                  <Link to={`/deal/${dealId}/auto`}>
                    <Button className="mt-1">Run the first appraisal</Button>
                  </Link>
                }
              >
                No appraisal saved yet — these figures are the deal's headline estimates.
              </EmptyState>
            </div>
          </div>
        )}

        {/* ===== Two-column body ===== */}
        <div className="mt-6 grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
          {/* LEFT — workfile */}
          <section>
            <div className="eyebrow">Workfile</div>
            <h2 className="mt-1 text-[19px] font-bold tracking-[-0.5px]">Everything on this deal</h2>
            <div className="mt-3.5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))' }}>
              {tools.map((t) => (
                <Link
                  key={t.title}
                  to={`/deal/${dealId}/${t.path}`}
                  className="group bg-surface border border-border-strong rounded-panel shadow-rest p-4 transition-all hover:-translate-y-1 hover:shadow-float"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-[9px] bg-tint-success text-brand-700" aria-hidden="true">
                      <Icon d={t.icon} size={16} strokeWidth={1.9} />
                    </span>
                    {t.count && <span className="fig text-[10.5px] text-ink-3 mt-0.5 whitespace-nowrap">{t.count}</span>}
                  </div>
                  <div className="mt-2.5 text-[13.5px] font-semibold tracking-[-0.2px]">{t.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-ink-2 leading-snug">{t.desc}</div>
                </Link>
              ))}
            </div>
          </section>

          {/* RIGHT rail */}
          <aside className="flex flex-col gap-4">
            {/* Construction cost health */}
            {costLoading ? (
              <Panel title={<span className="text-[13px] font-semibold">Construction cost health</span>}>
                <SkeletonRows rows={3} />
              </Panel>
            ) : hasCost && costRollup ? (
              <Panel title={<span className="text-[13px] font-semibold">Construction cost health</span>} right={<StatusChip status={costOver ? 'red' : 'green'} label={costOver ? 'Over' : 'On track'} />}>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="label-mono text-ink-3">Variance to appraisal</div>
                    <div className="fig mt-1 text-[19px] font-semibold tracking-[-0.8px]" style={{ color: varTone(costRollup.variance) }}>
                      {formatDelta(costRollup.variance)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label-mono text-ink-3">Profit impact</div>
                    <div className="fig mt-1 text-[13px] font-semibold" style={{ color: varTone(-costRollup.profitImpact) }}>
                      {formatDelta(costRollup.profitImpact)}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-[11.5px] text-ink-2b">
                    <span>Appraised {fM(costRollup.appraised)}</span>
                    <span className="fig font-semibold text-ink">Forecast {fM(costRollup.forecast)}</span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar
                      pct={costRollup.appraised > 0 ? (costRollup.forecast / costRollup.appraised) * 100 : 0}
                      color={costOver ? statusTokens.red.dot : brand[700]}
                      height={7}
                    />
                  </div>
                </div>
                <Link to={`/deal/${dealId}/costs`} className="mt-3 inline-block text-[11.5px] font-semibold text-brand-500 hover:text-brand-700">
                  Open cost monitoring →
                </Link>
              </Panel>
            ) : null}

            {/* Sales health */}
            {salesLoading ? (
              <Panel title={<span className="text-[13px] font-semibold">Sales health</span>}>
                <SkeletonRows rows={3} />
              </Panel>
            ) : hasSales && salesRollup ? (
              <Panel title={<span className="text-[13px] font-semibold">Sales health</span>} right={<span className="fig text-[11px] text-ink-3">{plural(salesRollup.total, 'unit')}</span>}>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="label-mono text-ink-3">GDV realised</div>
                    <div className="fig mt-1 text-[19px] font-semibold tracking-[-0.8px] text-brand-700">{fM(salesRollup.gdvRealised)}</div>
                  </div>
                  <div className="text-right">
                    <div className="label-mono text-ink-3">Sales rate</div>
                    <div className="fig mt-1 text-[13px] font-semibold">{formatPct(salesRollup.salesRate, 0)}</div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-[11.5px] text-ink-2b">
                    <span>vs appraised {fM(salesRollup.gdvAppraised)}</span>
                    <span className="fig font-semibold text-ink">
                      {formatPct(salesRollup.gdvAppraised > 0 ? salesRollup.gdvRealised / salesRollup.gdvAppraised : 0, 0)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar
                      pct={salesRollup.gdvAppraised > 0 ? (salesRollup.gdvRealised / salesRollup.gdvAppraised) * 100 : 0}
                      color={brand[500]}
                      height={7}
                    />
                  </div>
                </div>
                <div className="mt-2.5 flex justify-between text-[11.5px] text-ink-2b border-t border-border-faint pt-2.5">
                  <span>Deposits held</span>
                  <span className="fig font-semibold text-ink">{fM(salesRollup.depositsHeld)}</span>
                </div>
                <Link to={`/deal/${dealId}/sales`} className="mt-3 inline-block text-[11.5px] font-semibold text-brand-500 hover:text-brand-700">
                  Open sales & lettings →
                </Link>
              </Panel>
            ) : null}

            {/* Open tasks */}
            <Panel
              title={<span className="text-[13px] font-semibold">Open tasks</span>}
              right={<span className="fig text-[11px] text-ink-3">{openTasks.length} open</span>}
            >
              {tasksLoading ? (
                <SkeletonRows rows={4} />
              ) : openTasks.length === 0 ? (
                <EmptyState>No open tasks on this deal — all clear.</EmptyState>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {openTasks.slice(0, 5).map((t) => {
                    const overdue = t.due != null && t.due.getTime() < Date.now();
                    return (
                      <div key={t.id} className="flex items-center gap-2.5 py-1">
                        <span
                          className="w-[16px] h-[16px] rounded-[5px] border inline-flex items-center justify-center shrink-0"
                          style={{ background: '#fff', borderColor: neutral.dashed }}
                          aria-hidden="true"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12px] truncate" title={t.title}>{t.title}</span>
                          <span className="block text-[10px] text-ink-3">{t.aspect}</span>
                        </span>
                        <span className="fig text-[10.5px] shrink-0" style={{ color: overdue ? statusTokens.red.text : neutral.ink3 }}>
                          {t.due ? fmtDay(t.due) : '—'}
                        </span>
                        <Avatar initials={t.assignee} size={20} />
                      </div>
                    );
                  })}
                </div>
              )}
              <Link to="/calendar" className="mt-3 inline-block text-[11.5px] font-semibold text-brand-500 hover:text-brand-700">
                View all in calendar →
              </Link>
            </Panel>

            {/* Recent activity */}
            <Panel title={<span className="text-[13px] font-semibold">Recent activity</span>}>
              {activityLoading ? (
                <SkeletonRows rows={5} />
              ) : (activity ?? []).length === 0 ? (
                <EmptyState>Nothing has happened on this deal yet — activity appears as the team works.</EmptyState>
              ) : (
                <div className="flex flex-col">
                  {(activity ?? []).slice(0, 8).map((ev) => (
                    <div key={ev.id} className="flex gap-2.5 py-2 border-b border-border-faint last:border-0">
                      <span className="mt-[5px] shrink-0"><Dot color={neutral.ink3b} size={6} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] leading-snug">
                          <span className="font-semibold">{ev.actor}</span> {ev.action}{' '}
                          <span className="text-ink-2b">{ev.target}</span>
                        </div>
                        <div className="fig mt-0.5 text-[10.5px] text-ink-3">{fmtAt(ev.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
