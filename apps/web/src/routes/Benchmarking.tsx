import { useState } from 'react';
import { Link } from 'react-router-dom';
import { status as statusTokens, brand } from '@apex/ui-tokens';
import { trpc } from '../lib/trpc';
import { n0, formatPct, formatPp } from '../lib/format';
import { EmptyState, Icon, Spinner, Td, Th, TopBar, SPARKLE } from '../components/ui';

const REGIONS = ['South West', 'South East', 'London', 'Midlands'];
const USE_CLASSES: Array<[string, string]> = [
  ['INDUSTRIAL', 'Industrial'],
  ['RESIDENTIAL', 'Residential'],
  ['COMMERCIAL', 'Commercial'],
  ['MIXED_USE', 'Mixed-use'],
];
const useLabel = (k: string) => USE_CLASSES.find(([id]) => id === k)?.[1] ?? k;

/** "2026-Q2" → "Q2·26" */
const periodShort = (p: string) => {
  const [y, q] = p.split('-');
  return `${q}·${y.slice(2)}`;
};

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

type MetricStats = {
  lo: number;
  p25: number;
  median: number;
  p75: number;
  hi: number;
  yours: number | null;
  rank: number | null;
  sampleSize: number;
  ownDeals: Array<{ value: number; dealName: string | null; period: string }>;
};

/** Percentile strip card: IQR band, median tick, your marker, rank badge. */
function MetricCard({ label, m, isPct, lowerBetter }: { label: string; m: MetricStats; isPct?: boolean; lowerBetter?: boolean }) {
  const fmt = (v: number) => (isPct ? formatPct(v, 0) : `£${Math.round(v)}`);
  const range = m.hi - m.lo || 1;
  const pos = (v: number) => Math.max(3, Math.min(97, ((v - m.lo) / range) * 100));

  // rank wording from the raw percentile; goodness colouring inverts for lower-is-better metrics
  let badge: { label: string; text: string; bg: string } | null = null;
  let deltaEl: JSX.Element | null = null;
  if (m.yours != null && m.rank != null) {
    const wording = m.rank >= 55 ? 'Above median' : m.rank >= 45 ? 'At median' : 'Below median';
    const goodness = lowerBetter ? 100 - m.rank : m.rank;
    const tone = goodness >= 55 ? statusTokens.green : goodness >= 45 ? statusTokens.neutral : statusTokens.amber;
    badge = { label: `${ordinal(m.rank)} · ${wording}`, text: tone.text, bg: tone.bg };

    const delta = m.yours - m.median;
    const good = lowerBetter ? delta < 0 : delta > 0;
    const deltaStr = isPct
      ? `${formatPp(Math.round(delta * 100))} vs median`
      : `${delta >= 0 ? '+' : '−'}£${Math.abs(Math.round(delta))} vs median`;
    deltaEl = (
      <span className="fig text-[11px] font-semibold" style={{ color: good ? statusTokens.green.text : statusTokens.red.text }}>
        {deltaStr}
      </span>
    );
  }

  return (
    <div className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label-mono text-ink-3">{label}</span>
        {badge && (
          <span className="label-mono shrink-0 rounded-[6px] px-2 py-[3px] tracking-[0.2px]" style={{ color: badge.text, background: badge.bg }}>
            {badge.label}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="fig text-[24px] font-semibold tracking-[-1px]">{m.yours != null ? fmt(m.yours) : '—'}</span>
        {deltaEl}
      </div>
      {/* percentile strip */}
      <div className="mt-[18px] relative h-6">
        <div className="absolute left-0 right-0 top-[9px] h-1.5 rounded-[3px] bg-sunken-2" />
        <div
          className="absolute top-[9px] h-1.5 rounded-[3px]"
          style={{ background: '#D6E6DD', left: `${pos(m.p25)}%`, width: `${Math.max(0, pos(m.p75) - pos(m.p25))}%` }}
        />
        <div className="absolute top-1 h-4 w-[2px] bg-ink-3 -translate-x-[1px]" style={{ left: `${pos(m.median)}%` }} />
        {m.yours != null && (
          <div
            className="absolute top-[5px] w-3.5 h-3.5 rounded-full border-2 border-surface -translate-x-1/2"
            style={{ left: `${pos(m.yours)}%`, background: brand[700], boxShadow: '0 1px 3px rgba(20,30,25,0.3)' }}
            title={`You: ${fmt(m.yours)}`}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between fig text-[9.5px] font-medium text-ink-3">
        <span>{fmt(m.lo)}</span>
        <span>med {fmt(m.median)}</span>
        <span>{fmt(m.hi)}</span>
      </div>
      {m.yours == null && <div className="mt-2 text-[11px] text-ink-3b">No deals of yours in this scope yet.</div>}
    </div>
  );
}

export default function Benchmarking() {
  const [region, setRegion] = useState('South West');
  const [useClass, setUseClass] = useState('INDUSTRIAL');

  const utils = trpc.useUtils();
  const metricsQ = trpc.benchmarks.metrics.useQuery({ region, useClass });
  const trendQ = trpc.benchmarks.trend.useQuery({ region, useClass });
  const contribQ = trpc.benchmarks.contributions.useQuery();
  const dealsQ = trpc.deals.list.useQuery({});
  const [contribDealId, setContribDealId] = useState('');
  const contribute = trpc.benchmarks.contribute.useMutation({
    onSuccess: () => {
      utils.benchmarks.invalidate();
    },
  });
  const effectiveContribId = contribDealId || dealsQ.data?.deals.find((d) => d.name.startsWith('Northgate'))?.id || dealsQ.data?.deals[0]?.id || '';

  const M = metricsQ.data;
  const trend = trendQ.data ?? [];
  const scopeShort = `${useLabel(useClass)} · ${region}`;

  // ---- trend chart scaffolding (hand-rolled bars, £ axis) ----
  const allVals = trend.flatMap((t) => [t.marketMedian, ...t.own.map((o) => o.value)]).filter((v) => v > 0);
  const axMax = allVals.length ? Math.ceil((Math.max(...allVals) * 1.08) / 10) * 10 : 100;
  const axMin = allVals.length ? Math.max(0, Math.floor((Math.min(...allVals) * 0.88) / 10) * 10) : 0;
  const hOf = (v: number) => Math.max(0, Math.min(100, ((v - axMin) / (axMax - axMin || 1)) * 100));
  const tickStep = (axMax - axMin) / 3;
  const ticks = [0, 1, 2, 3].map((i) => Math.round(axMin + tickStep * i));

  // latest own point vs market for the callout
  const latestOwn = [...trend].reverse().find((t) => t.own.length > 0);
  const latestCallout = latestOwn
    ? (() => {
        const you = latestOwn.own.reduce((a, o) => a + o.value, 0) / latestOwn.own.length;
        const mkt = latestOwn.marketMedian;
        const diffPct = mkt ? Math.round(Math.abs((you - mkt) / mkt) * 100) : 0;
        return {
          you: `£${Math.round(you)}`,
          mkt: `£${Math.round(mkt)}`,
          text: `${diffPct}% ${you <= mkt ? 'below' : 'above'} market`,
          good: you <= mkt,
        };
      })()
    : null;

  // ---- your deals vs benchmark rows (merge the three metric ownDeals by deal+period) ----
  type Row = { dealName: string; period: string; build?: number; gdv?: number; poc?: number };
  const rows = new Map<string, Row>();
  if (M) {
    const add = (list: MetricStats['ownDeals'], key: 'build' | 'gdv' | 'poc') => {
      for (const d of list) {
        const k = `${d.dealName ?? 'Unnamed deal'}·${d.period}`;
        const row = rows.get(k) ?? { dealName: d.dealName ?? 'Unnamed deal', period: d.period };
        row[key] = d.value;
        rows.set(k, row);
      }
    };
    add(M.buildPsf.ownDeals, 'build');
    add(M.gdvPsf.ownDeals, 'gdv');
    add(M.poc.ownDeals, 'poc');
  }
  const dealRows = [...rows.values()].sort((a, b) => b.period.localeCompare(a.period));

  // ---- derived intelligence sentences ----
  const insights: string[] = [];
  if (M) {
    if (M.buildPsf.yours != null && M.buildPsf.median > 0) {
      const diff = Math.round(((M.buildPsf.median - M.buildPsf.yours) / M.buildPsf.median) * 100);
      insights.push(
        diff >= 0
          ? `Your build costs run ${diff}% below the ${region} median for ${useLabel(useClass).toLowerCase()} — a consistent procurement edge.`
          : `Your build costs run ${Math.abs(diff)}% above the ${region} median for ${useLabel(useClass).toLowerCase()} — worth a procurement review before the next scheme.`,
      );
    }
    if (M.poc.yours != null && M.poc.rank != null) {
      insights.push(
        `Profit on cost sits at the ${ordinal(M.poc.rank)} percentile of the benchmark set across your ${useLabel(useClass).toLowerCase()} schemes.`,
      );
    }
    if (trend.length >= 3) {
      const last = trend[trend.length - 1].marketMedian;
      const prev = trend[trend.length - 2].marketMedian;
      const movePct = prev ? ((last - prev) / prev) * 100 : 0;
      insights.push(
        Math.abs(movePct) < 1.5
          ? 'Market build inflation has flattened over the last two quarters — favourable for schemes starting now.'
          : movePct > 0
            ? `Market build costs rose ${formatPct(movePct / 100, 1)} last quarter — allow headroom in contingency on new appraisals.`
            : `Market build costs eased ${formatPct(Math.abs(movePct) / 100, 1)} last quarter — tender conditions are softening.`,
      );
    }
    if (insights.length === 0) insights.push(`No deals of yours in ${scopeShort} yet — benchmarks below reflect the anonymised market set.`);
  }

  const sampleSize = M?.buildPsf.sampleSize ?? 0;
  const loading = metricsQ.isLoading || trendQ.isLoading;

  return (
    <div className="min-h-screen">
      <TopBar
        crumb="Benchmarking & market intelligence"
        right={
          <>
            <select className="h-[34px] font-medium text-[12.5px]" value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select className="h-[34px] font-medium text-[12.5px]" value={useClass} onChange={(e) => setUseClass(e.target.value)}>
              {USE_CLASSES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </>
        }
      />
      <main className="max-w-[1320px] mx-auto px-6 pb-14">
        <div className="mt-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">{scopeShort.toUpperCase()}</div>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.5px]">How your deals compare to the market</h1>
          </div>
          <div className="flex items-center gap-[7px] px-[11px] py-1.5 rounded-[9px] bg-tint-success">
            <svg width="13" height="13" viewBox="0 0 24 24" fill={brand[700]}>
              <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z" />
            </svg>
            <span className="text-[11.5px] font-semibold text-brand-700">n = {n0(sampleSize)} appraisals</span>
          </div>
        </div>

        {loading || !M ? (
          <div className="mt-10 flex justify-center">
            <Spinner />
          </div>
        ) : (
          <>
            {/* percentile strip cards */}
            <div className="mt-[18px] grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <MetricCard label="Build cost £/ft²" m={M.buildPsf} lowerBetter />
              <MetricCard label="GDV £/ft²" m={M.gdvPsf} />
              <MetricCard label="Profit on cost" m={M.poc} isPct />
            </div>

            <div className="mt-5 grid gap-5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
              <div className="flex flex-col gap-4">
                {/* build cost trend */}
                <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-5">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-[16px] font-semibold tracking-[-0.3px]">Build cost trend — £/ft²</h3>
                    {latestCallout && (
                      <div className="text-right">
                        <div className="fig text-[10px] font-medium text-ink-3">Latest quarter with your data</div>
                        <div className="fig mt-0.5 text-[12px] font-semibold">
                          Your {latestCallout.you} vs market median {latestCallout.mkt}{' '}
                          <span style={{ color: latestCallout.good ? statusTokens.green.text : statusTokens.red.text }}>
                            — {latestCallout.text}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  {trend.length === 0 ? (
                    <div className="mt-4">
                      <EmptyState icon={<Icon d="M18 20V10|M12 20V4|M6 20v-6" size={22} />}>No benchmark history for this scope yet.</EmptyState>
                    </div>
                  ) : (
                    <>
                      <div className="mt-[18px] flex gap-2.5">
                        {/* £ axis */}
                        <div className="shrink-0 w-8 h-[190px] relative">
                          {ticks.map((t) => (
                            <div
                              key={t}
                              className="absolute right-0 translate-y-1/2 fig text-[9px] font-medium text-ink-3b"
                              style={{ bottom: `${hOf(t)}%` }}
                            >
                              £{t}
                            </div>
                          ))}
                        </div>
                        {/* plot */}
                        <div className="flex-1 relative h-[190px]">
                          {ticks.map((t) => (
                            <div key={t} className="absolute left-0 right-0 h-px bg-border-faint" style={{ bottom: `${hOf(t)}%` }} />
                          ))}
                          <div className="absolute inset-0 flex items-end gap-2.5">
                            {trend.map((t) => (
                              <div key={t.period} className="flex-1 h-full relative flex items-end justify-center">
                                {/* market median bar with value label */}
                                <div className="relative w-[46%] rounded-t-[3px]" style={{ background: '#C9D6CE', height: `${hOf(t.marketMedian)}%` }}>
                                  <span className="absolute -top-[13px] left-1/2 -translate-x-1/2 fig text-[8px] font-semibold text-ink-3 whitespace-nowrap">
                                    £{Math.round(t.marketMedian)}
                                  </span>
                                </div>
                                {/* your deals as dots */}
                                {t.own.map((o, i) => (
                                  <div
                                    key={`${o.dealName}-${i}`}
                                    className="absolute left-1/2 w-2.5 h-2.5 rounded-full border-2 border-surface -translate-x-1/2 translate-y-1/2"
                                    style={{ bottom: `${Math.max(3, Math.min(97, hOf(o.value)))}%`, background: brand[700], boxShadow: '0 1px 3px rgba(20,30,25,0.3)' }}
                                    title={`${o.dealName ?? 'Your deal'} — £${Math.round(o.value)}/ft²`}
                                  >
                                    <span className="absolute -top-[14px] left-1/2 -translate-x-1/2 fig text-[8px] font-semibold text-brand-700 whitespace-nowrap">
                                      £{Math.round(o.value)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-1.5 flex gap-2.5 pl-[42px]">
                        {trend.map((t) => (
                          <div key={t.period} className="flex-1 text-center fig text-[9.5px] font-medium text-ink-3">
                            {periodShort(t.period)}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-4 text-[10.5px] text-ink-3">
                        <span className="flex items-center gap-[5px]">
                          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: '#C9D6CE' }} />
                          Market median
                        </span>
                        <span className="flex items-center gap-[5px]">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: brand[700] }} />
                          Your deals
                        </span>
                      </div>
                    </>
                  )}
                </section>

                {/* your deals vs benchmark */}
                <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-5">
                  <h3 className="text-[16px] font-semibold tracking-[-0.3px] mb-3.5">Your deals vs benchmark</h3>
                  {dealRows.length === 0 ? (
                    <EmptyState icon={<Icon d="M18 20V10|M12 20V4|M6 20v-6" size={22} />}>
                      None of your appraisals sit in {scopeShort} yet — they'll appear here automatically once appraised.
                    </EmptyState>
                  ) : (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <Th>Deal</Th>
                          <Th>Period</Th>
                          <Th right>Build £/ft²</Th>
                          <Th right>GDV £/ft²</Th>
                          <Th right>Profit on cost</Th>
                          <Th right>vs median</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {dealRows.map((r) => {
                          const vs = r.poc != null && M.poc.median > 0 ? r.poc - M.poc.median : null;
                          return (
                            <tr key={`${r.dealName}-${r.period}`}>
                              <Td className="font-semibold text-[13px]">{r.dealName}</Td>
                              <Td fig className="text-ink-3">
                                {periodShort(r.period)}
                              </Td>
                              <Td right fig>
                                {r.build != null ? `£${Math.round(r.build)}` : '—'}
                              </Td>
                              <Td right fig>
                                {r.gdv != null ? `£${Math.round(r.gdv)}` : '—'}
                              </Td>
                              <Td right fig className="font-semibold">
                                {r.poc != null ? formatPct(r.poc, 0) : '—'}
                              </Td>
                              <Td
                                right
                                fig
                                className="font-semibold"
                                style={vs != null ? { color: vs >= 0 ? statusTokens.green.text : statusTokens.red.text } : undefined}
                              >
                                {vs != null ? formatPp(Math.round(vs * 100)) : '—'}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>

              {/* side rail */}
              <div className="flex flex-col gap-4 sticky top-[78px]">
                <section
                  className="rounded-card p-[18px] text-white shadow-dark-card"
                  style={{ background: `linear-gradient(155deg,${brand[600]},${brand[700]})` }}
                >
                  <div className="flex items-center gap-[9px]">
                    <span className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.16)' }}>
                      <Icon d={SPARKLE} size={15} color="#7FE3B4" strokeWidth={1.6} />
                    </span>
                    <span className="text-[13px] font-semibold">Intelligence</span>
                  </div>
                  <div className="mt-3 flex flex-col gap-3">
                    {insights.map((s) => (
                      <p key={s} className="text-[12.5px] leading-[1.5] text-accent-muted-4 m-0">
                        {s}
                      </p>
                    ))}
                  </div>
                </section>

                <section className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <h3 className="text-[13px] font-semibold">Data contribution</h3>
                  <p className="mt-2 text-[12px] leading-[1.5] text-ink-2b m-0">
                    Benchmarks are built from anonymised, aggregated appraisals across the Apex network. Your deals feed the median; nothing
                    identifiable is shared.
                  </p>
                  <div className="mt-3 flex items-center gap-2.5 px-[13px] py-[11px] rounded-[11px] bg-canvas">
                    {contribQ.data ? (
                      <>
                        <span className="fig text-[20px] font-semibold tracking-[-1px] text-brand-700">{n0(contribQ.data.total)}</span>
                        <span className="text-[11.5px] leading-[1.4] text-ink-2b">
                          anonymised data points · your org contributed {n0(contribQ.data.yours)}
                        </span>
                      </>
                    ) : (
                      <Spinner />
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <select className="flex-1 h-9 text-[12px]" value={effectiveContribId} onChange={(e) => setContribDealId(e.target.value)}>
                      {(dealsQ.data?.deals ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <button
                      className="h-9 px-3 rounded-[9px] bg-brand-700 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50"
                      disabled={!effectiveContribId || contribute.isPending}
                      onClick={() => contribute.mutate(effectiveContribId)}
                    >
                      {contribute.isPending ? '…' : 'Contribute'}
                    </button>
                  </div>
                  {contribute.data && (
                    <div className="mt-2 rounded-[8px] bg-tint-success px-2.5 py-1.5 text-[11px] text-brand-700">
                      Contributed to {contribute.data.region} · {contribute.data.useClass.toLowerCase()} · {contribute.data.period}.
                    </div>
                  )}
                  {contribute.error && <div className="mt-2 text-[11px] text-status-red">{contribute.error.message}</div>}
                </section>

                <section className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <h3 className="text-[13px] font-semibold">Apply a benchmark</h3>
                  <p className="mt-2 text-[12px] leading-[1.5] text-ink-2b m-0">
                    Seed a new appraisal with the median build &amp; GDV rates for {scopeShort}.
                  </p>
                  <Link
                    to="/board"
                    className="mt-3 flex items-center justify-center gap-2 h-[42px] rounded-[11px] bg-brand-700 text-white text-[13px] font-semibold hover:bg-brand-600 transition-all"
                  >
                    Start from benchmark
                    <Icon d="M5 12h14|M13 6l6 6-6 6" size={15} color="#fff" strokeWidth={2.2} />
                  </Link>
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
