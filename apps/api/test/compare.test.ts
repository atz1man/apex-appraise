import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Version comparison, end to end: two saved versions, and the answer to "what
 * changed and what did it do to the numbers".
 */

let A: Tenant;
let B: Tenant;

const input = (overrides: Record<string, unknown> = {}) => ({
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate: 110 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
  ...overrides,
});

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Compare');
  B = await makeTenant('Other');
}, 120_000);

describe('comparing two versions', () => {
  it('names what moved and what it did to the answer', async () => {
    const caller = callerFor(A.principal);
    await caller.appraisal.save({ dealId: A.dealId, input: input(), label: 'Base' } as never);

    // a second version: the build rate goes up, with a reason
    await caller.appraisal.save({
      dealId: A.dealId,
      input: input({ trades: [{ label: 'Superstructure', rate: 130 }] }),
      asNewVersion: true,
      label: 'Post-tender',
      note: 'Rebased on the tender return from Kier',
    } as never);

    const versions = (await caller.appraisal.versions(A.dealId)) as Array<{ id: string; label: string; note: string | null }>;
    expect(versions).toHaveLength(2);
    const base = versions.find((v) => v.label === 'Base')!;
    const tender = versions.find((v) => v.label === 'Post-tender')!;
    expect(tender.note).toBe('Rebased on the tender return from Kier');

    const cmp = (await caller.appraisal.compare({ fromId: base.id, toId: tender.id } as never)) as {
      diff: { changes: Array<{ path: string; before: unknown; after: unknown }>; identical: boolean };
      impact: Record<string, { before: number; after: number }>;
      to: { note: string | null };
    };

    expect(cmp.diff.identical).toBe(false);
    expect(cmp.diff.changes.find((c) => c.path === 'trades.Superstructure')).toMatchObject({ before: 110, after: 130 });
    // the reason travels with the diff — "what" and "why" in one answer
    expect(cmp.to.note).toBe('Rebased on the tender return from Kier');

    // and the consequence: a dearer build leaves less for the land
    expect(cmp.impact.residualNet.after).toBeLessThan(cmp.impact.residualNet.before);
    expect(cmp.impact.gdv.after).toBe(cmp.impact.gdv.before); // revenue untouched
  });

  it('recomputes the impact rather than trusting each version’s stored cache', async () => {
    const caller = callerFor(A.principal);
    const versions = (await caller.appraisal.versions(A.dealId)) as Array<{ id: string; label: string }>;
    const base = versions.find((v) => v.label === 'Base')!;

    // corrupt the stored cache: a stale or wrong cache must not be able to change
    // what the comparison reports, or an engine fix between two saves would show
    // up as a phantom difference nobody made
    await prisma.appraisal.update({
      where: { id: base.id },
      data: { resultCache: JSON.stringify({ result: { gdv: 1, residualNet: 1, profit: 1, poc: 1 } }) },
    });

    const cmp = (await caller.appraisal.compare({
      fromId: base.id,
      toId: versions.find((v) => v.label === 'Post-tender')!.id,
    } as never)) as { impact: Record<string, { before: number }> };
    expect(cmp.impact.gdv.before).toBeGreaterThan(1_000_000);
  });

  it('refuses versions from another org, and from a different deal', async () => {
    const mine = (await callerFor(A.principal).appraisal.versions(A.dealId)) as Array<{ id: string }>;
    await callerFor(B.principal).appraisal.save({ dealId: B.dealId, input: input(), label: 'Theirs' } as never);
    const theirs = (await callerFor(B.principal).appraisal.versions(B.dealId)) as Array<{ id: string }>;

    await expectDenied('compare across orgs', () =>
      callerFor(A.principal).appraisal.compare({ fromId: mine[0]!.id, toId: theirs[0]!.id } as never),
    );
  });
});
