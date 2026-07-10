import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { autoAppraise } from '@apex/appraisal-engine';
import { trpc } from '../lib/trpc';
import { n0 } from '../lib/format';
import { Button, Dot, EmptyState, Skeleton, SkeletonRows, Spinner, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';

/**
 * Fixed appraisal assumptions behind the scenario compare — identical to the
 * prototype's compute (fees 11%, contingency 5%, CIL £40/m² + S106 £150k,
 * disposal 2%, 60% LTC @ 7.5% over 18+3 months, 1.5% arrangement, 6.8% acq).
 */
const ASSUMPTIONS = {
  efficiency: 90,
  profFeePct: 11,
  contingencyPct: 5,
  cilPerSqm: 40,
  s106: 150_000,
  agentPct: 1.5,
  legalPct: 0.5,
  ltcPct: 60,
  ratePct: 7.5,
  periodMonths: 18,
  salesMonths: 3,
  arrangementFeePct: 1.5,
  acqPct: 6.8,
} as const;

const ACCENTS = ['#14503B', '#2D5BA8', '#9A6212'];
const GREEN = '#1E7A55';
const AMBER = '#9A6212';
const RED = '#B23A2E';

type LeverKey = 'blendedPsf' | 'buildPsf' | 'gia' | 'targetProfitPct';

const LEVERS: Array<{ key: LeverKey; label: string; min: number; max: number; step: number; fmt: (v: number) => string }> = [
  { key: 'blendedPsf', label: 'Blended £/ft²', min: 180, max: 280, step: 5, fmt: (v) => `£${Math.round(v)}` },
  { key: 'buildPsf', label: 'Build £/ft²', min: 85, max: 160, step: 5, fmt: (v) => `£${Math.round(v)}` },
  { key: 'gia', label: 'GIA (ft²)', min: 16_000, max: 34_000, step: 500, fmt: (v) => n0(v) },
  { key: 'targetProfitPct', label: 'Target profit %', min: 12, max: 28, step: 1, fmt: (v) => `${v}%` },
];

interface Metrics { residual: number; gdv: number; totalCost: number; profit: number; poc: number }

/** Scenario levers → engine residual (autoAppraise owns the residual/finance approximation, SDLT, CIL). */
function compute(s: { blendedPsf: number; buildPsf: number; gia: number; targetProfitPct: number }): Metrics {
  const r = autoAppraise({
    units: [{ label: 'Blended', count: 1, area: s.gia * (ASSUMPTIONS.efficiency / 100), cap: s.blendedPsf }],
    efficiency: ASSUMPTIONS.efficiency,
    buildPerSqft: s.buildPsf,
    profFeePct: ASSUMPTIONS.profFeePct,
    contingencyPct: ASSUMPTIONS.contingencyPct,
    cilPerSqm: ASSUMPTIONS.cilPerSqm,
    s106: ASSUMPTIONS.s106,
    agentPct: ASSUMPTIONS.agentPct,
    legalPct: ASSUMPTIONS.legalPct,
    ltcPct: ASSUMPTIONS.ltcPct,
    ratePct: ASSUMPTIONS.ratePct,
    periodMonths: ASSUMPTIONS.periodMonths,
    salesMonths: ASSUMPTIONS.salesMonths,
    arrangementFeePct: ASSUMPTIONS.arrangementFeePct,
    targetProfitPct: s.targetProfitPct,
    acqPct: ASSUMPTIONS.acqPct,
    asking: 0,
  });
  const land = r.residualNet * (1 + ASSUMPTIONS.acqPct / 100);
  const totalCost = r.saleCosts + r.build + r.fees + r.cont + r.other + r.finance + land;
  const profit = r.gdv - totalCost;
  return { residual: r.residualNet, gdv: r.gdv, totalCost, profit, poc: totalCost > 0 ? profit / totalCost : 0 };
}

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

const cellBorder = { borderLeft: '1px solid #F0EFE9' } as const;

export default function Scenarios() {
  const { dealId = '' } = useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: rows, isLoading } = trpc.scenarios.list.useQuery(dealId, { enabled: !!dealId });
  const upsert = trpc.scenarios.upsert.useMutation({ onSuccess: () => utils.scenarios.list.invalidate(dealId) });

  // local lever overlay for live recompute; persisted on slider release / input blur
  const [edits, setEdits] = useState<Record<string, Partial<Record<LeverKey, number>>>>({});

  const scenarios = useMemo(() => (rows ?? []).slice(0, 3).map((s) => ({ ...s, ...edits[s.id] })), [rows, edits]);
  const metrics = useMemo(() => scenarios.map((s) => compute(s)), [scenarios]);

  const bestIdx = metrics.length ? metrics.map((m) => m.poc).indexOf(Math.max(...metrics.map((m) => m.poc))) : -1;
  const best = bestIdx >= 0 ? { name: scenarios[bestIdx].name, poc: metrics[bestIdx].poc } : null;

  const setLever = (id: string, key: LeverKey, v: number) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: v } }));

  const persist = (s: (typeof scenarios)[number]) =>
    upsert.mutate({
      id: s.id,
      dealId,
      name: s.name,
      descriptor: s.descriptor,
      blendedPsf: s.blendedPsf,
      buildPsf: s.buildPsf,
      gia: s.gia,
      targetProfitPct: s.targetProfitPct,
    });

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
      {
        id: s.id,
        dealId,
        name: s.name,
        descriptor: `${s.descriptor.replace(/ · Chosen$/, '')} · Chosen`,
        blendedPsf: s.blendedPsf,
        buildPsf: s.buildPsf,
        gia: s.gia,
        targetProfitPct: s.targetProfitPct,
      },
      { onSuccess: () => navigate(`/deal/${dealId}/appraisal`) },
    );

  const verdictOf = (poc: number) =>
    poc >= 0.2
      ? { label: 'Strong', color: GREEN, bg: '#E4F1EA' }
      : poc >= 0.13
        ? { label: 'Viable', color: AMBER, bg: '#F8F0DE' }
        : { label: 'Marginal', color: RED, bg: '#F9EAE7' };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Scenario comparison" />
        <DealNav dealId={dealId} active="scenarios" />
        <main className="max-w-[1500px] mx-auto px-6 pb-14">
          <div className="mt-6">
            <Skeleton height={22} width={280} />
            <Skeleton height={13} width={440} className="mt-2" />
          </div>
          {/* comparison-grid skeleton: label column + three option columns */}
          <div className="mt-4 bg-surface border border-border-strong rounded-panel shadow-rest p-5">
            <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: '200px repeat(3, minmax(0,1fr))' }}>
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
        input[type=range].scn{-webkit-appearance:none;appearance:none;height:5px;border-radius:3px;background:#E6E5DE;outline:none;padding:0;border:none;width:100%;box-shadow:none}
        input[type=range].scn::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:#14503B;cursor:pointer;border:2px solid #fff;box-shadow:0 1px 4px rgba(20,30,25,0.3)}
        input[type=range].scn::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#14503B;cursor:pointer;border:2px solid #fff;box-shadow:0 1px 4px rgba(20,30,25,0.3)}
      `}</style>
      <TopBar
        crumb={
          <span>
            <Link to={`/deal/${dealId}/appraisal`} className="text-inactive hover:text-brand-700">{deal?.name ?? 'Deal'}</Link>
            {' / '}Scenario comparison
          </span>
        }
        right={
          best && (
            <span className="inline-flex items-center rounded-[9px] bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-700">
              Best RoC: {best.name} · {Math.round(best.poc * 100)}%
            </span>
          )
        }
      />

      <DealNav dealId={dealId} active="scenarios" />
      <main className="max-w-[1500px] mx-auto px-6 pb-14">
        <div className="mt-6 flex items-end justify-between">
          <div>
            <div className="text-[20px] font-bold tracking-[-0.5px]">Compare scheme options</div>
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
                  <span className="text-[15px] font-bold leading-tight">{scenarios[slot.i].name}</span>
                </div>
                <div className="mt-1 text-[11.5px] text-ink-3">{scenarios[slot.i].descriptor}</div>
              </div>
            ) : (
              <div key={col} className="px-4 py-3 border-b border-border-std" style={cellBorder}>
                <EmptyState cta={<Button variant="secondary" onClick={() => addOption(slot.slot)} disabled={upsert.isPending}>+ Add option</Button>}>
                  No option in this slot yet.
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
                      style={{ ...cellBorder, background: isWin ? '#F3F8F5' : undefined }}
                    >
                      <span
                        className="fig"
                        style={{
                          fontWeight: row.big ? 700 : 600,
                          fontSize: row.big ? 14 : 13.5,
                          color: isWin ? '#14503B' : '#16201B',
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
                <button
                  className="w-full flex items-center justify-center gap-2 h-[38px] rounded-[10px] text-[12px] font-semibold transition-colors disabled:opacity-50"
                  style={
                    isBest
                      ? { background: '#14503B', color: '#fff', border: '1px solid #14503B' }
                      : { background: '#fff', color: '#14503B', border: '1px solid #E6E5DE' }
                  }
                  disabled={upsert.isPending}
                  onClick={() => useOption(s)}
                >
                  {upsert.isPending ? <Spinner /> : 'Use this option'}
                </button>
              </div>
            );
          })}
        </div>
        </div>
      </main>
    </div>
  );
}
