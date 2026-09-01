import type { Appraisal, PrismaClient } from '@prisma/client';
import { computeAppraisal, outturnBuildPsf } from '@apex/appraisal-engine';
import { appraisalRowToEngineInput, P } from './mappers.js';
import { latestApproved } from './current-appraisal.js';
import { recordAudit } from './audit.js';

/**
 * How the benchmark pool grows.
 *
 * It grew by hand: a Contribute button on the Benchmarking screen, one deal at
 * a time, and what it contributed was the CURRENT appraisal whatever its review
 * state — an unreviewed draft, a what-if somebody was typing, could enter a
 * median other firms read as market evidence. A firm that had consented still
 * had to remember to press the button, per deal, per quarter, so the pool held
 * whatever anybody had got round to.
 *
 * Now the pool is fed by the events that make a figure the firm's committed
 * position, and only by those:
 *
 *   APPROVAL   `appraisal.review` approving a version contributes its three
 *              ratios — build £/ft², GDV £/ft², profit on cost — for the quarter
 *              it was approved in. A draft never enters, by any path: the manual
 *              button contributes the latest APPROVED version too.
 *   COMPLETION `deals.setStage` moving a scheme to COMPLETED contributes its
 *              out-turn build £/ft² — certified spend over the appraised area —
 *              which is the one figure in construction nobody publishes.
 *   OPT-IN     `benchmarks.setContribution` turning consent on backfills every
 *              deal with an approved version, and the out-turn of every
 *              completed one, so consenting puts the signed-off book in at once.
 *
 * `benchmark-feed-sweep.test.ts` walks the real resolvers and refuses an
 * approval or completion path that does not call into here.
 *
 * Consent is checked HERE, on every feed, not only at the button: a firm that
 * has not opted in contributes nothing whichever event fires. Only derived
 * ratios leave the workspace — never absolute money, never the address; the
 * deal name is stored so the firm can find its own point again and is returned
 * to nobody else.
 */

export const APPRAISAL_METRICS = ['buildPsf', 'gdvPsf', 'poc'] as const;
export const OUTTURN_METRIC = 'outturnPsf' as const;
export const METRICS = [...APPRAISAL_METRICS, OUTTURN_METRIC] as const;
export type BenchmarkMetric = (typeof METRICS)[number];

const REGION_BY_COUNTY: Array<[RegExp, string]> = [
  [/dorset|bournemouth|poole|hampshire|devon|somerset|bristol/i, 'South West'],
  [/london/i, 'London'],
  [/kent|surrey|sussex|berkshire|oxford/i, 'South East'],
];
export const regionFor = (address: string): string => REGION_BY_COUNTY.find(([re]) => re.test(address))?.[1] ?? 'South West';

/** "2026-Q3" — the period a point is filed under */
export const quarterOf = (d: Date): string => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;

export interface FeedActor {
  userId: string;
  name: string;
  ip?: string | null;
}
export interface FeedDeal {
  id: string;
  name: string;
  address: string;
  assetType: string;
  stage: string;
}
export interface FeedResult {
  region: string;
  useClass: string;
  period: string;
  metrics: BenchmarkMetric[];
}

export async function consentsToBenchmarks(prisma: PrismaClient, orgId: string): Promise<boolean> {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { contributesBenchmarks: true } });
  return !!org?.contributesBenchmarks;
}

/**
 * Replace this DEAL's previous points for the period and the metrics being
 * written, then write fresh. Scoped to the metrics in hand: the approval feed
 * must not erase the out-turn point a completion wrote in the same quarter, and
 * vice versa. The `dealId: null` arm sweeps points contributed before the deal
 * id existed — see the note in the benchmarks router's history.
 */
async function replacePoints(
  prisma: PrismaClient,
  orgId: string,
  deal: FeedDeal,
  period: string,
  points: Array<[BenchmarkMetric, number]>,
) {
  const region = regionFor(deal.address);
  await prisma.benchmarkPoint.deleteMany({
    where: {
      source: 'contributed',
      orgId,
      period,
      metric: { in: points.map(([m]) => m) },
      OR: [{ dealId: deal.id }, { dealId: null, dealName: deal.name }],
    },
  });
  for (const [metric, value] of points) {
    await prisma.benchmarkPoint.create({
      data: { region, useClass: deal.assetType, metric, period, value, source: 'contributed', orgId, dealId: deal.id, dealName: deal.name },
    });
  }
  return region;
}

/**
 * An approved version's three ratios, filed under the quarter it was approved
 * in. Null when the firm has not consented, or the version has no area or
 * revenue to make a ratio of.
 */
export async function feedApproved(
  prisma: PrismaClient,
  orgId: string,
  deal: FeedDeal,
  version: Appraisal,
  actor: FeedActor,
): Promise<FeedResult | null> {
  if (version.reviewStatus !== 'approved') return null;
  if (!(await consentsToBenchmarks(prisma, orgId))) return null;
  const R = computeAppraisal(appraisalRowToEngineInput(version));
  if (R.gia <= 0 || R.gdv <= 0) return null;
  const period = quarterOf(version.reviewedAt ?? new Date());
  const points: Array<[BenchmarkMetric, number]> = [
    ['buildPsf', R.buildRate],
    ['gdvPsf', R.gdv / R.gia],
    ['poc', R.poc],
  ];
  const region = await replacePoints(prisma, orgId, deal, period, points);
  await recordAudit(prisma, {
    orgId, dealId: deal.id, userId: actor.userId, actor: actor.name, ip: actor.ip ?? null,
    action: 'contributed to benchmark',
    target: `${region} · ${deal.assetType.toLowerCase()} · ${period} · from “${version.label}”`,
  });
  return { region, useClass: deal.assetType, period, metrics: [...APPRAISAL_METRICS] };
}

/**
 * A completed scheme's out-turn build cost: certified spend across its cost
 * packages over the floor area of its latest approved appraisal. Null when the
 * firm has not consented, nothing was approved (no area anyone signed), or
 * nothing was certified.
 */
export async function feedOutturn(prisma: PrismaClient, orgId: string, deal: FeedDeal, actor: FeedActor): Promise<FeedResult | null> {
  if (deal.stage !== 'COMPLETED') return null;
  if (!(await consentsToBenchmarks(prisma, orgId))) return null;
  const approved = await latestApproved(prisma.appraisal, deal.id, orgId);
  if (!approved) return null;
  const gia = computeAppraisal(appraisalRowToEngineInput(approved)).gia;
  const packages = await prisma.costPackage.findMany({ where: { dealId: deal.id, orgId }, select: { spent: true } });
  const spent = packages.reduce((a, pk) => a + P(pk.spent), 0);
  const psf = outturnBuildPsf(spent, gia);
  if (psf == null) return null;
  const period = quarterOf(new Date());
  const region = await replacePoints(prisma, orgId, deal, period, [[OUTTURN_METRIC, psf]]);
  await recordAudit(prisma, {
    orgId, dealId: deal.id, userId: actor.userId, actor: actor.name, ip: actor.ip ?? null,
    action: 'contributed out-turn to benchmark',
    target: `${region} · ${deal.assetType.toLowerCase()} · ${period} · £${Math.round(psf)}/ft² certified`,
  });
  return { region, useClass: deal.assetType, period, metrics: [OUTTURN_METRIC] };
}

/**
 * Everything a newly consenting firm has already signed off. Returns how many
 * deals contributed something.
 */
export async function backfill(prisma: PrismaClient, orgId: string, actor: FeedActor): Promise<number> {
  const deals = await prisma.deal.findMany({
    where: { orgId },
    select: { id: true, name: true, address: true, assetType: true, stage: true },
  });
  let fed = 0;
  for (const deal of deals) {
    const approved = await latestApproved(prisma.appraisal, deal.id, orgId);
    const a = approved ? await feedApproved(prisma, orgId, deal, approved, actor) : null;
    const o = await feedOutturn(prisma, orgId, deal, actor);
    if (a || o) fed += 1;
  }
  return fed;
}
