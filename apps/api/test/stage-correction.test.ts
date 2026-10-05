import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A stage can be corrected, and a scheme that is no longer complete stops
 * contributing its out-turn.
 *
 * `deals.setStage` has always accepted any stage. Both controls in the product
 * computed `stageIdx + 1` and clamped at the last, so in practice a stage only
 * ever went forward: a mis-click stuck, `figureStatus` hardened with it, and
 * arriving at COMPLETED contributed the scheme's certified build £/ft² into a
 * pool whose medians OTHER FIRMS read as market evidence. Nothing on the server
 * needed changing — there was simply no way to ask.
 *
 * Which made the retraction unreachable too, and that is the half worth a test:
 * a deal mis-advanced to COMPLETED would have left a final-account figure
 * standing for a scheme that had not finished, and the firm reading that median
 * in their own appraisal has no way of knowing.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const APPRAISAL_INPUT = {
  units: [{ label: 'Trade units', count: 6, area: 2_400, cap: 180 }],
  efficiency: 92,
  trades: [{ label: 'Shell', rate: 95 }],
  profFeePct: 10,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
};

const stageOf = () =>
  prisma.deal.findUniqueOrThrow({ where: { id: T.dealId }, select: { stage: true, figureStatus: true } });

const outturnPoints = () =>
  prisma.benchmarkPoint.count({ where: { dealId: T.dealId, metric: 'outturnPsf', source: 'contributed' } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('StageBack');
}, 120_000);

describe('a stage goes back as well as forward', () => {
  it('moves back one stage, and softens the figure status with it', async () => {
    // CONSTRUCTION hardens the figures to ACTUAL (figureStatusForStage)
    await caller().deals.setStage({ id: T.dealId, stage: 'CONSTRUCTION' } as never);
    expect((await stageOf()).figureStatus).toBe('ACTUAL');

    await caller().deals.setStage({ id: T.dealId, stage: 'OFFER' } as never);
    const back = await stageOf();
    expect(back.stage).toBe('OFFER');
    // the hardening is derived from the stage, so a correction un-hardens it
    expect(back.figureStatus).toBe('ESTIMATE');
  });

  it('records the correction in the audit trail like any other move', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { dealId: T.dealId, action: 'moved deal to' },
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses another firm’s deal', async () => {
    const other = await makeTenant('StageBackOther');
    await expect(caller().deals.setStage({ id: other.dealId, stage: 'OFFER' } as never)).rejects.toThrow(
      /NOT_FOUND|not found/i,
    );
  });
});

describe('leaving COMPLETED withdraws the out-turn other firms would read', () => {
  const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

  beforeAll(async () => {
    /**
     * Consent FIRST, because the feed checks it at the moment it fires: the
     * three ratios are contributed by `feedApproved` at approval, so a firm
     * that opts in afterwards has nothing filed for that version until
     * `benchmarks.optIn` backfills. Approving first and consenting second
     * tested the wrong thing and read as a missing contribution.
     */
    await prisma.organisation.update({
      where: { id: T.orgId },
      data: { contributesBenchmarks: true, plan: 'ENTERPRISE' },
    });
    // a scheme with an APPROVED appraisal and certified spend has an out-turn
    await admin().appraisal.save({ dealId: T.dealId, input: APPRAISAL_INPUT } as never);
    const version = await prisma.appraisal.findFirstOrThrow({
      where: { dealId: T.dealId, isCurrent: true },
      orderBy: { updatedAt: 'desc' },
    });
    await admin().appraisal.submitForReview({ versionId: version.id } as never);
    await admin().appraisal.review({ versionId: version.id, decision: 'approve' } as never);
    await admin().cost.createPlanFromAppraisal({ dealId: T.dealId } as never);
    const pkgs = await prisma.costPackage.findMany({ where: { dealId: T.dealId } });
    for (const pk of pkgs) {
      await prisma.costPackage.update({ where: { id: pk.id }, data: { spent: pk.budget } });
    }
  });

  it('contributes on arrival at COMPLETED', async () => {
    await admin().deals.setStage({ id: T.dealId, stage: 'COMPLETED' } as never);
    expect(await outturnPoints(), 'a completed scheme contributed no out-turn').toBe(1);
  });

  /** The point of the whole change: the figure does not outlive the completion. */
  it('withdraws it the moment the deal is no longer complete', async () => {
    await admin().deals.setStage({ id: T.dealId, stage: 'SALES_LETTING' } as never);
    expect(await outturnPoints()).toBe(0);
    const withdrawn = await prisma.activityEvent.findMany({
      where: { dealId: T.dealId, action: 'withdrew out-turn from benchmark' },
    });
    expect(withdrawn).toHaveLength(1);
  });

  /** A correction, not a withdrawal of consent — so re-completing re-contributes. */
  it('contributes again when the scheme really does complete', async () => {
    await admin().deals.setStage({ id: T.dealId, stage: 'COMPLETED' } as never);
    expect(await outturnPoints()).toBe(1);
  });

  /**
   * The approved appraisal's three ratios are a statement about a signed
   * valuation. A stage correction does not unsign anything, so they stay.
   */
  it('leaves the approved appraisal’s own ratios alone', async () => {
    const ratios = () =>
      prisma.benchmarkPoint.count({
        where: { dealId: T.dealId, metric: { in: ['buildPsf', 'gdvPsf', 'poc'] }, source: 'contributed' },
      });
    const before = await ratios();
    expect(before).toBeGreaterThan(0);
    await admin().deals.setStage({ id: T.dealId, stage: 'SALES_LETTING' } as never);
    expect(await ratios(), 'a stage correction removed a signed valuation’s ratios').toBe(before);
  });
});
