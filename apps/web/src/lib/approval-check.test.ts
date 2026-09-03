import { describe, expect, it } from 'vitest';
import { approvalCheck, type VerificationLike } from './approval-check';

const base: VerificationLike = {
  engineVersion: { pinned: '2026.09.1', current: '2026.09.1', same: true },
  inputsUnchanged: true,
  figuresMatch: true,
  drift: [],
  pinned: { marketValue: 4_278_000, gdv: 4_278_000 },
  now: { marketValue: 4_278_000, gdv: 4_278_000 },
};

describe('what a report says about a signed figure', () => {
  it('says nothing for a draft, and nothing while the check is still loading', () => {
    expect(approvalCheck(base, false)).toBeNull();
    expect(approvalCheck(undefined, true)).toBeNull();
  });

  it('is unverified, and says so, for a version approved before pins existed', () => {
    const c = approvalCheck(null, true)!;
    expect(c.tone).toBe('unverified');
    expect(c.text).toMatch(/not been verified against the signed record/);
  });

  it('is verified when the pennies agree — even under a newer engine', () => {
    expect(approvalCheck(base, true)).toEqual({ tone: 'verified', text: 'Figures verified against the approved record · engine 2026.09.1' });
    const bumped = { ...base, engineVersion: { pinned: '2026.09.1', current: '2026.10.1', same: false } };
    // the number the reader holds is the number that was signed
    expect(approvalCheck(bumped, true)!.tone).toBe('verified');
  });

  it('names the engine change and both Market Values when the figure moved', () => {
    const c = approvalCheck(
      {
        ...base,
        engineVersion: { pinned: '2026.09.1', current: '2026.10.1', same: false },
        figuresMatch: false,
        drift: [{ key: 'marketValue', pinned: 4_278_000, now: 4_253_000 }],
        now: { marketValue: 4_253_000, gdv: 4_253_000 },
      },
      true,
    )!;
    expect(c.tone).toBe('drift');
    expect(c.text).toMatch(/engine has changed .*2026\.09\.1 → 2026\.10\.1/);
    expect(c.text).toMatch(/Approved record: Market Value £4,278,000/);
    expect(c.text).toMatch(/Recomputed now: £4,253,000/);
    expect(c.text).toMatch(/Re-approve/);
  });

  it('blames changed inputs on the inputs, not on the engine', () => {
    const c = approvalCheck({ ...base, inputsUnchanged: false, figuresMatch: false, drift: [{ key: 'build', pinned: 1, now: 2 }] }, true)!;
    expect(c.tone).toBe('drift');
    expect(c.text).toMatch(/inputs of this approved version have changed/);
    expect(c.text).not.toMatch(/engine has changed/);
    // Market Value did not move, so the sentence says which figure did
    expect(c.text).toMatch(/Market Value is unchanged/);
    expect(c.text).toMatch(/build moved/);
  });
});
