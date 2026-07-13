import { useMemo, useState } from 'react';
import type { CashflowRow } from '@apex/appraisal-engine';
import { fM, formatSigned } from '../lib/format';

/* ================================================================
   Engine-fed SVG charts — no chart library, design-system colors only.
   Palette validated (CVD/contrast): revenue #1E7A55, cost #9A6212,
   profit #1E9E6A; the cumulative J-curve is a single ink line.
   ================================================================ */

const REV = '#1E7A55';
const COST = '#9A6212';
const PROFIT = '#1E9E6A';
const INK = '#16201B';
const GRID = '#ECEBE5';
const MUTED = '#9AA09A';

/**
 * Monthly cashflow — two aligned panels on one month axis:
 * flows (cost out vs revenue in, paired bars) above the cumulative
 * net position (the developer's J-curve) with the peak-debt marker.
 */
export function CashflowChart({
  rows,
  peak,
  pcMonth,
  monthLabel,
}: {
  rows: CashflowRow[];
  peak: number;
  pcMonth: number;
  monthLabel: (m: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const FLOW_H = 120;
  const CUM_H = 110;
  const GAP_Y = 34;
  const PAD_L = 8;
  const PAD_R = 8;
  const H = FLOW_H + GAP_Y + CUM_H + 24;

  const n = rows.length;
  const slot = (W - PAD_L - PAD_R) / Math.max(n, 1);
  const barW = Math.max(2, Math.min(9, slot * 0.34));

  const maxFlow = useMemo(() => Math.max(...rows.map((r) => Math.max(r.cost, r.rev)), 1), [rows]);
  const cumMin = useMemo(() => Math.min(...rows.map((r) => r.cum), 0), [rows]);
  const cumMax = useMemo(() => Math.max(...rows.map((r) => r.cum), 1), [rows]);

  const xOf = (i: number) => PAD_L + i * slot + slot / 2;
  const flowY = (v: number) => FLOW_H - (v / maxFlow) * (FLOW_H - 14);
  const cumTop = FLOW_H + GAP_Y;
  const cumY = (v: number) => cumTop + ((cumMax - v) / (cumMax - cumMin || 1)) * (CUM_H - 10);

  const peakIdx = useMemo(() => {
    let idx = 0;
    rows.forEach((r, i) => {
      if (r.cum < rows[idx]!.cum) idx = i;
    });
    return idx;
  }, [rows]);

  const cumPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${cumY(r.cum).toFixed(1)}`).join(' ');
  const zeroY = cumY(0);
  const hovered = hover != null ? rows[hover] : null;

  return (
    <div data-testid="cashflow-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        role="img"
        aria-label="Monthly cashflow: cost out and revenue in per month, with the cumulative net position below"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round((x - PAD_L - slot / 2) / slot);
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {/* flows panel grid + baseline */}
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD_L} x2={W - PAD_R} y1={flowY(maxFlow * f)} y2={flowY(maxFlow * f)} stroke={GRID} strokeWidth="1" />
        ))}
        <line x1={PAD_L} x2={W - PAD_R} y1={FLOW_H} y2={FLOW_H} stroke={MUTED} strokeWidth="1" />
        {/* practical-completion divider */}
        {pcMonth > 0 && pcMonth <= n && (
          <line x1={xOf(pcMonth - 1)} x2={xOf(pcMonth - 1)} y1={8} y2={cumTop + CUM_H} stroke={GRID} strokeWidth="1" strokeDasharray="3 4" />
        )}
        {/* paired bars */}
        {rows.map((r, i) => (
          <g key={r.m} opacity={hover == null || hover === i ? 1 : 0.45}>
            {r.cost > 0 && (
              <rect x={xOf(i) - barW - 1} y={flowY(r.cost)} width={barW} height={FLOW_H - flowY(r.cost)} rx="2" fill={COST} />
            )}
            {r.rev > 0 && <rect x={xOf(i) + 1} y={flowY(r.rev)} width={barW} height={FLOW_H - flowY(r.rev)} rx="2" fill={REV} />}
          </g>
        ))}
        {/* cumulative panel */}
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke={MUTED} strokeWidth="1" />
        <path d={`${cumPath} L${xOf(n - 1)},${zeroY} L${xOf(0)},${zeroY} Z`} fill={INK} opacity="0.06" />
        <path d={cumPath} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        {/* peak-debt marker */}
        <circle cx={xOf(peakIdx)} cy={cumY(rows[peakIdx]!.cum)} r="4" fill={INK} stroke="#fff" strokeWidth="2" />
        <text
          x={Math.min(xOf(peakIdx) + 8, W - 150)}
          y={Math.min(cumY(rows[peakIdx]!.cum) + 16, H - 26)}
          className="fig"
          fontSize="11"
          fill={INK}
          fontWeight="600"
        >
          Peak debt {fM(peak)}
        </text>
        {/* hover crosshair */}
        {hover != null && (
          <line x1={xOf(hover)} x2={xOf(hover)} y1={8} y2={cumTop + CUM_H} stroke={INK} strokeWidth="1" opacity="0.35" />
        )}
        {/* x ticks every quarter */}
        {rows.map((r, i) =>
          i % 3 === 0 ? (
            <text key={r.m} x={xOf(i)} y={H - 8} fontSize="9.5" fill={MUTED} textAnchor="middle" className="fig">
              {monthLabel(r.m)}
            </text>
          ) : null,
        )}
        {/* panel titles */}
        <text x={PAD_L} y={12} fontSize="10" fill={MUTED} className="label-mono" letterSpacing="0.5">
          MONTHLY FLOWS
        </text>
        <text x={PAD_L} y={cumTop - 6} fontSize="10" fill={MUTED} className="label-mono" letterSpacing="0.5">
          NET POSITION (CUMULATIVE)
        </text>
      </svg>

      {/* legend + live tooltip readout */}
      <div className="mt-1.5 flex items-center gap-4 text-[11.5px] text-ink-2 flex-wrap min-h-[20px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: COST }} /> Cost out
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: REV }} /> Revenue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-[2px]" style={{ background: INK }} /> Net position
        </span>
        {hovered && (
          <span className="ml-auto fig text-[11.5px] text-ink" data-testid="cashflow-tooltip">
            <b>{monthLabel(hovered.m)}</b> · cost {hovered.cost ? fM(hovered.cost) : '—'} · rev{' '}
            {hovered.rev ? fM(hovered.rev) : '—'} · position {formatSigned(hovered.cum)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Sales velocity — cumulative GDV secured over time (step line + area)
 * against the appraised total (dashed reference). Compact, for the rail.
 */
export function SalesVelocityChart({
  points,
  target,
}: {
  points: Array<{ t: number; value: number; label: string }>; // secured events, any order
  target: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = useMemo(() => [...points].sort((a, b) => a.t - b.t), [points]);
  const cum = useMemo(() => {
    let run = 0;
    return sorted.map((p) => ({ ...p, cum: (run += p.value) }));
  }, [sorted]);

  const W = 320;
  const H = 150;
  const PAD_T = 14;
  const PAD_B = 22;
  const plotH = H - PAD_T - PAD_B;
  const t0 = cum[0]?.t ?? 0;
  const t1 = Math.max(cum[cum.length - 1]?.t ?? 1, t0 + 1);
  const yMax = Math.max(target, cum[cum.length - 1]?.cum ?? 0, 1);
  const xOf = (t: number) => 10 + ((t - t0) / (t1 - t0)) * (W - 20);
  const yOf = (v: number) => PAD_T + (1 - v / yMax) * plotH;

  // step-after path
  const path = cum
    .map((p, i) => {
      const x = xOf(p.t).toFixed(1);
      const y = yOf(p.cum).toFixed(1);
      if (i === 0) return `M${x},${yOf(0).toFixed(1)} L${x},${y}`;
      return `L${x},${yOf(cum[i - 1]!.cum).toFixed(1)} L${x},${y}`;
    })
    .join(' ');
  const lastX = cum.length ? xOf(cum[cum.length - 1]!.t) : 10;
  const hovered = hover != null ? cum[hover] : null;

  const dateGB = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div data-testid="sales-velocity">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        role="img"
        aria-label="Cumulative GDV secured over time against the appraised total"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!cum.length) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          cum.forEach((p, i) => {
            if (Math.abs(xOf(p.t) - x) < Math.abs(xOf(cum[best]!.t) - x)) best = i;
          });
          setHover(best);
        }}
      >
        {/* appraised-total reference */}
        <line x1={10} x2={W - 10} y1={yOf(target)} y2={yOf(target)} stroke={MUTED} strokeWidth="1" strokeDasharray="3 4" />
        <text x={W - 10} y={yOf(target) - 4} fontSize="9" fill={MUTED} textAnchor="end" className="fig">
          Appraised {fM(target)}
        </text>
        {/* baseline */}
        <line x1={10} x2={W - 10} y1={yOf(0)} y2={yOf(0)} stroke={GRID} strokeWidth="1" />
        {/* secured area + step line */}
        {cum.length > 0 && (
          <>
            <path d={`${path} L${lastX.toFixed(1)},${yOf(0).toFixed(1)} Z`} fill={REV} opacity="0.1" />
            <path d={path} fill="none" stroke={REV} strokeWidth="2" strokeLinejoin="round" />
            {cum.map((p, i) => (
              <circle key={i} cx={xOf(p.t)} cy={yOf(p.cum)} r={hover === i ? 4 : 2.5} fill={REV} stroke="#fff" strokeWidth="1.5" />
            ))}
          </>
        )}
        {/* x range labels */}
        {cum.length > 0 && (
          <>
            <text x={10} y={H - 6} fontSize="9" fill={MUTED} className="fig">
              {dateGB(cum[0]!.t)}
            </text>
            <text x={W - 10} y={H - 6} fontSize="9" fill={MUTED} textAnchor="end" className="fig">
              {dateGB(cum[cum.length - 1]!.t)}
            </text>
          </>
        )}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-2 min-h-[16px]">
        <span>
          Secured <b className="fig text-ink" data-testid="velocity-secured">{fM(cum[cum.length - 1]?.cum ?? 0)}</b> of {fM(target)}
        </span>
        {hovered && (
          <span className="fig text-ink-2b">
            {hovered.label} · {dateGB(hovered.t)} · {fM(hovered.cum)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Profit bridge — waterfall from GDV down through every cost block to
 * developer profit. Deductions share one hue; the two result bars are green.
 */
export function ProfitBridge({
  steps,
  profit,
}: {
  steps: Array<[label: string, value: number]>; // deductions as positive numbers
  profit: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gdv = steps.length ? steps.reduce((a, [, v]) => a + v, profit) : profit;

  const W = 720;
  const H = 210;
  const PAD_T = 26;
  const PAD_B = 34;
  const plotH = H - PAD_T - PAD_B;
  const bars = [['GDV', gdv, 'start'] as const, ...steps.map(([l, v]) => [l, v, 'ded'] as const), ['Profit', profit, 'end'] as const];
  const slotW = W / bars.length;
  const barW = Math.min(72, slotW * 0.62);
  const yOf = (v: number) => PAD_T + (1 - v / (gdv || 1)) * plotH;

  let running = gdv;
  return (
    <div data-testid="profit-bridge">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="Profit bridge from gross development value to developer profit" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={yOf(gdv * f)} y2={yOf(gdv * f)} stroke={GRID} strokeWidth="1" />
        ))}
        <line x1={0} x2={W} y1={yOf(0)} y2={yOf(0)} stroke={MUTED} strokeWidth="1" />
        {bars.map(([label, value, kind], i) => {
          const x = i * slotW + (slotW - barW) / 2;
          let top: number;
          let bottom: number;
          if (kind === 'start') {
            top = yOf(gdv);
            bottom = yOf(0);
          } else if (kind === 'end') {
            top = yOf(value);
            bottom = yOf(0);
          } else {
            const after = running - value;
            top = yOf(running);
            bottom = yOf(after);
            running = after;
          }
          const fill = kind === 'ded' ? COST : kind === 'start' ? REV : PROFIT;
          const h = Math.max(2, bottom - top);
          return (
            <g key={label} opacity={hover == null || hover === i ? 1 : 0.45} onMouseEnter={() => setHover(i)}>
              {/* connector from the previous bar's landing level */}
              {i > 0 && <line x1={x - slotW + barW + (slotW - barW) / 2} x2={x} y1={top} y2={top} stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />}
              <rect x={x} y={top} width={barW} height={h} rx="3" fill={fill} />
              <text x={x + barW / 2} y={top - 6} fontSize="10.5" textAnchor="middle" className="fig" fontWeight="600" fill={INK} data-testid={kind === 'end' ? 'bridge-profit' : undefined}>
                {kind === 'ded' ? `−${fM(value)}` : fM(value)}
              </text>
              <text x={x + barW / 2} y={H - 18} fontSize="9.5" textAnchor="middle" fill={MUTED}>
                {label.length > 13 ? `${label.slice(0, 12)}…` : label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
