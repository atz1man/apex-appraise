import { assetLabel } from '@apex/types/asset-classes';

/**
 * What the AI Development Director's Manual entry form starts from.
 *
 * It started from the DEMO SCHEME. `DEFAULT_MANUAL` was the prototype's state
 * copied verbatim — "Northgate Trade & Industrial Park, Holdenhurst Road,
 * Bournemouth BH8 8EW", full consent granted, six trade-counter units, a B8
 * warehouse, mezzanine offices, an asking price of £400,000 and Northgate's
 * own CIL and S106 — on every deal of every firm. Measured on Parkstone Mews:
 * the form named Northgate, and "Open full appraisal" would have saved that
 * unit schedule and that land price to Parkstone as a new version. The AI
 * panel beside it discloses its worked example and the server marks an
 * extraction of it `sample: true`; the manual form marks itself `sample:
 * false` — "the user's own scheme, never the worked example" — while carrying
 * the example's figures.
 *
 * So the form is seeded from the deal's own record — name, address, asset
 * type — and from nothing else that is a fact about a scheme: no units, no
 * asking price, no planning obligations. The percentages that remain are the
 * house assumptions an appraiser would type first anyway, and they are
 * assumptions, not facts about Northgate.
 */
export interface ManualUnit {
  label: string;
  count: number;
  area: number;
  value: number;
}

export interface ManualState {
  scheme: string;
  address: string;
  assetType: string;
  planningStatus: string;
  units: ManualUnit[];
  efficiency: number;
  profFee: number;
  contingency: number;
  targetProfit: number;
  asking: number;
  cilPerSqm: number;
  s106: number;
  agent: number;
  legal: number;
  acq: number;
  finance: { ltc: number; rate: number; period: number; sales: number; arrFee: number };
}

/** the assumptions, not the facts: what an appraiser types first on any scheme */
export const HOUSE_ASSUMPTIONS = {
  efficiency: 90,
  profFee: 11,
  contingency: 5,
  targetProfit: 20,
  agent: 1.5,
  legal: 0.5,
  acq: 1.8,
  finance: { ltc: 60, rate: 7.5, period: 18, sales: 3, arrFee: 1.5 },
} as const;

export type DealLike = { name: string; address: string; postcode?: string | null; assetType: string } | null | undefined;

export function manualDefaultsFor(deal: DealLike): ManualState {
  return {
    scheme: deal?.name ?? '',
    address: deal ? [deal.address, deal.postcode].filter(Boolean).join(', ') : '',
    assetType: deal ? assetLabel(deal.assetType) : '',
    planningStatus: '',
    units: [],
    asking: 0,
    cilPerSqm: 0,
    s106: 0,
    ...HOUSE_ASSUMPTIONS,
    finance: { ...HOUSE_ASSUMPTIONS.finance },
  };
}

/** a scheme can be run once it has something to sell: a unit with a count, an area and a value */
export function manualIsRunnable(m: Pick<ManualState, 'units'>): boolean {
  return m.units.some((u) => u.count > 0 && u.area > 0 && u.value > 0);
}
