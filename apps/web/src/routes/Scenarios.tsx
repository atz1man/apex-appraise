import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SCENARIO_ASSUMPTIONS as ASSUMPTIONS, scenarioMetrics, type ScenarioMetrics as Metrics } from '@apex/appraisal-engine';
import { trpc } from '../lib/trpc';
import { n0 } from '../lib/format';
import { useUnits, type RegionUnits } from '../lib/region';
import { Button, Dot, EmptyState, Icon, Skeleton, SkeletonRows, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';
import { brand, onFill } from '@apex/ui-tokens';

const ACCENTS = ['rgb(var(--brand-ink, 20 80 59))', 'rgb(var(--status-blue, 45 91 168))', 'rgb(var(--status-amber, 154 98 18))'];
const GREEN = 'rgb(var(--status-green, 30 122 85))';
const AMBER = 'rgb(var(--status-amber, 154 98 18))';
const RED = 'rgb(var(--status-red, 178 58 46))';

type LeverKey = 'blendedPsf' | 'buildPsf' | 'gia' | 'targetProfitPct';

/**
 * The levers, in the firm's own unit.
 *
 * The VALUES stay in square feet — they are the engine's inputs and the slider
 * ranges are calibrated in them — and only the label and the printed figure
 * change. Converting the range too would move every slider's stops, which is a
 * different scheme rather than the same one described differently.
 */
const leversFor = (U: RegionUnits): Array<{ key: LeverKey; label: string; min: number; max: number; step: number; fmt: (v: number) => string }> => [
  { key: 'blendedPsf', label: `Blended £/${U.unit}`, min: 180, max: 280, step: 5, fmt: (v) => `£${U.rateNum(v)}` },
  { key: 'buildPsf', label: `Build £/${U.unit}`, min: 85, max: 160, step: 5, fmt: (v) => `£${U.rateNum(v)}` },
  { key: 'gia', label: `GIA (${U.unit})`, min: 16_000, max: 34_000, step: 500, fmt: (v) => U.areaNum(v) },
  { key: 'targetProfitPct', label: 'Target profit %', min: 12, max: 28, step: 1, fmt: (v) => `${v}%` },
];

/**
 * Levers → figures. Both this grid and the server that writes the comparative
 * risk commentary call the SAME function — see
 * packages/appraisal-engine/src/scenario.ts for why that matters.
 */
const compute = scenarioMetrics;

/** dc-prototype money format: £2.41m / £625k. */
const fMoney = (v: number) => {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e6) return `${s}£${(a / 1e6).toFixed(2)}m`;
  if (a >= 1e3) return `${s}£${Math.round(a / 1e3)}k`;
  return `${s}£${Math.round(a)}`;
};

const OUTPUT_ROWS: Array<{ label: string; key: keyof Metrics; fmt: (v: number) => string; big?: boolean }> = [
  { label: 'Residual land value', key: 'residual', fmt: fMoney, big: true },
  { label: 'GDV', key: 'gdv', fmt: fMoney },
  { label: 'Total cost', key: 'totalCost', fmt: fMoney },
  { label: 'Profit', key: 'profit', fmt: fMoney },
  { label: 'Profit on cost', key: 'poc', fmt: (v) => `${Math.round(v * 100)}%`, big: true },
];

const cellBorder = { borderLeft: '1px solid rgb(var(--border-faint, 240 239 233))' } as const;

export default function Scenarios() {
  /** floor areas and rates in the firm's own unit — words and units only */
  const U = useUnits();
  const LEVERS = leversFor(U);
  const { dealId = '' } = useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: rows, isLoading } = trpc.scenarios.list.useQuery(dealId, { enabled: !!dealId });
  const upsert = trpc.scenarios.upsert.useMutation({ onSuccess: () => utils.scenarios.list.invalidate(dealId) });
  // this screen shows the error where it happened; see App.tsx
  const draftRisk = trpc.scenarios.draftRisk.useMutation({ meta: { inlineError: true } });

  // local lever overlay for live recompute; persisted on slider release / input blur
  const [edits, setEdits] = useState<Record<string, Partial<Record<LeverKey, number>>>>({});

  const remove = trpc.scenarios.remove.useMutation({
    onSuccess: () => {
      utils.scenarios.list.invalidate(dealId);
      // the edit buffer is keyed by scenario id; a removed option's entry would
      // otherwise be merged back onto whatever id Prisma hands out next
      setEdits({});
    },
  });

  const scenarios = useMemo(() => (rows ?? []).slice(0, 3).map((s) => ({ ...s, ...edits[s.id] })), [rows, edits]);
  const metrics = useMemo(() => scenarios.map((s) => compute(s)), [scenarios]);

  const bestIdx = metrics.length ? metrics.map((m) => m.poc).indexOf(Math.max(...metrics.map((m) => m.poc))) : -1;
  const best = bestIdx >= 0 ? { name: scenarios[bestIdx].name, poc: metrics[bestIdx].poc } : null;

  const setLever = (id: string, key: LeverKey, v: number) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: v } }));

  // only the levers this person moved — see Comparables.persist
  const persist = (s: (typeof scenarios)[number]) => {
    const changed = edits[s.id];
    if (!changed || !Object.keys(changed).length) return;
    upsert.mutate({ id: s.id, dealId, ...changed });
  };

  const addOption = (slot: number) =>
    upsert.mutate({
      dealId,
      name: `Option ${String.fromCharCode(65 + slot)}`,
      descriptor: 'New scheme option',
      blendedPsf: 220,
      buildPsf: 105,
      gia: 24_000,
      targetProfitPct: 20,
    });

  const useOption = (s: (typeof scenarios)[number]) =>
    upsert.mutate(
      // marking an option chosen changes its descriptor and nothing else
      { id: s.id, dealId, descriptor: `${s.descriptor.replace(/ · Chosen$/, '')} · Chosen` },
      { onSuccess: () => navigate(`/deal/${dealId}/appraisal`) },
    );

  const verdictOf = (poc: number) =>
    poc >= 0.2
      ? { label: 'Strong', color: GREEN, bg: 'rgb(var(--tint-success-2, 228 241 234))' }
      : poc >= 0.13
        ? { label: 'Viable', color: AMBER, bg: 'rgb(var(--status-amber-bg, 248 240 222))' }
        : { label: 'Marginal', color: RED, bg: 'rgb(var(--status-red-bg, 249 234 231))' };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Scenario comparison" />
        <DealNav dealId={dealId} active="scenarios" />
        <main className="max-w-[1500px] mx-auto px-4 sm:px-6 pb-14">
          <div className="mt-6">
            <Skeleton height={22} width={280} />
            <Skeleton height={13} width={440} className="mt-2" />
          </div>
          {/* comparison-grid skeleton: label column + three option columns */}
          <div className="mt-4 bg-surface border border-border-strong rounded-panel shadow-rest p-5">
            <div className="grid grid-cols-1 gap-4 mb-6 lg:[grid-template-columns:200px_repeat(3,minmax(0,1fr))]">
              <div />
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={18} width="70%" />
              ))}
            </div>
            <SkeletonRows rows={9} height={16} />
          </div>
        </main>
      </div>
    );
  }

  // three column slots — real scenarios first, then add-cards
  const slots: Array<{ kind: 'scenario'; i: number } | { kind: 'empty'; slot: number }> = [0, 1, 2].map((slot) =>
    slot < scenarios.length ? { kind: 'scenario', i: slot } : { kind: 'empty', slot },
  );

  return (
    <div className="min-h-screen">
      <style>{`
        input[type=range].scn{-webkit-appearance:none;appearance:none;height:5px;border-radius:3px;background:rgb(var(--border-strong, 230 229 222));outline:none;padding:0;border:none;width:100%;box-shadow:none}
        input[type=range].scn::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:${brand[700]};cursor:pointer;border:2px solid ${onFill};box-shadow:0 1px 4px rgba(20,30,25,0.3)}
        input[type=range].scn::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:${brand[700]};cursor:pointer;border:2px solid ${onFill};box-shadow:0 1px 4px rgba(20,30,25,0.3)}
      `}</style>
      <TopBar
        crumb={
          <span>
            <Link to={`/deal/${dealId}/appraisal`} className="text-inactive hover:text-brand-ink">{deal?.name ?? 'Deal'}</Link>
            {' / '}Scenario comparison
          </span>
        }
        right={
          best && (
            <span className="inline-flex items-center rounded-[9px] bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-ink">
              Best RoC: {best.name} · {Math.round(best.poc * 100)}%
            </span>
          )
        }
      />

      <DealNav dealId={dealId} active="scenarios" />
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 pb-14">
        <div className="mt-8 flex items-end justify-between">
          <div>
            <div className="text-[32px] font-bold tracking-[-1.2px]">Compare scheme options</div>
            <div className="mt-0.5 text-[13px] text-ink-3">
              Adjust the levers on each option; metrics recompute live. Winning value in each row is highlighted.
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
        <div
          className="grid bg-surface border border-border-strong rounded-panel overflow-hidden shadow-rest min-w-[880px]"
          style={{ gridTemplateColumns: '200px repeat(3, minmax(0,1fr))' }}
        >
          {/* header row */}
          <div className="p-4 border-b border-border-std bg-sunken" />
          {slots.map((slot, col) =>
            slot.kind === 'scenario' ? (
              <div key={col} className="px-4 py-4 border-b border-border-std" style={cellBorder}>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: ACCENTS[col] }} />
                  <span className="text-[15px] font-bold leading-tight flex-1 min-w-0">{scenarios[slot.i].name}</span>
                  {/*
                    Take the option off the table. `upsert` was the only write, so an
                    option added by mistake could only be renamed into a different
                    one — while the AI risk commentary went on comparing it with the
                    ones somebody meant to propose.
                  */}
                  <button
                    aria-label={`Remove ${scenarios[slot.i].name}`}
                    title="Remove this option"
                    className="shrink-0 w-7 h-7 rounded-[7px] inline-flex items-center justify-center text-ink-3 hover:text-status-red hover:bg-status-red-bg transition-colors"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Remove ${scenarios[slot.i].name}? The comparison and any risk commentary will be recalculated without it.`)) {
                        remove.mutate(scenarios[slot.i].id);
                      }
                    }}
                  >
                    <Icon d="M18 6 6 18M6 6l12 12" size={14} color="currentColor" />
                  </button>
                </div>
                <div className="mt-1 text-[11.5px] text-ink-3">{scenarios[slot.i].descriptor}</div>
              </div>
            ) : (
              <div key={col} className="px-4 py-3 border-b border-border-std" style={cellBorder}>
                <EmptyState title="No option in this slot" cta={<Button variant="secondary" onClick={() => addOption(slot.slot)} disabled={upsert.isPending}>+ Add option</Button>}>
                  Add a scheme variant to compare returns side by side.
                </EmptyState>
              </div>
            ),
          )}

          {/* LEVERS section */}
          <div className="px-4 py-3.5 border-b border-border-faint label-mono text-ink-3 flex items-center">Levers</div>
          {slots.map((_, col) => (
            <div key={col} className="border-b border-border-faint" style={cellBorder} />
          ))}

          {LEVERS.map((lever, li) => {
            const rowBorder = li === LEVERS.length - 1 ? 'border-b border-border-std' : 'border-b border-border-faint';
            return (
              <div key={lever.key} className="contents">
                <div className={`px-4 py-3.5 ${rowBorder} text-[12.5px] font-medium text-ink-2 flex items-center`}>{lever.label}</div>
                {slots.map((slot, col) => {
                  if (slot.kind === 'empty') return <div key={col} className={rowBorder} style={cellBorder} />;
                  const s = scenarios[slot.i];
                  return (
                    <div key={col} className={`px-4 py-3 ${rowBorder}`} style={cellBorder}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="fig text-[13px] font-semibold">{lever.fmt(s[lever.key])}</span>
                        <input
                          type="number"
                          aria-label={`${s.name} ${lever.label}`}
                          className="fig w-[76px] h-[26px] py-0 px-1.5 text-right text-[11.5px]"
                          value={s[lever.key]}
                          step={lever.step}
                          onChange={(e) => setLever(s.id, lever.key, parseFloat(e.target.value) || 0)}
                          onBlur={() => persist(s)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                        />
                      </div>
                      <input
                        type="range"
                        aria-label={`${s.name} ${lever.label} slider`}
                        className="scn mt-2"
                        min={lever.min}
                        max={lever.max}
                        step={lever.step}
                        value={s[lever.key]}
                        onChange={(e) => setLever(s.id, lever.key, parseFloat(e.target.value))}
                        onPointerUp={() => persist(s)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* OUTPUTS section */}
          <div className="px-4 py-3.5 border-b border-border-faint label-mono text-ink-3 flex items-center">Outputs</div>
          {slots.map((_, col) => (
            <div key={col} className="border-b border-border-faint" style={cellBorder} />
          ))}

          {OUTPUT_ROWS.map((row, ri) => {
            const vals = metrics.map((m) => m[row.key]);
            const win = vals.length ? vals.indexOf(Math.max(...vals)) : -1;
            const rowBorder = ri === OUTPUT_ROWS.length - 1 ? 'border-b border-border-std' : 'border-b border-border-faint';
            return (
              <div key={row.key} className="contents">
                <div className={`px-4 py-3 ${rowBorder} text-[12.5px] font-medium text-ink-2 flex items-center`}>{row.label}</div>
                {slots.map((slot, col) => {
                  if (slot.kind === 'empty') return <div key={col} className={rowBorder} style={cellBorder} />;
                  const isWin = slot.i === win;
                  return (
                    <div
                      key={col}
                      className={`px-4 py-3 ${rowBorder} flex items-center justify-between`}
                      style={{ ...cellBorder, background: isWin ? 'rgb(var(--tint-green-soft, 243 248 245))' : undefined }}
                    >
                      <span
                        className="fig"
                        style={{
                          fontWeight: row.big ? 700 : 600,
                          fontSize: row.big ? 14 : 13.5,
                          color: isWin ? 'rgb(var(--brand-ink, 20 80 59))' : 'rgb(var(--ink, 22 32 27))',
                        }}
                      >
                        {row.fmt(vals[slot.i])}
                      </span>
                      {isWin && (
                        <span className="fig text-[9px] font-semibold tracking-[0.4px] text-status-green px-1.5 py-0.5 rounded-[5px] bg-tint-success-2">BEST</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Decision row */}
          <div className="px-4 py-4 text-[12.5px] font-medium text-ink-2 flex items-center">Decision</div>
          {slots.map((slot, col) => {
            if (slot.kind === 'empty') return <div key={col} style={cellBorder} />;
            const s = scenarios[slot.i];
            const v = verdictOf(metrics[slot.i].poc);
            const isBest = slot.i === bestIdx;
            return (
              <div key={col} className="px-4 py-3.5" style={cellBorder}>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-chip mb-2.5" style={{ background: v.bg }}>
                  <Dot color={v.color} size={7} />
                  <span className="text-[11px] font-semibold" style={{ color: v.color }}>{v.label}</span>
                </div>
                <Button writes
                  variant={isBest ? 'primary' : 'secondary'}
                  className="w-full"
                  loading={upsert.isPending}
                  onClick={() => useOption(s)}
                >
                  {!upsert.isPending && 'Use this option'}
                </Button>
              </div>
            );
          })}
        </div>
        </div>

        {/* AI risk view — ephemeral comparative commentary; figures from the engine */}
        <section className="mt-6 bg-surface border border-border-strong rounded-panel shadow-rest p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[15px] font-bold tracking-[-0.3px]">AI risk view</div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">
                Compares the options&apos; risk profiles — planning, cost, sales absorption and leverage — against the figures above.
              </div>
            </div>
            <Button writes
              variant="secondary"
              loading={draftRisk.isPending}
              disabled={scenarios.length < 2}
              onClick={() => draftRisk.mutate(dealId)}
            >
              Draft risk commentary
            </Button>
          </div>
          {draftRisk.error && <div className="mt-3 text-[11.5px] text-status-red">{draftRisk.error.message}</div>}
          {draftRisk.data && (
            <div className="mt-4 pt-4 border-t border-border-faint">
              <p className="text-[13px] text-ink-2 leading-relaxed">{draftRisk.data.commentary}</p>
              <div className="mt-2.5 text-[11px] text-ink-3">AI-drafted — for discussion, not advice.</div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
