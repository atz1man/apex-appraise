/**
 * Depth for the other nine deals.
 *
 * `demo-seed.ts` builds one deal in depth (Harbour Reach: units, costs, photos,
 * tasks, investors), one with evidence (Northgate: an appraisal, comparables,
 * scenarios, documents, accepted terms), and nine shells — a name, a stage, a
 * postcode and a headline GDV, with nothing behind any of them.
 *
 * Measured in the browser on 4 September, signed in, walking every deal across
 * every tab and counting rendered empty states, error states and refusals:
 * 197 across the 11 deals. Eight deals refused the report and the Red Book
 * outright ("No appraisal saved yet"). Comparables, scenarios, costs and sales
 * were empty on ten. No deal had a field inspection, so the valuation workbench
 * was empty on all eleven. One deal had saved terms of engagement, and under
 * this product's own rule a report names a valuer ONLY from saved terms — so
 * ten of eleven reports named nobody. There was no firm policy row at all.
 *
 * A person clicking through the pipeline met empty state after empty state.
 * That is not a demo of the product; it is a demo of its empty states.
 *
 * WHAT "COHERENT" MEANS HERE, by stage, because a SOURCING deal with a cost plan
 * would be as wrong as a CONSTRUCTION deal without one:
 *
 *   SOURCING        a lead: agent particulars, a couple of tasks, activity.
 *                   No appraisal is expected yet and no terms — nobody has been
 *                   instructed. Those empties are correct and stay.
 *   APPRAISAL       an appraisal, comparables, scenarios, ISSUED terms, docs.
 *   OFFER           the same, terms ISSUED, an offer letter in the data room.
 *   ACQUISITION     terms ACCEPTED, title and heads of terms in the data room.
 *   CONSTRUCTION    cost plan broken into packages, contractors, site photos,
 *                   a field inspection, and — for a trade park — units for sale.
 *   SALES_LETTING   units and tenancies, exchanges in flight, an inspection.
 *   COMPLETED       every unit completed, an inspection, terms ACCEPTED.
 *
 * Every appraisal here is built so the engine's GDV lands close to the headline
 * figure the board already shows for that deal, because a pipeline that says
 * £4.1m and an appraisal that computes £2.7m is the kind of thing a valuer
 * notices first. The accommodation is sized from the headline: counts are
 * derived, not typed.
 *
 * Every seeded appraisal is a DRAFT. Approval writes a pin — the engine
 * version, a hash of the inputs, the figures to the penny — in the same
 * statement as the status, and a seed that marked rows "approved" without one
 * would be printing "not verified against the signed record" under a signature
 * nobody gave. A draft that renders every sheet is honest; a forged approval is
 * not.
 *
 * The geocode for each postcode is written straight into the open-data cache,
 * per the documented pattern, so the site pack can place the site and draw the
 * map with no route to postcodes.io. The OTHER site-pack feeds — sold prices,
 * planning constraints, EPCs, flood warnings — are live government data and are
 * deliberately NOT fabricated: their panels say "unreachable" truthfully when
 * they are, which is the correct thing for a demo to say about a live feed.
 */
import type { PrismaClient } from '@prisma/client';
import { depositsHeldAt } from '@apex/appraisal-engine';

/** pounds → integer pence */
const p = (pounds: number) => BigInt(Math.round(pounds * 100));
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
const ago = (n: number) => inDays(-n);

export interface DepthContext {
  orgId: string;
  /** deal name → id */
  deals: Record<string, string>;
  users: { ao: string; dw: string; mv: string; pa: string };
  contractors: { kp: string; st: string; mh: string; fl: string };
  salesMilestones: string[];
}

type Stage = 'SOURCING' | 'APPRAISAL' | 'OFFER' | 'ACQUISITION' | 'CONSTRUCTION' | 'SALES_LETTING' | 'COMPLETED';
type Asset = 'RESIDENTIAL' | 'INDUSTRIAL' | 'COMMERCIAL' | 'MIXED_USE';

interface DealSpec {
  name: string;
  address: string;
  postcode: string;
  town: string;
  asset: Asset;
  stage: Stage;
  gdv: number;
  lat: number;
  lng: number;
}

/**
 * The same eleven deals `demo-seed.ts` declares, with what this file needs:
 * the town (comparable addresses are written in it) and a coordinate for the
 * geocode cache. Coordinates are town-centre approximations — enough to place
 * the pin in the right part of the conurbation, which is all a demo map needs.
 */
const SPECS: DealSpec[] = [
  { name: 'Northgate Trade & Industrial Park', address: 'Holdenhurst Road, Bournemouth', postcode: 'BH8 8EW', town: 'Bournemouth', asset: 'INDUSTRIAL', stage: 'CONSTRUCTION', gdv: 7.24e6, lat: 50.7315, lng: -1.862 },
  { name: 'Harbour Reach', address: 'West Quay Road, Poole', postcode: 'BH15 1JF', town: 'Poole', asset: 'RESIDENTIAL', stage: 'CONSTRUCTION', gdv: 15.2e6, lat: 50.7135, lng: -1.987 },
  { name: 'Elm Grove Apartments', address: 'Charminster, Bournemouth', postcode: 'BH8 8UE', town: 'Bournemouth', asset: 'RESIDENTIAL', stage: 'ACQUISITION', gdv: 9.8e6, lat: 50.737, lng: -1.873 },
  { name: 'Morgan Furniture Factory', address: 'Holes Bay, Poole', postcode: 'BH15 2AA', town: 'Poole', asset: 'MIXED_USE', stage: 'OFFER', gdv: 12.6e6, lat: 50.722, lng: -1.995 },
  { name: 'Stour Valley Logistics', address: 'Wimborne, Dorset', postcode: 'BH21 1QU', town: 'Wimborne', asset: 'INDUSTRIAL', stage: 'OFFER', gdv: 18.5e6, lat: 50.8, lng: -1.984 },
  { name: 'Clovelly Road', address: 'Southbourne, Bournemouth', postcode: 'BH6 5EY', town: 'Southbourne', asset: 'RESIDENTIAL', stage: 'APPRAISAL', gdv: 4.1e6, lat: 50.724, lng: -1.815 },
  { name: 'Westover Yard', address: 'Lansdowne, Bournemouth', postcode: 'BH1 3JP', town: 'Bournemouth', asset: 'INDUSTRIAL', stage: 'APPRAISAL', gdv: 2.1e6, lat: 50.722, lng: -1.866 },
  { name: 'Kingsway Retail Units', address: 'Christchurch, Dorset', postcode: 'BH23 1QA', town: 'Christchurch', asset: 'COMMERCIAL', stage: 'SOURCING', gdv: 3.4e6, lat: 50.737, lng: -1.779 },
  { name: 'Southbourne Grove', address: 'Southbourne, Bournemouth', postcode: 'BH6 3QY', town: 'Southbourne', asset: 'RESIDENTIAL', stage: 'SOURCING', gdv: 3.9e6, lat: 50.728, lng: -1.806 },
  { name: 'Old Brewery Quarter', address: 'Ringwood, Hampshire', postcode: 'BH24 1AJ', town: 'Ringwood', asset: 'MIXED_USE', stage: 'SALES_LETTING', gdv: 6.7e6, lat: 50.845, lng: -1.79 },
  { name: 'Parkstone Mews', address: 'Ashley Cross, Poole', postcode: 'BH14 0JY', town: 'Poole', asset: 'RESIDENTIAL', stage: 'COMPLETED', gdv: 5.3e6, lat: 50.722, lng: -1.96 },
];

const STAGE_RANK: Record<Stage, number> = { SOURCING: 0, APPRAISAL: 1, OFFER: 2, ACQUISITION: 3, CONSTRUCTION: 4, SALES_LETTING: 5, COMPLETED: 6 };
const atLeast = (s: Stage, floor: Stage) => STAGE_RANK[s] >= STAGE_RANK[floor];

// ---------------------------------------------------------------------------
// Accommodation and build, sized from the headline GDV
// ---------------------------------------------------------------------------

interface Mix {
  label: string;
  area: number; // ft² per unit
  cap: number; // £/ft²
  weight: number; // share of GDV
}

const MIX: Record<Asset, Mix[]> = {
  RESIDENTIAL: [
    { label: '1-bed apartments', area: 560, cap: 520, weight: 0.25 },
    { label: '2-bed apartments', area: 780, cap: 495, weight: 0.5 },
    { label: '3-bed duplexes', area: 1120, cap: 470, weight: 0.25 },
  ],
  INDUSTRIAL: [
    { label: 'Trade counter units', area: 2500, cap: 235, weight: 0.4 },
    { label: 'B8 warehouse units', area: 12000, cap: 170, weight: 0.45 },
    { label: 'Ancillary offices', area: 2000, cap: 205, weight: 0.15 },
  ],
  COMMERCIAL: [
    { label: 'Ground-floor retail', area: 1500, cap: 380, weight: 0.6 },
    { label: 'First-floor offices', area: 1800, cap: 260, weight: 0.4 },
  ],
  MIXED_USE: [
    { label: 'Apartments (upper floors)', area: 740, cap: 480, weight: 0.65 },
    { label: 'Ground-floor commercial', area: 1400, cap: 340, weight: 0.35 },
  ],
};

const TRADES: Record<Asset, Array<{ label: string; rate: number }>> = {
  RESIDENTIAL: [
    { label: 'Substructure & groundworks', rate: 24 },
    { label: 'Frame & upper floors', rate: 38 },
    { label: 'Envelope — roof, walls, windows', rate: 42 },
    { label: 'M&E services', rate: 34 },
    { label: 'Internal finishes & fit-out', rate: 41 },
    { label: 'Externals & landscaping', rate: 9 },
  ],
  INDUSTRIAL: [
    { label: 'Groundworks & substructure', rate: 18 },
    { label: 'Frame & superstructure', rate: 32 },
    { label: 'Envelope — roof & cladding', rate: 22 },
    { label: 'M&E services', rate: 19 },
    { label: 'Internal fit-out', rate: 9 },
    { label: 'Externals & yard', rate: 6 },
  ],
  COMMERCIAL: [
    { label: 'Strip-out & structural repairs', rate: 14 },
    { label: 'Shopfronts & glazing', rate: 18 },
    { label: 'Roof & envelope', rate: 16 },
    { label: 'M&E services', rate: 22 },
    { label: 'Fit-out — shell & core', rate: 14 },
    { label: 'Externals & parking', rate: 5 },
  ],
  MIXED_USE: [
    { label: 'Substructure & groundworks', rate: 22 },
    { label: 'Frame & upper floors', rate: 36 },
    { label: 'Envelope', rate: 38 },
    { label: 'M&E services', rate: 30 },
    { label: 'Residential fit-out', rate: 34 },
    { label: 'Commercial shell & core', rate: 12 },
    { label: 'Externals', rate: 8 },
  ],
};

/**
 * Net-to-gross efficiency, as the appraisal stores it (a percentage). One
 * function because two things read it: `appraisalFor` writes it on the row,
 * and `closedOutCosts` has to price the build over the same GROSS area the
 * engine does, or the plan lands below the appraisal by exactly this much.
 */
const efficiencyFor = (asset: Asset) => (asset === 'INDUSTRIAL' ? 94 : 88);

/** Unit counts that put Σ(count × area × cap) within a few percent of the headline. */
function accommodationFor(asset: Asset, gdv: number) {
  return MIX[asset].map((m) => ({
    label: m.label,
    count: Math.max(1, Math.round((gdv * m.weight) / (m.area * m.cap))),
    area: m.area,
    cap: m.cap,
    conf: 'high' as const,
    source: 'Manual entry',
  }));
}

/** The GDV-weighted £/ft² of a mix — what the comparables are adjusted towards. */
function blendedPsf(asset: Asset): number {
  return Math.round(MIX[asset].reduce((a, m) => a + m.cap * m.weight, 0));
}

function planningFor(stage: Stage, asset: Asset): string {
  if (stage === 'SOURCING') return 'Pre-application — no consent';
  if (stage === 'APPRAISAL') return asset === 'INDUSTRIAL' ? 'Outline consent — reserved matters pending' : 'Pre-application advice received';
  if (stage === 'OFFER') return 'Full application submitted — decision awaited';
  return 'Full consent — conditions being discharged';
}

async function appraisalFor(prisma: PrismaClient, ctx: DepthContext, d: DealSpec) {
  const start = { SOURCING: 9, APPRAISAL: 8, OFFER: 7, ACQUISITION: 6, CONSTRUCTION: 2, SALES_LETTING: 1, COMPLETED: 1 }[d.stage];
  await prisma.appraisal.create({
    data: {
      orgId: ctx.orgId,
      dealId: ctx.deals[d.name]!,
      isCurrent: true,
      label: 'Base',
      source: 'manual',
      efficiency: efficiencyFor(d.asset),
      units: JSON.stringify(accommodationFor(d.asset, d.gdv)),
      trades: JSON.stringify(TRADES[d.asset]),
      otherCosts: JSON.stringify([
        { label: 'Planning & S106 / CIL', amount: Math.round(d.gdv * 0.012) * 100 },
        { label: 'Surveys & site investigation', amount: Math.round(d.gdv * 0.004) * 100 },
        { label: 'Project management', amount: Math.round(d.gdv * 0.008) * 100 },
      ]),
      profFeePct: 11,
      contingencyPct: 5,
      ltcPct: 60,
      ratePct: 7.5,
      periodMonths: d.asset === 'INDUSTRIAL' ? 14 : 20,
      salesMonths: d.stage === 'COMPLETED' ? 2 : 4,
      arrangementFeePct: 1.5,
      drawFactorPct: 55,
      spendProfile: 'SCURVE',
      siteMode: 'RESIDUAL',
      landFixed: p(Math.round(d.gdv * (d.asset === 'INDUSTRIAL' ? 0.18 : 0.22))),
      acqPct: 6.8,
      agentPct: 1.5,
      legalPct: 0.5,
      targetProfitOnGdvPct: d.asset === 'INDUSTRIAL' ? 18 : 20,
      jvGpCoinvestPct: 10,
      jvPrefPct: 8,
      jvPromotePct: 20,
      planningStatus: planningFor(d.stage, d.asset),
      cilPerSqm: d.asset === 'RESIDENTIAL' ? 95 : 0,
      s106: p(d.asset === 'RESIDENTIAL' ? Math.round(d.gdv * 0.01) : 0),
      startYear: 2026,
      startMonth: start,
    },
  });
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

const STREETS: Record<string, string[]> = {
  Bournemouth: ['Wessex Way', 'Richmond Hill', 'Holdenhurst Road', 'Castle Lane West', 'Ashley Road', 'Wimborne Road'],
  Poole: ['Sterte Avenue', 'Holes Bay Road', 'Commercial Road', 'Parkstone Road', 'Fleets Lane', 'Blandford Road'],
  Southbourne: ['Grand Avenue', 'Belle Vue Road', 'Southbourne Grove', 'Beaufort Road', 'Stourvale Road'],
  Christchurch: ['Bargates', 'Barrack Road', 'Stony Lane', 'Fairmile Road', 'Somerford Road'],
  Wimborne: ['Leigh Road', 'Ferndown Industrial Estate', 'Cobham Road', 'Uddens Drive', 'Brook Road'],
  Ringwood: ['Christchurch Road', 'Southampton Road', 'Hightown Road', 'Castleman Way', 'Crow Arch Lane'],
};

async function comparablesFor(prisma: PrismaClient, ctx: DepthContext, d: DealSpec) {
  const psf = blendedPsf(d.asset);
  const streets = STREETS[d.town] ?? STREETS.Bournemouth!;
  const months = ['May', 'Apr', 'Mar', 'Feb'];
  const rows = [
    { drift: 0.96, adj: [3, 2, 4, 0] },
    { drift: 1.04, adj: [-2, 0, 3, -4] },
    { drift: 0.99, adj: [2, -3, 5, 1] },
    { drift: 1.07, adj: [-5, -2, 6, 2] },
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const area = d.asset === 'RESIDENTIAL' ? 640 + i * 90 : d.asset === 'COMMERCIAL' ? 1400 + i * 220 : 9000 + i * 2600;
    await prisma.comparable.create({
      data: {
        orgId: ctx.orgId,
        dealId: ctx.deals[d.name]!,
        address: `${12 + i * 7} ${streets[i % streets.length]}`,
        meta: `Sold ${months[i]} 2026 · ${(0.3 + i * 0.25).toFixed(1)} mi · ${area.toLocaleString('en-GB')} ft²`,
        basePsf: Math.round(psf * r.drift),
        adjSize: r.adj[0]!,
        adjCondition: r.adj[1]!,
        adjDate: r.adj[2]!,
        adjLocation: r.adj[3]!,
      },
    });
  }
}

async function scenariosFor(prisma: PrismaClient, ctx: DepthContext, d: DealSpec) {
  const psf = blendedPsf(d.asset);
  const build = TRADES[d.asset].reduce((a, t) => a + t.rate, 0);
  const gia = accommodationFor(d.asset, d.gdv).reduce((a, u) => a + u.count * u.area, 0);
  const options: Array<[string, string, number, number, number, number]> =
    d.asset === 'RESIDENTIAL'
      ? [
          ['Option A — consented mix', 'Scheme as appraised', psf, build, gia, 20],
          ['Option B — more 2-beds', 'Swap the duplexes for 2-bed apartments', psf - 8, build - 4, Math.round(gia * 0.96), 20],
          ['Option C — add a floor', 'One further storey under the local plan height policy', psf - 3, build + 6, Math.round(gia * 1.18), 19],
        ]
      : [
          ['Option A — as appraised', 'Scheme as consented', psf, build, gia, 18],
          ['Option B — smaller units', 'Re-plan into more, smaller units', psf + 9, build + 5, Math.round(gia * 0.93), 18],
          ['Option C — single occupier', 'One larger unit pre-let', psf - 14, build - 9, Math.round(gia * 1.05), 16],
        ];
  for (const [name, descriptor, blended, buildPsf, g, targetProfitPct] of options) {
    await prisma.scenario.create({ data: { orgId: ctx.orgId, dealId: ctx.deals[d.name]!, name, descriptor, blendedPsf: blended, buildPsf, gia: g, targetProfitPct } });
  }
}

// ---------------------------------------------------------------------------
// Terms of engagement — the one thing that lets a report name a valuer
// ---------------------------------------------------------------------------

const HOUSE = {
  otherUsers: 'None. This report is for the addressee client only and no responsibility is accepted to any other party.',
  extentOfInvestigation: (where: string) =>
    `The valuer inspected ${where} internally and externally to the extent reasonably accessible without specialist equipment. No structural survey, opening up of the fabric, testing of services, environmental survey or measured survey was undertaken.`,
  sourcesOfInformation:
    'Areas, accommodation schedules, cost information and planning status supplied by the client and their professional team, together with comparable evidence from HM Land Registry, agency sources and the valuer’s own records. Information supplied by the client is relied upon as accurate and is not independently verified.',
  assumptions:
    'Good and marketable freehold title is held free from onerous restrictions; no deleterious materials are present; services are connected and in working order; the site is free from contamination and material flood risk; and all necessary consents have been obtained.',
  reportFormat: 'A written valuation report in the firm’s standard Red Book format, issued in PDF, together with the supporting development appraisal.',
  restrictionsOnUse:
    'The report may not be reproduced, published or relied upon by any third party without the firm’s prior written consent, and may not be quoted in whole or in part in any prospectus or circular.',
  complaintsProcedure:
    'The firm operates a complaints handling procedure in accordance with RICS requirements, a copy of which is available on request. Unresolved complaints may be referred to an independent redress scheme.',
  aiUse:
    'Artificial intelligence may be used on this instruction to assist with document extraction, report narrative, data-room questions and scenario risk commentary. No artificial intelligence system computed, adjusted or approved any figure in this valuation. All monetary outputs are produced by the deterministic Apex Appraise engine from inputs accepted by the valuer, who retains full professional responsibility for the valuation and its conclusions. The report will state which of these were actually used, and the firm will provide further detail on request.',
  // a plausible-looking registration number in seeded data is one somebody
  // real may hold; the demo's is unmistakably a sample
  valuerReg: 'RICS Registered Valuer · No. SAMPLE-0000',
};

const CLIENTS: Array<[string, string]> = [
  ['Halewood Asset Finance Ltd', '2 Temple Quay, Bristol BS1 6DZ'],
  ['Wessex Property Lending plc', '14 Castle Street, Salisbury SP1 1TT'],
  ['Meridian Capital LP', '30 Crown Place, London EC2A 4EB'],
  ['Sandbanks Developments Ltd', 'Unit 4, Poole Quay, Poole BH15 1HJ'],
  ['Dorset Housing Partnership', 'County Hall, Dorchester DT1 1XJ'],
];

async function termsFor(prisma: PrismaClient, ctx: DepthContext, d: DealSpec, i: number) {
  const status = atLeast(d.stage, 'ACQUISITION') ? 'ACCEPTED' : 'ISSUED';
  const [clientName, clientAddress] = CLIENTS[i % CLIENTS.length]!;
  const valuer = i % 2 === 0 ? 'Dana Whitlock MRICS' : 'Marcus Vale MRICS';
  const where = `${d.name}, ${d.address}`;
  const issued = ago(40 + i * 6);
  await prisma.engagementTerms.create({
    data: {
      orgId: ctx.orgId,
      dealId: ctx.deals[d.name]!,
      status,
      clientName,
      clientAddress,
      otherUsers: HOUSE.otherUsers,
      purpose:
        d.stage === 'COMPLETED'
          ? 'Post-completion valuation for the client’s financial reporting and the release of the development facility.'
          : 'Secured lending in respect of the proposed development, and the client’s internal investment decision.',
      interest: d.asset === 'COMMERCIAL' ? 'Long leasehold (125 years), subject to the occupational tenancies.' : 'Freehold, with vacant possession assumed on completion.',
      basisOfValue: 'Market Value',
      valuationDate: ago(10 + i * 3),
      extentOfInvestigation: HOUSE.extentOfInvestigation(where),
      sourcesOfInformation: HOUSE.sourcesOfInformation,
      assumptions: HOUSE.assumptions,
      specialAssumptions: atLeast(d.stage, 'CONSTRUCTION') ? 'None.' : 'That planning consent is granted substantially in the form applied for.',
      reportFormat: HOUSE.reportFormat,
      restrictionsOnUse: HOUSE.restrictionsOnUse,
      feeBasis: `A fixed fee of £${(3250 + i * 425).toLocaleString('en-GB')} plus VAT and reasonable disbursements, payable on delivery of the report.`,
      liabilityCap: p(1_500_000 + i * 250_000),
      complaintsProcedure: HOUSE.complaintsProcedure,
      aiUse: HOUSE.aiUse,
      valuerName: valuer,
      valuerReg: HOUSE.valuerReg,
      issuedAt: issued,
      acceptedAt: status === 'ACCEPTED' ? new Date(issued.getTime() + 3 * 86_400_000) : null,
      acceptedBy: status === 'ACCEPTED' ? clientName.split(' ')[0] + ' — authorised signatory' : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Site: inspection, cost plan, photos, units
// ---------------------------------------------------------------------------

async function inspectionFor(prisma: PrismaClient, ctx: DepthContext, d: DealSpec, i: number) {
  const rooms =
    d.asset === 'RESIDENTIAL' || d.asset === 'MIXED_USE'
      ? ['Entrance & common parts', 'Living / kitchen', 'Bedroom 1', 'Bedroom 2', 'Bathroom', 'External & parking']
      : ['Yard & access', 'Warehouse floor', 'Loading doors', 'Office block', 'Roof & envelope', 'Services & plant'];
  await prisma.inspection.create({
    data: {
      orgId: ctx.orgId,
      dealId: ctx.deals[d.name]!,
      surveyorId: ctx.users.mv,
      inspectedAt: ago(8 + i * 4),
      rooms: JSON.stringify(rooms.map((name, r) => ({ name, condition: 3 + ((r + i) % 3), photos: 1 + ((r + i) % 3), notes: r === 0 ? 'As described; no material defects noted.' : '' }))),
      reconciledValue: p(Math.round(d.gdv * (d.stage === 'COMPLETED' ? 1 : 0.985))),
      approachWeights: JSON.stringify(d.asset === 'COMMERCIAL' ? { salesComparison: 30, cost: 20, income: 50 } : { salesComparison: 60, cost: 20, income: 20 }),
      status: 'draft',
    },
  });
}

/** Northgate is in CONSTRUCTION and had no cost plan — the one incoherence on a built deal. */
async function northgateCosts(prisma: PrismaClient, ctx: DepthContext) {
  const dealId = ctx.deals['Northgate Trade & Industrial Park']!;
  const { kp, st, mh, fl } = ctx.contractors;
  const rows: Array<[string, string | null, number, number, number, number, number]> = [
    ['Groundworks & substructure', kp, 520000, 520000, 498000, 505000, 100],
    ['Steel frame & superstructure', st, 1180000, 1180000, 1010000, 1195000, 86],
    ['Roof & cladding envelope', st, 760000, 760000, 410000, 775000, 54],
    ['M&E services', mh, 640000, 610000, 220000, 645000, 31],
    ['Internal fit-out & mezzanines', fl, 380000, 90000, 0, 385000, 0],
    ['External works & yard', null, 240000, 0, 0, 240000, 0],
  ];
  for (const [name, contractorId, budget, committed, spent, forecast, prog] of rows) {
    await prisma.costPackage.create({
      data: { orgId: ctx.orgId, dealId, name, contractorId, budget: p(budget), committed: p(committed), spent: p(spent), forecast: p(forecast), progressPct: prog, certificates: Math.max(0, Math.round(prog / 14)) },
    });
  }
  const weekCommencing = (dt: Date) => {
    const d = new Date(dt);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d;
  };
  for (const [caption, contractorId, daysAgo] of [
    ['Portal frame complete — units 1–4', st, 5],
    ['Cladding to north elevation', st, 11],
    ['Yard drainage and kerbs', kp, 19],
  ] as Array<[string, string, number]>) {
    await prisma.sitePhoto.create({ data: { orgId: ctx.orgId, dealId, caption, contractorId, takenAt: ago(daysAgo), weekCommencing: weekCommencing(ago(daysAgo)) } });
  }
  // the base seed's Northgate tasks are skipped by `already.tasks`; the cost
  // monitor lists only the 'Cost monitoring' aspect and had none to show
  for (const [title, assignee, due, done] of [
    ['Query M&E variation — 14 items over £2k', 'MV', 4, false],
    ['Certify valuation no. 7 (steel frame)', 'AO', -6, true],
  ] as Array<[string, string, number, boolean]>) {
    await prisma.task.create({ data: { orgId: ctx.orgId, dealId, title, aspect: 'Cost monitoring', assignee, due: inDays(due), done } });
  }
}

/**
 * A closed-out cost plan for a scheme past construction.
 *
 * `northgateCosts` is a plan MID-build, hand-written so the monitor has
 * something to say about drift. A scheme in sales or completed has a different
 * story: every package certified, the final account agreed, and the out-turn
 * £/ft² is what `deals.setStage` → COMPLETED files in the benchmark pool.
 * Measured before this existed: Old Brewery Quarter (in sales) and Parkstone
 * Mews (completed) each rendered "No cost plan on this deal yet" — a scheme
 * that has been built and sold with no record of what it cost to build.
 *
 * Packages are the appraisal's own trade breakdown (`TRADES`) priced over the
 * same GROSS area the engine prices it over — net area divided by the
 * efficiency the appraisal row carries — so the package budgets sum to the
 * appraisal's construction cost to the penny, which `seed-depth.test.ts`
 * asserts by running the engine on the stored row. The first version priced
 * over NET area, and the cost monitor read a 12% saving nobody had earned.
 * The variances are the story: a few percent over on the envelope and the
 * services, a little under on externals, the way real final accounts land.
 */
async function closedOutCosts(prisma: PrismaClient, ctx: DepthContext, d: DealSpec) {
  const dealId = ctx.deals[d.name]!;
  const { kp, st, mh, fl } = ctx.contractors;
  const nia = accommodationFor(d.asset, d.gdv).reduce((a, u) => a + u.count * u.area, 0);
  const gia = nia / (efficiencyFor(d.asset) / 100);
  const contractorFor = (label: string) =>
    /ground|substructure|external|strip-out|parking/i.test(label) ? kp : /frame|envelope|roof|shopfront/i.test(label) ? st : /M&E/i.test(label) ? mh : fl;
  // final-account variance per package, as a fraction of budget; sums close to zero on purpose
  const variances = [0.012, 0.031, 0.044, 0.027, -0.008, -0.035, 0.0];
  const trades = TRADES[d.asset];
  const buildPence = BigInt(Math.round(trades.reduce((a, t) => a + t.rate, 0) * gia * 100));
  let allocated = 0n;
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]!;
    // the last package takes the rounding residual so the sum is exact
    const budget = i === trades.length - 1 ? buildPence - allocated : BigInt(Math.round(t.rate * gia * 100));
    allocated += budget;
    const final = BigInt(Math.round(Number(budget) * (1 + (variances[i] ?? 0))));
    await prisma.costPackage.create({
      data: {
        orgId: ctx.orgId,
        dealId,
        name: t.label,
        contractorId: contractorFor(t.label),
        budget,
        committed: final,
        spent: final,
        forecast: final,
        progressPct: 100,
        certificates: 8,
        retentionPct: d.stage === 'COMPLETED' ? 0 : 2.5,
      },
    });
  }
  const weekCommencing = (dt: Date) => {
    const x = new Date(dt);
    x.setUTCHours(0, 0, 0, 0);
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x;
  };
  const offset = d.stage === 'COMPLETED' ? 220 : 40;
  for (const [caption, contractorId, daysAgo] of [
    ['Practical completion — handover walk-round', fl, offset],
    ['Snagging list issued', fl, offset + 9],
    ['External works and landscaping complete', kp, offset + 23],
  ] as Array<[string, string, number]>) {
    await prisma.sitePhoto.create({ data: { orgId: ctx.orgId, dealId, caption, contractorId, takenAt: ago(daysAgo), weekCommencing: weekCommencing(ago(daysAgo)) } });
  }
}

interface UnitRow {
  name: string;
  spec: string;
  appraised: number;
  agreed: number;
  prog: number;
  buyer: string;
  solicitor: string;
  reservedDaysAgo: number;
  lead: string;
}

const statusForProg = (prog: number) => (prog >= 6 ? 'COMPLETED' : prog >= 5 ? 'EXCHANGED' : prog >= 1 ? 'RESERVED' : 'AVAILABLE');

async function unitsFor(prisma: PrismaClient, ctx: DepthContext, dealName: string, rows: UnitRow[]) {
  const dealId = ctx.deals[dealName]!;
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i]!;
    const dep = u.prog <= 0 ? null : depositsHeldAt(u.prog, { agreedValue: u.agreed || null, appraisedValue: u.appraised });
    const reserved = u.reservedDaysAgo ? ago(u.reservedDaysAgo) : null;
    await prisma.unit.create({
      data: {
        orgId: ctx.orgId,
        dealId,
        name: u.name,
        spec: u.spec,
        level: Math.floor(i / 3),
        appraisedValue: p(u.appraised),
        agreedValue: u.agreed ? p(u.agreed) : null,
        status: statusForProg(u.prog),
        buyerName: u.buyer || null,
        buyerSolicitor: u.solicitor || null,
        leadSource: u.lead || null,
        depositHeld: dep != null ? p(dep) : null,
        reservedAt: reserved,
        progress: u.prog,
        stalled: false,
        milestones: {
          create: ctx.salesMilestones.map((m, idx) => ({
            name: m,
            index: idx,
            done: idx < u.prog,
            date: idx < u.prog && reserved ? new Date(reserved.getTime() + idx * 12 * 86_400_000) : null,
          })),
        },
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Data room, tasks, activity
// ---------------------------------------------------------------------------

type Doc = [name: string, category: string, ext: string, sizeBytes: number, extraction: string];

function documentsFor(d: DealSpec): Doc[] {
  const base: Doc[] = [[`Agent particulars — ${d.name}.pdf`, 'Marketing', 'pdf', 1_900_000, 'STORED']];
  if (atLeast(d.stage, 'APPRAISAL')) base.push([`Site plan — ${d.postcode}.pdf`, 'Architectural', 'pdf', 3_400_000, 'EXTRACTED'], ['Pre-app advice letter.pdf', 'Planning', 'pdf', 620_000, 'LINKED'], ['Cost plan v1 — QS.xlsx', 'Cost plans', 'xlsx', 310_000, 'EXTRACTED']);
  if (atLeast(d.stage, 'OFFER')) base.push(['Offer letter — subject to contract.pdf', 'Legal', 'pdf', 240_000, 'STORED']);
  if (atLeast(d.stage, 'ACQUISITION')) base.push(['Title register & plan.pdf', 'Legal', 'pdf', 410_000, 'LINKED'], ['Senior facility heads of terms.pdf', 'Finance', 'pdf', 380_000, 'LINKED']);
  if (atLeast(d.stage, 'CONSTRUCTION')) base.push(['Building contract — JCT D&B.pdf', 'Legal', 'pdf', 2_100_000, 'STORED'], ['Monitoring surveyor report 03.pdf', 'Finance', 'pdf', 1_400_000, 'STORED']);
  if (atLeast(d.stage, 'SALES_LETTING')) base.push(['Sales brochure.pdf', 'Marketing', 'pdf', 8_200_000, 'STORED']);
  if (d.stage === 'COMPLETED') base.push(['Practical completion certificate.pdf', 'Legal', 'pdf', 190_000, 'STORED'], ['Final account — agreed.xlsx', 'Cost plans', 'xlsx', 290_000, 'STORED']);
  return base;
}

function tasksFor(d: DealSpec): Array<[title: string, aspect: string, who: string, dueInDays: number, done: boolean]> {
  switch (d.stage) {
    case 'SOURCING':
      return [['Arrange site visit with agent', 'Sourcing', 'DW', 4, false], ['Pull planning history for the site', 'Planning', 'PA', 7, false], ['Sound out two lenders on appetite', 'Finance', 'AO', 12, false]];
    case 'APPRAISAL':
      return [['Refresh comparable evidence', 'Comparables', 'DW', 3, false], ['Confirm CIL liability with the council', 'Planning', 'PA', 6, false], ['Issue terms of engagement to the client', 'Engagement', 'AO', -2, true]];
    case 'OFFER':
      return [['Chase vendor’s agent on the offer', 'Sourcing', 'AO', 2, false], ['Instruct title review', 'Legal', 'DW', 9, false], ['Agree fee with the QS', 'Cost plans', 'PA', -4, true]];
    case 'ACQUISITION':
      return [['Exchange contracts', 'Legal', 'AO', 5, false], ['Satisfy lender conditions precedent', 'Finance', 'DW', 8, false], ['Book pre-commencement survey', 'Site', 'MV', 14, false], ['Terms accepted by client', 'Engagement', 'AO', -9, true]];
    case 'CONSTRUCTION':
      return [['Review cladding RFI', 'Cost monitoring', 'MV', 3, false], ['Approve valuation certificate', 'Cost monitoring', 'AO', 5, false], ['Launch off-plan sales', 'Sales', 'DW', 21, false]];
    case 'SALES_LETTING':
      return [['Chase exchange on the reserved units', 'Sales', 'DW', 2, false], ['Reference the two pending tenancies', 'Lettings', 'PA', 4, false], ['Agree snagging list with contractor', 'Site', 'MV', -3, true], ['Agree final account with main contractor', 'Cost monitoring', 'PA', 12, false]];
    case 'COMPLETED':
      return [['Release retention to contractor', 'Cost monitoring', 'AO', 10, false], ['Issue final investor distribution', 'Investors', 'AO', -12, true], ['Close out planning conditions', 'Planning', 'PA', -30, true]];
  }
}

function activityFor(d: DealSpec): Array<[actor: string, action: string, target: string]> {
  const rows: Array<[string, string, string]> = [['Arthur O.', 'created deal', d.name]];
  if (atLeast(d.stage, 'APPRAISAL')) rows.push(['Dana W.', 'saved appraisal', 'Base'], ['Priya A.', 'uploaded', `Site plan — ${d.postcode}.pdf`], ['Dana W.', 'added comparables', '4 sold transactions']);
  if (atLeast(d.stage, 'OFFER')) rows.push(['Arthur O.', 'issued terms of engagement to', 'the client']);
  if (atLeast(d.stage, 'ACQUISITION')) rows.push(['Arthur O.', 'recorded acceptance of terms by', 'the client']);
  if (atLeast(d.stage, 'CONSTRUCTION')) rows.push(['Marcus V.', 'logged site inspection', `${d.name}`]);
  if (d.stage === 'COMPLETED') rows.push(['Arthur O.', 'marked deal', 'COMPLETED']);
  if (d.stage === 'SOURCING') rows.push(['Dana W.', 'uploaded', `Agent particulars — ${d.name}.pdf`]);
  return rows;
}

// ---------------------------------------------------------------------------
// Firm policy and the geocode cache
// ---------------------------------------------------------------------------

async function policyFor(prisma: PrismaClient, ctx: DepthContext) {
  await prisma.orgPolicy.create({
    data: {
      orgId: ctx.orgId,
      region: 'GB',
      aiPolicy: HOUSE.aiUse,
      toePurpose: 'Secured lending in respect of the proposed development, and the client’s internal investment decision.',
      toeOtherUsers: HOUSE.otherUsers,
      toeInterest: 'Freehold, with vacant possession assumed on completion.',
      toeExtentOfInvestigation: HOUSE.extentOfInvestigation('the subject property'),
      toeSourcesOfInformation: HOUSE.sourcesOfInformation,
      toeAssumptions: HOUSE.assumptions,
      toeSpecialAssumptions: 'None.',
      toeReportFormat: HOUSE.reportFormat,
      toeRestrictionsOnUse: HOUSE.restrictionsOnUse,
      toeFeeBasis: 'A fixed fee agreed per instruction, plus VAT and reasonable disbursements, payable on delivery of the report.',
      toeComplaintsProcedure: HOUSE.complaintsProcedure,
      toeValuerReg: HOUSE.valuerReg,
      toeLiabilityCap: p(2_000_000),
    },
  });
}

async function geocodeCache(prisma: PrismaClient) {
  for (const d of SPECS) {
    const key = `geocode:${d.postcode.replace(/\s+/g, '').toUpperCase()}`;
    const payload = JSON.stringify({ postcode: d.postcode, latitude: d.lat, longitude: d.lng, district: d.town === 'Ringwood' ? 'New Forest' : d.town === 'Wimborne' ? 'Dorset' : 'Bournemouth, Christchurch and Poole', region: 'South West' });
    await prisma.openDataCache.upsert({ where: { key }, create: { key, source: 'postcodes.io', payload }, update: { payload, source: 'postcodes.io', fetchedAt: new Date() } });
  }
}

// ---------------------------------------------------------------------------

export async function seedDepth(prisma: PrismaClient, ctx: DepthContext): Promise<void> {
  await policyFor(prisma, ctx);
  await geocodeCache(prisma);

  const already = {
    appraisal: new Set(['Northgate Trade & Industrial Park', 'Harbour Reach', 'Kingsway Retail Units']),
    comparables: new Set(['Northgate Trade & Industrial Park']),
    scenarios: new Set(['Northgate Trade & Industrial Park']),
    terms: new Set(['Northgate Trade & Industrial Park']),
    documents: new Set(['Northgate Trade & Industrial Park']),
    tasks: new Set(['Northgate Trade & Industrial Park', 'Harbour Reach']),
    activity: new Set(['Northgate Trade & Industrial Park']),
  };

  for (let i = 0; i < SPECS.length; i++) {
    const d = SPECS[i]!;
    const dealId = ctx.deals[d.name];
    if (!dealId) continue;

    if (atLeast(d.stage, 'APPRAISAL') && !already.appraisal.has(d.name)) await appraisalFor(prisma, ctx, d);
    if (atLeast(d.stage, 'APPRAISAL') && !already.comparables.has(d.name)) await comparablesFor(prisma, ctx, d);
    if (atLeast(d.stage, 'APPRAISAL') && !already.scenarios.has(d.name)) await scenariosFor(prisma, ctx, d);
    if (atLeast(d.stage, 'APPRAISAL') && !already.terms.has(d.name)) await termsFor(prisma, ctx, d, i);
    if (atLeast(d.stage, 'CONSTRUCTION')) await inspectionFor(prisma, ctx, d, i);

    if (!already.documents.has(d.name)) {
      for (const [name, category, ext, sizeBytes, extraction] of documentsFor(d)) {
        await prisma.document.create({ data: { orgId: ctx.orgId, dealId, name, category, ext, sizeBytes: BigInt(sizeBytes), extraction, buyerVisible: false, addedById: ctx.users.ao } });
      }
    }
    if (!already.tasks.has(d.name)) {
      for (const [title, aspect, assignee, due, done] of tasksFor(d)) {
        await prisma.task.create({ data: { orgId: ctx.orgId, dealId, title, aspect, assignee, due: inDays(due), done } });
      }
    }
    if (!already.activity.has(d.name)) {
      for (const [actor, action, target] of activityFor(d)) {
        await prisma.activityEvent.create({ data: { orgId: ctx.orgId, dealId, actor, action, target } });
      }
    }
  }

  await northgateCosts(prisma, ctx);
  for (const d of SPECS) if (atLeast(d.stage, 'SALES_LETTING')) await closedOutCosts(prisma, ctx, d);

  // a trade park in construction sells its units off-plan
  await unitsFor(prisma, ctx, 'Northgate Trade & Industrial Park', [
    { name: 'Unit 1', spec: 'Trade counter · 2,500 ft²', appraised: 587500, agreed: 595000, prog: 5, buyer: 'Toolstation Ltd', solicitor: 'Lester Aldridge', reservedDaysAgo: 70, lead: 'Agent — Vail Williams' },
    { name: 'Unit 2', spec: 'Trade counter · 2,500 ft²', appraised: 587500, agreed: 580000, prog: 5, buyer: 'Howdens Joinery', solicitor: 'Coles Miller', reservedDaysAgo: 58, lead: 'Direct' },
    { name: 'Unit 3', spec: 'Trade counter · 2,500 ft²', appraised: 587500, agreed: 590000, prog: 3, buyer: 'City Plumbing', solicitor: 'Lester Aldridge', reservedDaysAgo: 24, lead: 'Agent — Vail Williams' },
    { name: 'Unit 4', spec: 'Trade counter · 2,500 ft²', appraised: 587500, agreed: 0, prog: 0, buyer: '', solicitor: '', reservedDaysAgo: 0, lead: '' },
    { name: 'Unit 5', spec: 'B8 warehouse · 18,000 ft²', appraised: 2970000, agreed: 0, prog: 0, buyer: '', solicitor: '', reservedDaysAgo: 0, lead: '' },
    { name: 'Unit 6', spec: 'Mezzanine offices · 3,200 ft²', appraised: 672000, agreed: 0, prog: 0, buyer: '', solicitor: '', reservedDaysAgo: 0, lead: '' },
  ]);

  // a mixed-use scheme in sales: the eight lets exist already; the commercial units are for sale
  await unitsFor(prisma, ctx, 'Old Brewery Quarter', [
    { name: 'Commercial 1', spec: 'Café / retail · 1,350 ft²', appraised: 459000, agreed: 452000, prog: 7, buyer: 'Bakehouse Coffee Ltd', solicitor: 'Ellis Jones', reservedDaysAgo: 140, lead: 'Agent — Goadsby' },
    { name: 'Commercial 2', spec: 'Retail · 1,200 ft²', appraised: 408000, agreed: 410000, prog: 6, buyer: 'Ringwood Pharmacy', solicitor: 'Ellis Jones', reservedDaysAgo: 110, lead: 'Direct' },
    { name: 'Commercial 3', spec: 'Office · 1,600 ft²', appraised: 544000, agreed: 540000, prog: 4, buyer: 'Avon Valley Architects', solicitor: 'Coles Miller', reservedDaysAgo: 35, lead: 'Agent — Goadsby' },
    { name: 'Commercial 4', spec: 'Retail · 1,100 ft²', appraised: 374000, agreed: 0, prog: 0, buyer: '', solicitor: '', reservedDaysAgo: 0, lead: '' },
  ]);

  // completed and closed out: every unit through to completion
  await unitsFor(
    prisma,
    ctx,
    'Parkstone Mews',
    ['J. & M. Farrell', 'S. Okafor', 'The Hendersons', 'L. Brandt', 'A. Kowalski', 'R. & P. Nash'].map((buyer, i) => ({
      name: `Mews ${i + 1}`,
      spec: i % 2 ? '3-bed house · 1,120 ft²' : '2-bed house · 880 ft²',
      appraised: i % 2 ? 526000 : 435000,
      agreed: i % 2 ? 530000 : 432000,
      prog: 8,
      buyer,
      solicitor: ['Hartwell & Co', 'Lindsay Legal', 'Castle & Finch'][i % 3]!,
      reservedDaysAgo: 260 - i * 18,
      lead: ['Rightmove', 'Agent — Savills', 'Direct'][i % 3]!,
    })),
  );
}
