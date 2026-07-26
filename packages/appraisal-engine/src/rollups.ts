/** Sales / lettings / portfolio roll-ups (CALCULATIONS.md §11 + DATA_MODEL.md §3). */

import type { CashflowRow } from './types.js';

export type SalesStatus = 'AVAILABLE' | 'RESERVED' | 'EXCHANGED' | 'COMPLETED' | 'HANDOVER';
export type TenancyStatus = 'AVAILABLE' | 'APPLICATION' | 'REFERENCING' | 'SIGNED' | 'OCCUPIED';

export interface SalesUnitLike {
  appraisedValue: number;
  agreedValue: number | null;
  status: SalesStatus;
  depositHeld: number | null;
}

export interface SalesRollup {
  gdvRealised: number;
  gdvAppraised: number;
  depositsHeld: number;
  salesRate: number; // (exchanged+completed+handover) / total
  counts: Record<SalesStatus, number>;
  total: number;
}

const RESERVED_PLUS: SalesStatus[] = ['RESERVED', 'EXCHANGED', 'COMPLETED', 'HANDOVER'];
const EXCHANGED_PLUS: SalesStatus[] = ['EXCHANGED', 'COMPLETED', 'HANDOVER'];

export function salesRollup(units: SalesUnitLike[]): SalesRollup {
  const counts: Record<SalesStatus, number> = {
    AVAILABLE: 0,
    RESERVED: 0,
    EXCHANGED: 0,
    COMPLETED: 0,
    HANDOVER: 0,
  };
  let gdvRealised = 0;
  let gdvAppraised = 0;
  let depositsHeld = 0;
  for (const u of units) {
    counts[u.status]++;
    gdvAppraised += u.appraisedValue;
    if (EXCHANGED_PLUS.includes(u.status)) gdvRealised += u.agreedValue ?? 0;
    if (RESERVED_PLUS.includes(u.status)) depositsHeld += u.depositHeld ?? 0;
  }
  const sold = EXCHANGED_PLUS.reduce((a, s) => a + counts[s], 0);
  return {
    gdvRealised,
    gdvAppraised,
    depositsHeld,
    salesRate: units.length ? sold / units.length : 0,
    counts,
    total: units.length,
  };
}

export interface TenancyLike {
  ervPcm: number;
  agreedRentPcm: number | null;
  status: TenancyStatus;
  arrears: number;
}

export interface LettingsRollup {
  rentRollAnnual: number; // Σ agreedRentPcm × 12 for OCCUPIED
  ervAnnual: number;
  voidRate: number; // available / total
  arrears: number;
  occupied: number;
  total: number;
}

export function lettingsRollup(tenancies: TenancyLike[]): LettingsRollup {
  let rentRoll = 0;
  let erv = 0;
  let arrears = 0;
  let occupied = 0;
  let available = 0;
  for (const t of tenancies) {
    erv += t.ervPcm * 12;
    arrears += t.arrears;
    if (t.status === 'OCCUPIED') {
      occupied++;
      rentRoll += (t.agreedRentPcm ?? 0) * 12;
    }
    if (t.status === 'AVAILABLE') available++;
  }
  return {
    rentRollAnnual: rentRoll,
    ervAnnual: erv,
    voidRate: tenancies.length ? available / tenancies.length : 0,
    arrears,
    occupied,
    total: tenancies.length,
  };
}

export interface DealLike {
  gdv: number;
  forecastProfit: number;
  equityRequired: number;
  probability: number; // 0-100
  stage: string;
}

export interface PortfolioRollup {
  pipelineGdv: number;
  weightedGdv: number; // Σ gdv×prob/100 over non-completed
  forecastProfit: number;
  equityRequired: number;
  activeCount: number;
}

export function portfolioRollup(deals: DealLike[]): PortfolioRollup {
  const active = deals.filter((d) => d.stage !== 'COMPLETED');
  return {
    pipelineGdv: active.reduce((a, d) => a + d.gdv, 0),
    weightedGdv: active.reduce((a, d) => a + (d.gdv * d.probability) / 100, 0),
    forecastProfit: active.reduce((a, d) => a + d.forecastProfit, 0),
    equityRequired: active.reduce((a, d) => a + d.equityRequired, 0),
    activeCount: active.length,
  };
}

/* ---------------------------- cashflow periods ---------------------------- */

export type Periodicity = 'month' | 'quarter' | 'year';

export interface PeriodRow {
  label: string;
  /** 1-based project months covered, inclusive */
  from: number;
  to: number;
  cost: number;
  intr: number;
  rev: number;
  net: number;
  /** cumulative position at the CLOSE of the period */
  cum: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIZE: Record<Periodicity, number> = { month: 1, quarter: 3, year: 12 };

/** Project month (1-based) → calendar month/year from the programme start. */
function calendar(m: number, startYear: number, startMonth: number) {
  const abs = startMonth + (m - 1);
  return { month: ((abs % 12) + 12) % 12, year: startYear + Math.floor(abs / 12) };
}

const yy = (year: number) => `'${String(year % 100).padStart(2, '0')}`;

/**
 * Roll a monthly cashflow into quarters or years for reporting. Periods are
 * project-relative (Q1 = the first three months of the programme, not the
 * calendar quarter) and labelled with the calendar months they cover. Sums are
 * exact: every period total adds back to the monthly ledger.
 */
export function rollUpCashflow(
  rows: CashflowRow[],
  period: Periodicity = 'month',
  opts: { startYear?: number; startMonth?: number } = {},
): PeriodRow[] {
  const startYear = opts.startYear ?? new Date().getFullYear();
  const startMonth = opts.startMonth ?? 0;
  const size = SIZE[period];
  const out: PeriodRow[] = [];

  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const from = chunk[0].m;
    const to = chunk[chunk.length - 1].m;
    const a = calendar(from, startYear, startMonth);
    const b = calendar(to, startYear, startMonth);
    const n = Math.floor(i / size) + 1;

    let label: string;
    if (period === 'month') {
      label = `${MONTHS[a.month]} ${yy(a.year)}`;
    } else {
      // a trailing stub period covers a single month — "Oct–Oct '27" reads like a bug
      const span =
        from === to
          ? `${MONTHS[a.month]} ${yy(a.year)}`
          : a.year === b.year
            ? `${MONTHS[a.month]}–${MONTHS[b.month]} ${yy(a.year)}`
            : `${MONTHS[a.month]} ${yy(a.year)}–${MONTHS[b.month]} ${yy(b.year)}`;
      label = `${period === 'quarter' ? `Q${n}` : `Year ${n}`} · ${span}`;
    }

    out.push({
      label,
      from,
      to,
      cost: chunk.reduce((s, r) => s + r.cost, 0),
      intr: chunk.reduce((s, r) => s + r.intr, 0),
      rev: chunk.reduce((s, r) => s + r.rev, 0),
      net: chunk.reduce((s, r) => s + r.net, 0),
      // the cumulative position is a running balance, so the period closes on
      // the last month's value — never the sum of the months' cumulatives
      cum: chunk[chunk.length - 1].cum,
    });
  }
  return out;
}
