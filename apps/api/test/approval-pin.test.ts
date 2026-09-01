import { beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_VERSION, computeAppraisal, reportedMarketValue } from '@apex/appraisal-engine';
import { appraisalRowToEngineInput } from '../src/mappers.js';
import { readPin, stableStringify } from '../src/approval-pin.js';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * What an approval is worth, made checkable.
 *
 * An approved version stored its inputs and a resultCache from the day of the
 * save; the reports recompute from the inputs in the browser with whatever
 * engine ships today. Measured before this: the approved row carried no record
 * of which engine produced the figures somebody signed, and no procedure could
 * say whether a signed figure still held. A rate rule fixed after approval
 * moved the Market Value under the valuer's signature, silently.
 *
 * The engine cannot be swapped inside a test, so drift is planted in the row
 * the way a real engine change would produce it: a pin whose figures or version
 * no longer match what the engine in hand derives.
 */

/**
 * A cap that does not produce a round-thousand GDV. With cap 420 the GDV is
 * £3,150,000 exactly, so the reported Market Value and the raw GDV coincide
 * and a pin that stored the raw figure passed every assertion — measured, a
 * mutant doing exactly that survived until this changed.
 */
const input = (rate = 110) => ({
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 421.37 }],
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

let T: Tenant;
let B: Tenant;
const admin = (t: Tenant) => callerFor({ ...t.principal, role: 'ADMIN' });
const current = (dealId: string) => prisma.appraisal.findFirstOrThrow({ where: { dealId, isCurrent: true } });

type Verification = {
  engineVersion: { pinned: string; current: string; same: boolean };
  inputsUnchanged: boolean;
  figuresMatch: boolean;
  drift: Array<{ key: string; pinned: number; now: number }>;
  pinned: Record<string, number>;
  now: Record<string, number>;
} | null;

let approvedId: string;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Pinned');
  B = await makeTenant('Other');
  await admin(T).appraisal.save({ dealId: T.dealId, input: input(), label: 'For signature' } as never);
  const v = await current(T.dealId);
  await admin(T).appraisal.submitForReview({ versionId: v.id });
  await admin(T).appraisal.review({ versionId: v.id, decision: 'approve' });
  approvedId = v.id;
}, 120_000);

describe('at approval', () => {
  it('the version records the engine that signed it and the figures it signed, to the penny', async () => {
    const row = await prisma.appraisal.findUniqueOrThrow({ where: { id: approvedId } });
    expect(row.engineVersion).toBe(ENGINE_VERSION);
    const pin = readPin(row)!;
    expect(pin).toBeTruthy();
    expect(pin.engineVersion).toBe(ENGINE_VERSION);
    expect(pin.inputHash).toMatch(/^[0-9a-f]{64}$/);
    const R = computeAppraisal(appraisalRowToEngineInput(row));
    expect(pin.figures.gdv).toBe(Math.round(R.gdv * 100) / 100);
    expect(pin.figures.marketValue).toBe(reportedMarketValue(R.gdv));
    // the reporting convention is what was signed, not the unrounded GDV
    expect(pin.figures.marketValue).not.toBe(pin.figures.gdv);
    expect(pin.figures.marketValue % 1000).toBe(0);
    expect(pin.figures.residualNet).toBe(Math.round(R.residualNet * 100) / 100);
    expect(pin.figures.poc).toBeCloseTo(R.poc, 6);
    // pinned when it was signed, which is the review's own timestamp
    expect(new Date(pin.pinnedAt).getTime()).toBe(row.reviewedAt!.getTime());
  });

  it('a draft carries no pin, and neither does a version sent back for changes', async () => {
    await admin(T).appraisal.save({ dealId: T.dealId, input: input(120), label: 'Next', asNewVersion: true } as never);
    const v = await current(T.dealId);
    expect(v.engineVersion).toBeNull();
    expect(v.approvalPin).toBeNull();
    await admin(T).appraisal.submitForReview({ versionId: v.id });
    await admin(T).appraisal.review({ versionId: v.id, decision: 'request_changes', note: 'Not yet' });
    const back = await prisma.appraisal.findUniqueOrThrow({ where: { id: v.id } });
    expect(back.approvalPin).toBeNull();
    expect(back.engineVersion).toBeNull();
  });
});

describe('verifying a signed figure', () => {
  const verifyIt = async () => (await admin(T).appraisal.verifyApproved({ versionId: approvedId })) as Verification;

  it('holds, under the engine that signed it and the inputs that were signed', async () => {
    const v = (await verifyIt())!;
    expect(v.engineVersion).toEqual({ pinned: ENGINE_VERSION, current: ENGINE_VERSION, same: true });
    expect(v.inputsUnchanged).toBe(true);
    expect(v.figuresMatch).toBe(true);
    expect(v.drift).toEqual([]);
    expect(v.now.marketValue).toBe(v.pinned.marketValue);
  });

  it('names the figure that moved, and by how much, when the engine has changed under it', async () => {
    // an engine change is a pin whose figures the engine in hand no longer produces
    const row = await prisma.appraisal.findUniqueOrThrow({ where: { id: approvedId } });
    const pin = readPin(row)!;
    const planted = { ...pin, engineVersion: '2026.01.9', figures: { ...pin.figures, marketValue: pin.figures.marketValue + 25_000, gdv: pin.figures.gdv + 25_000 } };
    await prisma.appraisal.update({ where: { id: approvedId }, data: { approvalPin: JSON.stringify(planted), engineVersion: '2026.01.9' } });

    const v = (await verifyIt())!;
    expect(v.engineVersion.same).toBe(false);
    expect(v.engineVersion.pinned).toBe('2026.01.9');
    expect(v.inputsUnchanged).toBe(true);
    expect(v.figuresMatch).toBe(false);
    expect(v.drift.map((d) => d.key).sort()).toEqual(['gdv', 'marketValue']);
    const mv = v.drift.find((d) => d.key === 'marketValue')!;
    expect(mv.pinned - mv.now).toBe(25_000);

    await prisma.appraisal.update({ where: { id: approvedId }, data: { approvalPin: JSON.stringify(pin), engineVersion: pin.engineVersion } });
  });

  it('notices inputs changed on a signed row, separately from the engine', async () => {
    // a write nothing should be able to make — planted straight into the table
    const row = await prisma.appraisal.findUniqueOrThrow({ where: { id: approvedId } });
    await prisma.appraisal.update({ where: { id: approvedId }, data: { efficiency: 70 } });
    const v = (await verifyIt())!;
    expect(v.engineVersion.same).toBe(true);
    expect(v.inputsUnchanged).toBe(false);
    // and the figures moved with them — efficiency sets GIA, so build cost
    // follows it (GDV is NIA × rate and does not)
    expect(v.figuresMatch).toBe(false);
    expect(v.drift.some((d) => d.key === 'build')).toBe(true);
    expect(v.drift.some((d) => d.key === 'gdv')).toBe(false);
    await prisma.appraisal.update({ where: { id: approvedId }, data: { efficiency: row.efficiency } });
    expect((await verifyIt())!.inputsUnchanged).toBe(true);
  });

  it('is null for a version approved before pins existed, rather than an invented verification', async () => {
    const row = await prisma.appraisal.findUniqueOrThrow({ where: { id: approvedId } });
    await prisma.appraisal.update({ where: { id: approvedId }, data: { approvalPin: null, engineVersion: null } });
    expect(await verifyIt()).toBeNull();
    await prisma.appraisal.update({ where: { id: approvedId }, data: { approvalPin: row.approvalPin, engineVersion: row.engineVersion } });
  });

  it('refuses a draft, and another firm’s version', async () => {
    const draft = await current(T.dealId);
    await expect(admin(T).appraisal.verifyApproved({ versionId: draft.id })).rejects.toThrow(/approved version/);
    await expectDenied('another firm verifying', () => admin(B).appraisal.verifyApproved({ versionId: approvedId }));
  });
});

describe('the input hash', () => {
  it('does not depend on key order or on undefined fields', () => {
    expect(stableStringify({ b: 1, a: [{ d: undefined, c: 2 }] })).toBe(stableStringify({ a: [{ c: 2 }], b: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
