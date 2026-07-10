/**
 * Demo seed mirroring the design-reference prototypes so the app is never empty
 * in sales demos: 11 pipeline deals, the Bournemouth trade-counter appraisal,
 * sales/lettings units, cost packages + contractors, photo log, data room,
 * investors, comparables, scenarios and benchmark aggregate.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.js';

const prisma = new PrismaClient();
const hash = (s: string) => hashPassword(s);
/** pounds → integer pence */
const p = (pounds: number) => BigInt(Math.round(pounds * 100));

async function main() {
  // wipe (idempotent seed)
  const tables = [
    'Payment', 'Cashflow', 'Holding', 'Investor', 'ActivityEvent', 'Task', 'Document', 'SitePhoto',
    'CostPackage', 'Contractor', 'SalesMilestone', 'Unit', 'Tenancy', 'Inspection',
    'Scenario', 'Comparable', 'Appraisal', 'BenchmarkPoint', 'IntegrationConnection',
    'Deal', 'User', 'Organisation',
  ];
  for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);

  const org = await prisma.organisation.create({ data: { name: 'Brookfield Developments' } });

  const [ao, dw, mv, pa] = await Promise.all([
    prisma.user.create({ data: { orgId: org.id, email: 'arthur@apexappraise.co.uk', password: hash('demo'), name: 'Arthur O.', role: 'ADMIN', initials: 'AO' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'dana@apexappraise.co.uk', password: hash('demo'), name: 'Dana W.', role: 'ANALYST', initials: 'DW' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'marcus@apexappraise.co.uk', password: hash('demo'), name: 'Marcus V.', role: 'SURVEYOR', initials: 'MV' } }),
    prisma.user.create({ data: { orgId: org.id, email: 'priya@apexappraise.co.uk', password: hash('demo'), name: 'Priya A.', role: 'ANALYST', initials: 'PA' } }),
  ]);
  const owners: Record<string, string> = { AO: ao.id, DW: dw.id, MV: mv.id, PA: pa.id };

  // ---- 11 pipeline deals (Projects Board prototype) ----
  const dealRows: Array<[string, string, string, string, string, number, number, number, number, number, string, string]> = [
    // name, addr, postcode, type, stage, gdv£, profit£, roc, equity£, prob, milestone, owner
    ['Northgate Trade & Industrial Park', 'Holdenhurst Road, Bournemouth', 'BH8 8EW', 'INDUSTRIAL', 'CONSTRUCTION', 7.24e6, 1.45e6, 0.25, 2.4e6, 100, 'PC Aug 2026', 'AO'],
    ['Harbour Reach', 'West Quay Road, Poole', 'BH15 1JF', 'RESIDENTIAL', 'CONSTRUCTION', 15.2e6, 2.9e6, 0.22, 4.7e6, 100, 'PC Nov 2026', 'DW'],
    ['Elm Grove Apartments', 'Charminster, Bournemouth', 'BH8 8UE', 'RESIDENTIAL', 'ACQUISITION', 9.8e6, 1.7e6, 0.2, 3.1e6, 90, 'Completion Jul 8', 'AO'],
    ['Morgan Furniture Factory', 'Holes Bay, Poole', 'BH15 2AA', 'MIXED_USE', 'OFFER', 12.6e6, 2.3e6, 0.19, 3.9e6, 60, 'Offer Jul 2', 'DW'],
    ['Stour Valley Logistics', 'Wimborne, Dorset', 'BH21 1QU', 'INDUSTRIAL', 'OFFER', 18.5e6, 3.6e6, 0.23, 5.6e6, 55, 'Bid Jul 18', 'AO'],
    ['Clovelly Road', 'Southbourne, Bournemouth', 'BH6 5EY', 'RESIDENTIAL', 'APPRAISAL', 4.1e6, 0.82e6, 0.21, 1.3e6, 50, 'DD by Jul 11', 'DW'],
    ['Westover Yard', 'Lansdowne, Bournemouth', 'BH1 3JP', 'INDUSTRIAL', 'APPRAISAL', 2.1e6, 0.34e6, 0.16, 0.7e6, 40, 'Review Jul 9', 'AO'],
    ['Kingsway Retail Units', 'Christchurch, Dorset', 'BH23 1QA', 'COMMERCIAL', 'SOURCING', 3.4e6, 0.6e6, 0.18, 1.1e6, 30, 'Site visit Jul 5', 'DW'],
    ['Southbourne Grove', 'Southbourne, Bournemouth', 'BH6 3QY', 'RESIDENTIAL', 'SOURCING', 3.9e6, 0.7e6, 0.19, 1.2e6, 25, 'Agent call', 'AO'],
    ['Old Brewery Quarter', 'Ringwood, Hampshire', 'BH24 1AJ', 'MIXED_USE', 'SALES_LETTING', 6.7e6, 1.1e6, 0.18, 2.1e6, 100, '62% sold', 'DW'],
    ['Parkstone Mews', 'Ashley Cross, Poole', 'BH14 0JY', 'RESIDENTIAL', 'COMPLETED', 5.3e6, 0.95e6, 0.19, 1.6e6, 100, 'Closed Apr 2026', 'AO'],
  ];
  const stageStatus: Record<string, string> = {
    SOURCING: 'ESTIMATE', APPRAISAL: 'ESTIMATE', OFFER: 'ESTIMATE',
    ACQUISITION: 'COMMITTED', CONSTRUCTION: 'ACTUAL', SALES_LETTING: 'ACTUAL', COMPLETED: 'ACTUAL',
  };
  const deals: Record<string, string> = {};
  for (const [name, address, postcode, assetType, stage, gdv, profit, roc, equity, prob, milestone, owner] of dealRows) {
    const d = await prisma.deal.create({
      data: {
        orgId: org.id, name, address, postcode, assetType, stage,
        figureStatus: stageStatus[stage], probability: prob,
        gdv: p(gdv), forecastProfit: p(profit), roc, equityRequired: p(equity),
        viability: roc >= 0.2 ? 'PROCEED' : roc >= 0.15 ? 'CAUTION' : 'DECLINE',
        nextMilestone: milestone, ownerId: owners[owner],
      },
    });
    deals[name] = d.id;
  }
  const northgate = deals['Northgate Trade & Industrial Park'];
  const harbourReach = deals['Harbour Reach'];

  // ---- Northgate appraisal (Development Appraisal prototype defaults) ----
  await prisma.appraisal.create({
    data: {
      orgId: org.id, dealId: northgate, isCurrent: true, label: 'Base', source: 'manual',
      efficiency: 90,
      units: JSON.stringify([
        { label: 'Trade counter units', count: 6, area: 2500, cap: 240, conf: 'high', source: 'Manual entry' },
        { label: 'Industrial / B8 warehouse', count: 1, area: 18000, cap: 165, conf: 'high', source: 'Manual entry' },
        { label: 'Mezzanine offices', count: 1, area: 3200, cap: 210, conf: 'high', source: 'Manual entry' },
      ]),
      trades: JSON.stringify([
        { label: 'Groundworks & substructure', rate: 18 },
        { label: 'Frame & superstructure', rate: 32 },
        { label: 'Envelope — roof & cladding', rate: 22 },
        { label: 'M&E services', rate: 19 },
        { label: 'Internal fit-out', rate: 9 },
        { label: 'Externals & landscaping', rate: 5 },
      ]),
      otherCosts: JSON.stringify([
        { label: 'Planning & S106 / CIL', amount: 15000000 },
        { label: 'Surveys & site investigation', amount: 3800000 },
        { label: 'Project management', amount: 6000000 },
      ]),
      profFeePct: 11, contingencyPct: 5,
      ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 3, arrangementFeePct: 1.5,
      drawFactorPct: 55, spendProfile: 'SCURVE', mezzToPct: 72, mezzRatePct: 12,
      siteMode: 'RESIDUAL', landFixed: p(350000), acqPct: 6.8, agentPct: 1.5, legalPct: 0.5,
      targetProfitOnGdvPct: 20, jvGpCoinvestPct: 10, jvPrefPct: 8, jvPromotePct: 20,
      planningStatus: 'Full consent — ref 8/24/0412', cilPerSqm: 0, s106: 0,
      startYear: 2026, startMonth: 4,
    },
  });

  // ---- Sales units (Harbour Reach — Sales CRM prototype) ----
  const salesMilestones = ['Reserved', 'Memorandum of sale', 'Searches ordered', 'Enquiries raised', 'Mortgage offer', 'Exchanged', 'Completed', 'Handover & snagging'];
  const statusForProg = (prog: number) => (prog >= 6 ? 'COMPLETED' : prog >= 5 ? 'EXCHANGED' : prog >= 3 ? 'RESERVED' : prog >= 1 ? 'RESERVED' : 'AVAILABLE');
  const depositOf = (prog: number, agreed: number) => (prog <= 0 ? null : prog >= 5 ? Math.round(agreed * 0.1) : 5000 + (prog >= 3 ? Math.round(agreed * 0.05) : 0));
  const salesRows: Array<[string, string, number, number, number, string, string, string, string, string, boolean]> = [
    ['Plot 1', '2-bed apt · 78 m²', 385000, 392000, 7, 'A. & R. Coombes', 'Hartwell & Co', '2026-01-12', 'Rightmove', 'None', false],
    ['Plot 2', '2-bed apt · 80 m²', 390000, 395000, 6, 'J. Okafor', 'Lindsay Legal', '2026-01-20', 'Agent — Savills', '£3k flooring', false],
    ['Plot 3', '1-bed apt · 56 m²', 295000, 298000, 5, 'M. Bianchi', 'Hartwell & Co', '2026-02-28', 'Rightmove', 'None', false],
    ['Plot 4', '3-bed duplex · 112 m²', 525000, 540000, 5, 'The Reardons', 'Castle & Finch', '2026-03-08', 'Direct', 'Part-exchange', false],
    ['Plot 5', '2-bed apt · 79 m²', 388000, 388000, 3, 'S. Whitaker', 'Lindsay Legal', '2026-04-22', 'Zoopla', '5% deposit paid', false],
    ['Plot 6', '1-bed apt · 54 m²', 290000, 286000, 1, 'D. Petrova', 'Awaiting instruction', '2026-05-02', 'Agent — Savills', 'None', true],
    ['Plot 7', '3-bed duplex · 115 m²', 535000, 0, 0, '', '', '', '', '', false],
    ['Plot 8', '2-bed apt · 81 m²', 395000, 0, 0, '', '', '', '', '', false],
    ['Plot 9', '2-bed apt · 80 m²', 392000, 0, 0, '', '', '', '', '', false],
    ['Plot 10', '3-bed duplex · 118 m²', 545000, 0, 0, '', '', '', '', '', false],
  ];
  let buyerUnitId = '';
  for (let i = 0; i < salesRows.length; i++) {
    const [name, spec, appr, agreed, prog, buyer, solicitor, reserved, lead, incentive, stalled] = salesRows[i];
    const dep = depositOf(prog, agreed || appr);
    const u = await prisma.unit.create({
      data: {
        orgId: org.id, dealId: harbourReach, name, spec, level: Math.floor(i / 3),
        appraisedValue: p(appr), agreedValue: agreed ? p(agreed) : null,
        status: statusForProg(prog), buyerName: buyer || null, buyerSolicitor: solicitor || null,
        leadSource: lead || null, incentive: incentive || null,
        depositHeld: dep != null ? p(dep) : null,
        reservedAt: reserved ? new Date(reserved) : null, progress: prog, stalled,
        milestones: {
          create: salesMilestones.map((m, idx) => ({
            name: m, index: idx, done: idx < prog,
            date: idx < prog && reserved ? new Date(new Date(reserved).getTime() + idx * 12 * 86400e3) : null,
          })),
        },
      },
    });
    if (name === 'Plot 1') buyerUnitId = u.id;
  }

  // ---- Lettings tenancies (Old Brewery Quarter) ----
  const obq = deals['Old Brewery Quarter'];
  const tenancyStatusForProg = (prog: number) => (prog >= 5 ? 'OCCUPIED' : prog >= 4 ? 'SIGNED' : prog >= 3 ? 'REFERENCING' : prog >= 2 ? 'APPLICATION' : 'AVAILABLE');
  const letRows: Array<[string, string, number, number, number, string, string, string, boolean]> = [
    ['Apt 1', '1-bed · 52 m²', 1450, 1475, 5, 'L. Marsh', 'OpenRent', '2026-03-01', false],
    ['Apt 2', '2-bed · 71 m²', 1850, 1875, 5, 'K. & T. Ellis', 'Rightmove', '2026-03-14', false],
    ['Apt 3', '2-bed · 73 m²', 1875, 1850, 4, 'R. Nwosu', 'Zoopla', '2026-04-10', false],
    ['Apt 4', '1-bed · 50 m²', 1425, 1425, 3, 'P. Sand', 'OpenRent', '2026-05-06', true],
    ['Apt 5', '2-bed · 70 m²', 1820, 1820, 2, 'H. Ahmed', 'Direct', '2026-05-20', false],
    ['Apt 6', '3-bed · 88 m²', 2250, 0, 0, '', '', '', false],
    ['Apt 7', '1-bed · 51 m²', 1440, 0, 0, '', '', '', false],
    ['Apt 8', '2-bed · 72 m²', 1860, 0, 0, '', '', '', false],
  ];
  for (let i = 0; i < letRows.length; i++) {
    const [name, spec, erv, agreed, prog, tenant, lead, applied, stalled] = letRows[i];
    await prisma.tenancy.create({
      data: {
        orgId: org.id, dealId: obq, name, spec, level: Math.floor(i / 3),
        ervPcm: p(erv), agreedRentPcm: agreed ? p(agreed) : null,
        tenantName: tenant || null, leadSource: lead || null,
        status: tenancyStatusForProg(prog), progress: prog,
        appliedAt: applied ? new Date(applied) : null, stalled,
        arrears: name === 'Apt 4' ? p(1425) : 0n,
      },
    });
  }

  // ---- Contractors + cost packages + photos (Cost Monitoring, on Harbour Reach) ----
  const contractorRows: Array<[string, string, string, string, string, number, number, number[]]> = [
    ['Kingsmead Plant Ltd', 'Groundworks', 'On site', '4.6', 'Cert 08 · 28 Jun', 320, 6, [42, 48, 45, 44]],
    ['Steelcraft Structures', 'Frame & envelope', 'On site', '4.1', 'Cert 06 · 30 Jun', 380, 9, [70, 74, 68, 72]],
    ['Meridian M&E', 'Building services', 'On site', '4.7', 'Cert 04 · 02 Jul', 360, 5, [38, 40, 42, 44]],
    ['Fairline Interiors', 'Fit-out', 'Mobilising', '4.3', 'Cert 01 · 15 Jul', 300, 3, [0, 12, 18, 22]],
  ];
  const contractors: Record<string, string> = {};
  for (const [name, trade, status, rating, nextCert, rate, ops, weeks] of contractorRows) {
    const c = await prisma.contractor.create({
      data: {
        orgId: org.id, name, trade, status, rating, nextCert,
        timesheetRate: p(rate), operatives: ops, weeks: JSON.stringify(weeks),
      },
    });
    contractors[name] = c.id;
  }
  const kp = contractors['Kingsmead Plant Ltd'];
  const st = contractors['Steelcraft Structures'];
  const mh = contractors['Meridian M&E'];
  const fl = contractors['Fairline Interiors'];

  const packageRows: Array<[string, string | null, number, number, number, number, number]> = [
    ['Demolition & groundworks', kp, 720000, 720000, 712000, 712000, 100],
    ['Substructure', kp, 1240000, 1240000, 1205000, 1225000, 98],
    ['Frame & envelope', st, 2860000, 2980000, 2210000, 3010000, 74],
    ['Roofing & cladding', st, 1150000, 1150000, 690000, 1180000, 60],
    ['M&E services', mh, 1680000, 1620000, 740000, 1650000, 44],
    ['Internal fit-out', fl, 1420000, 360000, 120000, 1460000, 12],
    ['External works', null, 640000, 80000, 0, 640000, 0],
  ];
  for (const [name, contractorId, budget, committed, spent, forecast, prog] of packageRows) {
    await prisma.costPackage.create({
      data: {
        orgId: org.id, dealId: harbourReach, name, contractorId,
        budget: p(budget), committed: p(committed), spent: p(spent), forecast: p(forecast),
        progressPct: prog, certificates: Math.max(0, Math.round(prog / 14)),
      },
    });
  }

  const weekCommencing = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay(); // Mon-start week
    d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    return d;
  };
  const photoRows: Array<[string, string, string]> = [
    ['Frame erection — grid lines A–F', st, '2026-06-18'],
    ['M&E first fix — level 2 risers', mh, '2026-06-16'],
    ['Cladding progress — south elevation', st, '2026-06-12'],
    ['Slab pour complete — block B', kp, '2026-06-05'],
  ];
  for (const [caption, contractorId, date] of photoRows) {
    await prisma.sitePhoto.create({
      data: {
        orgId: org.id, dealId: harbourReach, caption, contractorId,
        takenAt: new Date(date), weekCommencing: weekCommencing(date),
      },
    });
  }

  // ---- Cost-monitoring actions as tasks ----
  const actionRows: Array<[string, string, string, boolean]> = [
    ['Resolve steel package +£150k overspend', 'MV', '2026-06-23', false],
    ['Approve revised cladding RFI-042', 'AO', '2026-06-26', false],
    ['Release Valuation 7 payment certificate', 'AO', '2026-06-20', false],
    ['Confirm M&E value-engineering saving', 'DW', '2026-06-30', true],
    ['Issue fit-out contract for signature', 'AO', '2026-06-27', false],
    ['Tender external works package', 'MV', '2026-07-04', false],
  ];
  for (const [title, who, due, done] of actionRows) {
    await prisma.task.create({
      data: { orgId: org.id, dealId: harbourReach, title, aspect: 'Cost monitoring', assignee: who, due: new Date(due), done },
    });
  }
  await prisma.task.create({
    data: { orgId: org.id, dealId: northgate, title: 'Refresh trade-counter comparables', aspect: 'Comparables', assignee: 'DW', due: new Date('2026-06-24'), done: false },
  });
  await prisma.task.create({
    data: { orgId: org.id, dealId: northgate, title: 'Confirm senior debt terms with Hartwell', aspect: 'Finance', assignee: 'AO', due: new Date('2026-06-26'), done: false },
  });

  // ---- Comparables (Northgate — Comparables prototype) ----
  const compRows: Array<[string, string, number, number, number, number, number]> = [
    ['312 Maplewood Ave', 'Sold May 2026 · 0.3 mi · 22,080 ft²', 218, 2, 4, 3, 0],
    ['88 Oakridge Drive', 'Sold Apr 2026 · 0.6 mi · 24,600 ft²', 232, -3, 0, 4, -5],
    ['5 Birch Hollow Court', 'Sold Mar 2026 · 0.8 mi · 20,400 ft²', 226, 4, 2, 6, -2],
    ['Quayside Industrial', 'Sold Feb 2026 · 0.7 mi · 26,100 ft²', 240, -6, -4, 7, 3],
  ];
  for (const [address, meta, basePsf, adjSize, adjCondition, adjDate, adjLocation] of compRows) {
    await prisma.comparable.create({
      data: { orgId: org.id, dealId: northgate, address, meta, basePsf, adjSize, adjCondition, adjDate, adjLocation },
    });
  }

  // ---- Scenarios (Northgate) ----
  const scenarioRows: Array<[string, string, number, number, number, number]> = [
    ['Option A — consented scheme', 'Trade counter + B8 as consented', 205, 105, 26100, 20],
    ['Option B — add mezzanines', 'Extra mezzanine offices to 3 units', 212, 112, 28400, 20],
    ['Option C — dense trade park', 'Re-plan as 9 smaller trade units', 221, 118, 24800, 18],
  ];
  for (const [name, descriptor, blendedPsf, buildPsf, gia, targetProfitPct] of scenarioRows) {
    await prisma.scenario.create({
      data: { orgId: org.id, dealId: northgate, name, descriptor, blendedPsf, buildPsf, gia, targetProfitPct },
    });
  }

  // ---- Data room documents (Northgate) ----
  const docRows: Array<[string, string, string, number, string, boolean]> = [
    ['A-101 Site plan Rev C.pdf', 'Architectural', 'pdf', 4_200_000, 'EXTRACTED', false],
    ['A-102 Floor plans Rev C.pdf', 'Architectural', 'pdf', 6_800_000, 'EXTRACTED', false],
    ['Planning decision 8-24-0412.pdf', 'Planning', 'pdf', 1_100_000, 'EXTRACTED', false],
    ['S106 agreement — engrossed.pdf', 'Planning', 'pdf', 2_400_000, 'LINKED', false],
    ['Cost plan v3 — Gardiner.xlsx', 'Cost plans', 'xlsx', 380_000, 'EXTRACTED', false],
    ['BCIS rate benchmark Jun 2026.xlsx', 'Cost plans', 'xlsx', 240_000, 'STORED', false],
    ['Title register DT285512.pdf', 'Legal', 'pdf', 320_000, 'LINKED', false],
    ['Report on title — draft.docx', 'Legal', 'docx', 210_000, 'STORED', false],
    ['Senior facility heads of terms.pdf', 'Finance', 'pdf', 450_000, 'LINKED', false],
  ];
  for (const [name, category, ext, sizeBytes, extraction, buyerVisible] of docRows) {
    await prisma.document.create({
      data: { orgId: org.id, dealId: northgate, name, category, ext, sizeBytes: BigInt(sizeBytes), extraction, buyerVisible, addedById: ao.id },
    });
  }
  // buyer-visible docs live on the buyer's own development (Harbour Reach)
  const buyerDocs: Array<[string, string, string, number]> = [
    ['Reservation pack — Plot 1.pdf', 'Legal', 'pdf', 380_000],
    ['Contract of sale — Plot 1 (engrossment).pdf', 'Legal', 'pdf', 640_000],
  ];
  for (const [name, category, ext, sizeBytes] of buyerDocs) {
    await prisma.document.create({
      data: { orgId: org.id, dealId: harbourReach, name, category, ext, sizeBytes: BigInt(sizeBytes), extraction: 'STORED', buyerVisible: true, addedById: ao.id },
    });
  }
  const activityRows: Array<[string, string, string]> = [
    ['Dana W.', 'uploaded', 'Cost plan v3 — Gardiner.xlsx'],
    ['Arthur O.', 'extracted scheme from', 'A-102 Floor plans Rev C.pdf'],
    ['Marcus V.', 'viewed', 'Title register DT285512.pdf'],
    ['Arthur O.', 'shared data room with', 'Hartwell & Co (legal)'],
  ];
  for (const [actor, action, target] of activityRows) {
    await prisma.activityEvent.create({ data: { orgId: org.id, dealId: northgate, actor, action, target } });
  }

  // ---- Investors (Investor Portal prototype) ----
  const investorRows: Array<[string, string, string, number]> = [
    ['Brookfield Developments', 'BF', 'Arthur', 100],
    ['Meridian Capital LP', 'MC', 'Lena', 55],
    ['Private — S. Okonkwo', 'SO', 'Sade', 18],
  ];
  const baseHoldings: Array<[string, number, number, number]> = [
    ['Harbour Reach', 4_700_000, 0, 0],
    ['Old Brewery Quarter', 2_100_000, 2_760_000, 0.231],
    ['Parkstone Mews', 1_600_000, 2_040_000, 0.198],
  ];
  const investorIds: string[] = [];
  for (const [name, initials, contactFirst, sharePct] of investorRows) {
    const inv = await prisma.investor.create({
      data: {
        orgId: org.id, name, initials, contactFirst, sharePct,
        documents: JSON.stringify([
          { name: 'Q2 2026 investor report.pdf', date: '2026-06-30', size: '1.2 MB' },
          { name: 'LPA — Brookfield JV II.pdf', date: '2025-09-12', size: '3.4 MB' },
          { name: 'Distribution notice — OBQ.pdf', date: '2026-05-14', size: '220 KB' },
        ]),
      },
    });
    investorIds.push(inv.id);
    for (const [dealName, committed, distributed, irr] of baseHoldings) {
      await prisma.holding.create({
        data: {
          investorId: inv.id, dealId: deals[dealName], sharePct,
          committed: p(committed), called: p(committed * 0.82), distributed: p(distributed), irr,
        },
      });
    }
    const cfRows: Array<[string, string, string, string, number]> = [
      ['dist', 'Profit distribution', 'Old Brewery Quarter', '2026-05-14', 1_360_000],
      ['dist', 'Final distribution', 'Parkstone Mews', '2026-04-02', 2_040_000],
      ['call', 'Capital call — drawdown 3', 'Harbour Reach', '2026-02-18', -1_100_000],
      ['call', 'Capital call — drawdown 2', 'Harbour Reach', '2025-11-06', -1_600_000],
    ];
    for (const [kind, label, dealName, date, amount] of cfRows) {
      await prisma.cashflow.create({
        data: { investorId: inv.id, dealId: deals[dealName], kind, label, amount: p(amount), date: new Date(date) },
      });
    }
  }

  // ---- Portal users ----
  await prisma.user.create({
    data: {
      orgId: org.id, email: 'buyer@demo.co.uk', password: hash('demo'), name: 'A. & R. Coombes',
      role: 'VIEWER', principalType: 'buyer', initials: 'AC', buyerUnitId,
    },
  });
  await prisma.user.create({
    data: {
      orgId: org.id, email: 'investor@demo.co.uk', password: hash('demo'), name: 'Lena Fischer',
      role: 'VIEWER', principalType: 'investor', initials: 'LF', investorId: investorIds[1],
    },
  });

  // ---- Benchmark aggregate (deterministic pseudo-market around plausible medians) ----
  const regions = ['South West', 'South East', 'London', 'Midlands'];
  const useClasses = ['INDUSTRIAL', 'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE'];
  const medians: Record<string, Record<string, number>> = {
    buildPsf: { INDUSTRIAL: 108, RESIDENTIAL: 176, COMMERCIAL: 148, MIXED_USE: 162 },
    gdvPsf: { INDUSTRIAL: 214, RESIDENTIAL: 428, COMMERCIAL: 302, MIXED_USE: 355 },
    poc: { INDUSTRIAL: 0.19, RESIDENTIAL: 0.17, COMMERCIAL: 0.16, MIXED_USE: 0.17 },
  };
  const regionFactor: Record<string, number> = { 'South West': 1, 'South East': 1.09, London: 1.32, Midlands: 0.92 };
  let sd = 7;
  const pseudo = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const periods = ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
  for (const region of regions) {
    for (const useClass of useClasses) {
      for (const metric of ['buildPsf', 'gdvPsf', 'poc'] as const) {
        for (const period of periods) {
          const drift = 1 + periods.indexOf(period) * 0.014; // gentle cost inflation
          for (let i = 0; i < 10; i++) {
            const base = medians[metric][useClass] * (metric === 'poc' ? 1 : regionFactor[region]);
            const noise = 1 + (pseudo() - 0.5) * 0.36;
            await prisma.benchmarkPoint.create({
              data: { region, useClass, metric, period, value: base * noise * (metric === 'poc' ? 1 : drift) },
            });
          }
        }
      }
    }
  }
  // own contributions (South West industrial — Northgate at 105 build, 205 gdv, 25% PoC)
  const own: Array<[string, string, number, string]> = [
    ['buildPsf', 'Northgate Trade & Industrial Park', 105, '2026-Q2'],
    ['gdvPsf', 'Northgate Trade & Industrial Park', 205, '2026-Q2'],
    ['poc', 'Northgate Trade & Industrial Park', 0.25, '2026-Q2'],
    ['buildPsf', 'Westover Yard', 118, '2026-Q1'],
    ['gdvPsf', 'Westover Yard', 196, '2026-Q1'],
    ['poc', 'Westover Yard', 0.16, '2026-Q1'],
  ];
  for (const [metric, dealName, value, period] of own) {
    await prisma.benchmarkPoint.create({
      data: { region: 'South West', useClass: 'INDUSTRIAL', metric, period, value, isOwn: true, orgId: org.id, dealName },
    });
  }

  // ---- Integrations ----
  const integrations: Array<[string, string]> = [
    ['HM Land Registry', 'CONNECTED'],
    ['EPC Register', 'CONNECTED'],
    ['PriceHubble AVM', 'ATTENTION'],
    ['Planning Portal', 'NOT_CONNECTED'],
    ['Ordnance Survey', 'CONNECTED'],
    ['Environment Agency', 'NOT_CONNECTED'],
    ['BCIS', 'NOT_CONNECTED'],
    ['Xero', 'NOT_CONNECTED'],
    ['DocuSign', 'NOT_CONNECTED'],
  ];
  for (const [provider, status] of integrations) {
    await prisma.integrationConnection.create({
      data: { orgId: org.id, provider, status, lastSync: status === 'CONNECTED' ? new Date('2026-07-08T06:00:00Z') : null },
    });
  }

  console.log('Seeded:', {
    org: org.name,
    deals: dealRows.length,
    users: 6,
    login: 'arthur@apexappraise.co.uk / demo',
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
