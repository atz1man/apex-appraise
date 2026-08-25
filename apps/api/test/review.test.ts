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
