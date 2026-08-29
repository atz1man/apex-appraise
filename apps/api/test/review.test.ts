import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Review and approval.
 *
 * The point of the feature is not the status field — it is that an approval
 * cannot be quietly undone. Most of these tests are about that.
 */

let T: Tenant;
let analyst: Tenant['principal'];

const input = (rate = 110) => ({
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

const current = async () =>
  prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, isCurrent: true } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Review');
  analyst = { ...T.principal, role: 'ANALYST' };
  await callerFor(T.principal).appraisal.save({ dealId: T.dealId, input: input(), label: 'Base' } as never);
}, 120_000);

describe('the review round trip', () => {
  it('starts as a draft', async () => {
    expect((await current()).reviewStatus).toBe('draft');
  });

  it('lets any internal member submit — asking for a second pair of eyes needs no permission', async () => {
    const v = await current();
    await callerFor(analyst).appraisal.submitForReview({ versionId: v.id } as never);
    const after = await current();
    expect(after.reviewStatus).toBe('in_review');
    expect(after.submittedById).toBe(analyst.userId);
  });

  it('refuses an approval from a seat that does not carry the responsibility', async () => {
    const v = await current();
    await expect(
      callerFor({ ...T.principal, role: 'SURVEYOR' }).appraisal.review({ versionId: v.id, decision: 'approve' } as never),
    ).rejects.toThrow(/Admin/i);
    expect((await current()).reviewStatus).toBe('in_review');
  });

  it('will not send work back without saying why', async () => {
    const v = await current();
    await expect(
      callerFor(T.principal).appraisal.review({ versionId: v.id, decision: 'request_changes' } as never),
    ).rejects.toThrow(/what needs changing/i);
  });

  it('records who approved it and when', async () => {
    const v = await current();
    await callerFor(T.principal).appraisal.review({ versionId: v.id, decision: 'approve', note: 'Rates check out' } as never);
    const after = await current();
    expect(after.reviewStatus).toBe('approved');
    expect(after.reviewedById).toBe(T.principal.userId);
    expect(after.reviewedAt).toBeInstanceOf(Date);
    expect(after.reviewNote).toBe('Rates check out');
  });
});

describe('an approved version cannot be quietly changed', () => {
  it('refuses an in-place save, and names the way forward', async () => {
    await expect(
      callerFor(T.principal).appraisal.save({ dealId: T.dealId, input: input(130) } as never),
    ).rejects.toThrow(/approved and cannot be edited.*new version/s);

    // and the approved figures are untouched
    const v = await current();
    expect(v.reviewStatus).toBe('approved');
    expect(JSON.parse(v.trades)[0].rate).toBe(110);
  });

  it('accepts the same change as a new version, which starts as a draft', async () => {
    await callerFor(T.principal).appraisal.save({
      dealId: T.dealId,
      input: input(130),
      asNewVersion: true,
      label: 'Post-tender',
    } as never);
    const v = await current();
    expect(v.label).toBe('Post-tender');
    // a new version inherits no approval — it has to earn its own
    expect(v.reviewStatus).toBe('draft');
    expect(v.reviewedById).toBeNull();

    // the approved version still exists, still approved, still at the old rate
    const approved = await prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, label: 'Base' } });
    expect(approved.reviewStatus).toBe('approved');
    expect(JSON.parse(approved.trades)[0].rate).toBe(110);
  });

  it('cannot be decided on twice', async () => {
    const approved = await prisma.appraisal.findFirstOrThrow({ where: { dealId: T.dealId, label: 'Base' } });
    await expect(
      callerFor(T.principal).appraisal.review({ versionId: approved.id, decision: 'request_changes', note: 'changed my mind' } as never),
    ).rejects.toThrow(/only a version in review/i);
  });
});

describe('editing a version that is out for review', () => {
  it('takes it off the reviewer’s desk rather than letting them approve something that moved', async () => {
    await callerFor(T.principal).appraisal.save({
      dealId: T.dealId, input: input(120), asNewVersion: true, label: 'Mid-review edit',
    } as never);
    const v = await current();
    await callerFor(analyst).appraisal.submitForReview({ versionId: v.id } as never);
    expect((await current()).reviewStatus).toBe('in_review');

    // the analyst keeps working — the save is allowed, but it withdraws.
    // expectedUpdatedAt because this edits the version in place; submitForReview
    // touched the row, so it is the post-submission stamp that has to be sent
    const held = await current();
    await callerFor(analyst).appraisal.save({
      dealId: T.dealId,
      input: input(125),
      expectedUpdatedAt: held.updatedAt,
    } as never);
    const after = await current();
    expect(after.reviewStatus).toBe('draft');
    expect(after.submittedById).toBeNull();
    expect(JSON.parse(after.trades)[0].rate).toBe(125);

    // and the withdrawal is on the record, not silent
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: { contains: 'withdrawing' } },
    });
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('resubmission', () => {
  it('clears the previous decision, which referred to a version that no longer exists in that form', async () => {
    const v = await current();
    await callerFor(analyst).appraisal.submitForReview({ versionId: v.id } as never);
    await callerFor(T.principal).appraisal.review({ versionId: v.id, decision: 'request_changes', note: 'Check the contingency' } as never);
    expect((await current()).reviewStatus).toBe('changes_requested');

    await callerFor(analyst).appraisal.submitForReview({ versionId: v.id } as never);
    const after = await current();
    expect(after.reviewStatus).toBe('in_review');
    expect(after.reviewNote).toBeNull();
    expect(after.reviewedById).toBeNull();
  });

  it('states plainly when one person did both halves', async () => {
    const v = await current();
    await callerFor(T.principal).appraisal.submitForReview({ versionId: v.id } as never);
    await callerFor(T.principal).appraisal.review({ versionId: v.id, decision: 'approve' } as never);

    const versions = (await callerFor(T.principal).appraisal.versions(T.dealId)) as Array<{
      isCurrent: boolean;
      review: { selfApproved: boolean; reviewedBy: string | null };
    }>;
    const cur = versions.find((x) => x.isCurrent)!;
    // a sole practitioner approving their own work is legitimate; the record says
    // so rather than leaving a reader to notice two names are the same
    expect(cur.review.selfApproved).toBe(true);
    expect(cur.review.reviewedBy).toBe('Review Owner');
  });
});

describe('what the printed report can learn about a signature', () => {
  it('tells the report when the version was signed off, and by what decision', async () => {
    // both reports dated themselves from the reader's clock, so a valuation
    // re-dated its own signature every time anybody opened it. The date they
    // print now comes from here — see apps/web/src/lib/report-dates.ts
    // the describes above leave the current version approved; branch a fresh
    // one so this is testing its own state rather than the previous test's
    await callerFor(T.principal).appraisal.save({
      dealId: T.dealId, input: input(112), asNewVersion: true, label: 'For signature',
    } as never);
    const v = await current();
    await callerFor(analyst).appraisal.submitForReview({ versionId: v.id } as never);
    await callerFor(T.principal).appraisal.review({ versionId: v.id, decision: 'approve' } as never);

    const cur = (await callerFor(T.principal).appraisal.getCurrent(T.dealId)) as {
      reviewStatus: string;
      reviewedAt: Date | null;
      updatedAt: Date;
    };
    expect(cur.reviewStatus).toBe('approved');
    expect(cur.reviewedAt).toBeInstanceOf(Date);
    // the two are different facts: a version can be saved after it was signed
    expect(cur.reviewedAt).not.toBeNull();
  });

  it('says plainly that a draft has no signing date, rather than offering one', async () => {
    await callerFor(T.principal).appraisal.save({
      dealId: T.dealId, input: input(115), asNewVersion: true, label: 'Unsigned',
    } as never);
    const cur = (await callerFor(T.principal).appraisal.getCurrent(T.dealId)) as {
      reviewStatus: string;
      reviewedAt: Date | null;
    };
    expect(cur.reviewStatus).toBe('draft');
    expect(cur.reviewedAt).toBeNull();
  });
});

describe('the queue across deals', () => {
  // the describes above leave the current version approved; a queue test that
  // inherits that state is testing the previous test's leftovers
  beforeAll(async () => {
    await callerFor(T.principal).appraisal.save({
      dealId: T.dealId, input: input(140), asNewVersion: true, label: 'For the queue',
    } as never);
  });

  it('shows a reviewer what is waiting, oldest first, and never another org’s work', async () => {
    const other = await makeTenant('Rival');
    await callerFor(other.principal).appraisal.save({ dealId: other.dealId, input: input(), label: 'Theirs' } as never);
    const theirs = await prisma.appraisal.findFirstOrThrow({ where: { dealId: other.dealId, isCurrent: true } });
    await callerFor(other.principal).appraisal.submitForReview({ versionId: theirs.id } as never);

    const v = await current();
    await callerFor(analyst).appraisal.submitForReview({ versionId: v.id } as never);

    const q = (await callerFor(T.principal).appraisal.reviewQueue()) as {
      awaitingReview: Array<{ dealId: string; dealName: string; submittedBy: string | null }>;
    };
    expect(q.awaitingReview.map((x) => x.dealId)).toContain(T.dealId);
    // the rival firm's submission is not in this firm's queue
    expect(q.awaitingReview.map((x) => x.dealId)).not.toContain(other.dealId);
    expect(q.awaitingReview[0]!.dealName).toBe('Review Wharf');
    expect(q.awaitingReview[0]!.submittedBy).toBe('Review Owner');
  });

  it('shows an analyst nothing to review, but does show their own work coming back', async () => {
    const v = await current();
    await callerFor(T.principal).appraisal.review({ versionId: v.id, decision: 'request_changes', note: 'Contingency looks light' } as never);

    const asAnalyst = (await callerFor(analyst).appraisal.reviewQueue()) as {
      awaitingReview: unknown[];
      returnedToMe: Array<{ reviewNote: string | null }>;
    };
    // a queue they cannot act on would be noise dressed as a task
    expect(asAnalyst.awaitingReview).toEqual([]);
    expect(asAnalyst.returnedToMe[0]!.reviewNote).toBe('Contingency looks light');
  });
});


/**
 * Two admins deciding one version at the same moment.
 *
 * `review` read the row, checked it was `in_review`, and then wrote — the shape
 * `a0acf31` found across the three payment paths and `engagement.sign` carried
 * in the public signing flow. Both callers passed the check and both wrote.
 * Measured before the fix, one approving while the other asked for changes:
 *
 *   FINAL STATUS      changes_requested
 *   DECISION EVENTS   approved an appraisal version |
 *                     requested changes to an appraisal version
 *   WEBHOOKS QUEUED   1 appraisal.approved
 *
 * Two contradictory decisions in the trail with nothing saying which stood,
 * and `appraisal.approved` queued to the subscriber for a version that ended up
 * NOT approved. The router's own comment names who is listening: a lender's
 * system watching for the firm's committed position.
 */
describe('two admins deciding one version at once', () => {
  const decisionEvents = (dealId: string) =>
    prisma.activityEvent.findMany({
      where: { dealId, action: { in: ['approved an appraisal version', 'requested changes to an appraisal version'] } },
    });

  /**
   * Run the pair more than once, deliberately.
   *
   * A single round is not enough to hold this. Unguarded, the race reproduces
   * 20 times out of 20 — but which caller loses, and whether the loser is
   * stopped by the cheap pre-check or by the compare-and-set, shifts with the
   * interleaving. A mutation that removed the enforcement survived one round
   * for exactly that reason: that run's loser happened to be refused by the
   * pre-check, and the test reported success for a question it had not asked.
   */
  const ROUNDS = 5;

  it('lets one decision stand each time, and tells the subscriber that one', async () => {
    const R = await makeTenant('Decision');
    const c = callerFor(R.principal);
    await prisma.webhookEndpoint.create({
      data: { orgId: R.orgId, url: 'https://lender.example/hook', secret: 'x', events: 'appraisal.approved', active: true, createdById: R.userId },
    });
    for (let round = 0; round < ROUNDS; round++) {
      const saved = (await c.appraisal.save({
        dealId: R.dealId, input: input(), label: `V${round}`, asNewVersion: true,
      } as never)) as { id: string };
      await c.appraisal.submitForReview({ versionId: saved.id } as never);
      const eventsBefore = (await decisionEvents(R.dealId)).length;
      const queuedBefore = await prisma.webhookDelivery.count({ where: { orgId: R.orgId } });

      const settled = await Promise.allSettled([
        c.appraisal.review({ versionId: saved.id, decision: 'approve' } as never),
        c.appraisal.review({ versionId: saved.id, decision: 'request_changes', note: 'Check the build rate.' } as never),
      ]);
      expect(settled.filter((r) => r.status === 'fulfilled'), `round ${round}: exactly one decision is accepted`).toHaveLength(1);
      for (const r of settled) {
        if (r.status === 'rejected') expect(String((r.reason as Error).message)).toMatch(/only a version in review/i);
      }

      const after = await prisma.appraisal.findUniqueOrThrow({ where: { id: saved.id } });
      const added = (await decisionEvents(R.dealId)).slice(eventsBefore);
      expect(added, `round ${round}: one decision, one entry in the trail`).toHaveLength(1);

      /**
       * The row, the trail and the subscriber must all describe the SAME
       * decision. Counting events alone would pass a fix that recorded once
       * while still emitting the wrong event — the half that reaches a lender.
       */
      const expected =
        after.reviewStatus === 'approved' ? 'approved an appraisal version' : 'requested changes to an appraisal version';
      expect(added[0]!.action, `round ${round}: the trail and the row disagree`).toBe(expected);

      const queuedNow = await prisma.webhookDelivery.findMany({ where: { orgId: R.orgId }, orderBy: { createdAt: 'asc' } });
      const emitted = queuedNow.slice(queuedBefore).map((d) => d.event);
      expect(
        emitted,
        `round ${round}: a version that is ${after.reviewStatus} announced ${emitted.join(', ') || 'nothing'}`,
      ).toEqual(after.reviewStatus === 'approved' ? ['appraisal.approved'] : []);
    }
  });

  it('still refuses a decision on a version already decided', async () => {
    // the sequential path the pre-check answers — it must not have been lost
    const R = await makeTenant('Decision2');
    const c = callerFor(R.principal);
    const saved = (await c.appraisal.save({ dealId: R.dealId, input: input(), label: 'Base' } as never)) as { id: string };
    await c.appraisal.submitForReview({ versionId: saved.id } as never);
    await c.appraisal.review({ versionId: saved.id, decision: 'approve' } as never);

    await expect(
      c.appraisal.review({ versionId: saved.id, decision: 'request_changes', note: 'Too late.' } as never),
    ).rejects.toThrow(/only a version in review/i);
    expect((await prisma.appraisal.findUniqueOrThrow({ where: { id: saved.id } })).reviewStatus).toBe('approved');
    expect(await decisionEvents(R.dealId)).toHaveLength(1);
  });
});
