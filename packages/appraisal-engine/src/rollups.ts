/** Sales / lettings / portfolio roll-ups (CALCULATIONS.md §11 + DATA_MODEL.md §3). */

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
