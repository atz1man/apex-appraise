import { describe, expect, it } from 'vitest';
import { LOW_WATER, codeCount, recoveryStatus } from './sso-recovery';

const at = (remaining: number, over: Partial<Parameters<typeof recoveryStatus>[0]> = {}) =>
  recoveryStatus({ hasConnection: true, enforced: true, remaining, ...over });

describe('recoveryStatus', () => {
  /**
   * The state the whole feature exists to prevent, and the one that looks
   * perfectly healthy on screen: single sign-on works, everybody signs in, the
   * chip reads REQUIRED, and there is no second door.
   */
  it('is an ALERT when enforcement is on and nothing is left', () => {
    const s = at(0);
    expect(s?.level).toBe('alert');
    expect(s?.text, 'it does not say what is at stake').toMatch(/nobody here can sign in/i);
  });

  it('warns while the sheet is nearly spent, because replacing it needs a sign-in', () => {
    expect(at(1)?.level).toBe('warn');
    expect(at(LOW_WATER - 1)?.level).toBe('warn');
  });

  /** The boundary itself is fine — LOW_WATER is where the warning stops. */
  it('is informational at the low-water mark and above', () => {
    expect(at(LOW_WATER)?.level).toBe('info');
    expect(at(10)?.level).toBe('info');
  });

  /**
   * No WARNING where passwords still work: `auth.recoveryLogin` refuses such a
   * workspace outright, so a warning there is noise about a risk the firm does
   * not carry, and a channel that warns about nothing stops being read.
   */
  it('never warns about a connection that is only optional', () => {
    expect(at(0, { enforced: false })).toBeNull();
    expect(at(1, { enforced: false })?.level).toBe('info');
    expect(at(10, { enforced: false })?.level).toBe('info');
  });

  /**
   * But codes the firm HOLDS are acknowledged either way. The first version
   * returned null for every unenforced connection, so an admin who had just
   * generated ten and dismissed them was told codes are generated when you
   * require single sign-on — as though the sheet in their hand did not exist.
   * Found by `e2e/sso-recovery.spec.ts` reaching its last assertion.
   */
  it('counts what an unenforced connection already holds', () => {
    expect(at(10, { enforced: false })?.text).toContain('10 recovery codes unused');
  });

  it('says nothing when the firm does not federate at all', () => {
    expect(at(0, { hasConnection: false })).toBeNull();
    expect(at(0, { hasConnection: false, enforced: false })).toBeNull();
  });

  /** Every level that is shown carries a sentence; a level with no text is a blank banner. */
  it('never returns a level with nothing to say', () => {
    for (const n of [0, 1, 2, 3, 7, 10]) {
      const s = at(n);
      expect(s, `nothing for ${n}`).not.toBeNull();
      expect(s!.text.length, `empty text at ${n}`).toBeGreaterThan(20);
    }
  });
});

describe('codeCount', () => {
  it('agrees with itself', () => {
    expect(codeCount(1)).toBe('1 recovery code');
    expect(codeCount(0)).toBe('0 recovery codes');
    expect(codeCount(10)).toBe('10 recovery codes');
  });

  /** The singular reaches the warning sentence, which is where it would read wrong. */
  it('is used by the sentence rather than re-spelled in it', () => {
    expect(at(1)?.text).toContain('1 recovery code left');
    expect(at(2)?.text).toContain('2 recovery codes left');
  });
});
