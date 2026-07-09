import type { Appraisal } from '@prisma/client';
import type { AppraisalInput, SpendProfileKey } from '@apex/appraisal-engine';

/** BigInt pence → £ number (engine-internal unit). */
export const P = (pence: bigint | null | undefined): number => (pence == null ? 0 : Number(pence) / 100);
/** £ number → BigInt pence for persistence. */
export const toPence = (pounds: number): bigint => BigInt(Math.round(pounds * 100));

const spendProfileMap: Record<string, SpendProfileKey> = {
  SCURVE: 'scurve',
  EVEN: 'even',
  FRONT: 'front',
  BACK: 'back',
};

/** SQLite dev DB stores JSON columns as strings — parse defensively. */
export const J = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** DB appraisal row → engine input (£). otherCosts are stored in pence. */
export function appraisalRowToEngineInput(a: Appraisal): AppraisalInput {
  const units = J<Array<{ label: string; count: number; area: number; cap: number; conf?: 'high' | 'med' | 'low'; source?: string }>>(a.units, []);
  const trades = J<Array<{ label: string; rate: number }>>(a.trades, []);
  const otherCosts = J<Array<{ label: string; amount: number }>>(a.otherCosts, []).map((o) => ({
    label: o.label,
    amount: o.amount / 100,
  }));
  return {
    units,
    efficiency: a.efficiency,
    trades,
    profFeePct: a.profFeePct,
    contingencyPct: a.contingencyPct,
    otherCosts,
    finance: {
      ltcPct: a.ltcPct,
      ratePct: a.ratePct,
      periodMonths: a.periodMonths,
      salesMonths: a.salesMonths,
      arrangementFeePct: a.arrangementFeePct,
      spendProfile: spendProfileMap[a.spendProfile] ?? 'scurve',
    },
    site: { mode: a.siteMode === 'PROFIT' ? 'profit' : 'residual', landFixed: P(a.landFixed), acqPct: a.acqPct },
    disposal: { agentPct: a.agentPct, legalPct: a.legalPct },
    targetProfitOnGdvPct: a.targetProfitOnGdvPct,
    jv: { gpCoinvestPct: a.jvGpCoinvestPct, prefPct: a.jvPrefPct, promotePct: a.jvPromotePct },
    startYear: a.startYear ?? undefined,
    startMonth: a.startMonth ?? undefined,
  };
}
