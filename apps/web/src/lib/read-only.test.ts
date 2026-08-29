import { describe, expect, it } from 'vitest';
import { READ_ONLY_MESSAGE, VIEWER_MAY_RUN, isViewOnly, refusedForViewer } from './read-only';

/**
 * The rule the browser applies before a write leaves the machine.
 *
 * This is not the security boundary — `auth/roles.ts` is, and anyone can edit
 * their own browser. What is tested here is that the app tells a view-only
 * member the truth instantly instead of after a round trip, and that it does not
 * take anything away from anybody else.
 */

const internal = (role: string) => ({ role, principalType: 'internal' });

describe('who is view-only', () => {
  it('is an internal member whose role says so', () => {
    expect(isViewOnly(internal('VIEWER'))).toBe(true);
  });

  it('is not a member who can edit', () => {
    for (const role of ['ADMIN', 'ANALYST', 'SURVEYOR']) {
      expect(isViewOnly(internal(role)), role).toBe(false);
    }
  });

  /**
   * The trap this predicate exists to avoid.
   *
   * Portal logins are created with `role: 'VIEWER'` — see `inviteBuyer` and
   * `inviteInvestor`, both of which hardcode it, and the demo seed does the same.
   * A rule that read the role alone would therefore treat every buyer and every
   * investor as a view-only member of the FIRM, and switch off the portals'
   * own writes: paying a deposit, signing a reservation. Those principals are
   * governed by `buyerProcedure` and `investorProcedure`, which is a different
   * question entirely, so the type is checked before the role.
   */
  it('is never a buyer or an investor, whatever their role says', () => {
    expect(isViewOnly({ role: 'VIEWER', principalType: 'buyer' })).toBe(false);
    expect(isViewOnly({ role: 'VIEWER', principalType: 'investor' })).toBe(false);
  });

  it('is nobody when there is no principal', () => {
    expect(isViewOnly(null)).toBe(false);
    expect(isViewOnly(undefined)).toBe(false);
  });
});

describe('which mutations are refused', () => {
  it('refuses the writes that make up the workspace', () => {
    for (const path of [
      'deals.create',
      'appraisal.save',
      'appraisal.restore',
      'sales.deleteUnit',
      'sales.deleteTenancy',
      'engagement.issue',
      'cost.upsertPackage',
      'integrations.saveCredentials',
    ]) {
      expect(refusedForViewer(path), path).toBe(true);
    }
  });

  it('lets through everything the server would have let through', () => {
    for (const path of VIEWER_MAY_RUN) {
      expect(refusedForViewer(path), path).toBe(false);
    }
  });

  /**
   * The one that would turn a permission into a security problem. A member
   * locked out of their own password cannot end a session somebody else is
   * holding — which is the whole reason that mutation exists.
   */
  it('never stands between a member and their own password', () => {
    expect(refusedForViewer('auth.changePassword')).toBe(false);
  });

  it('says the same thing the server says', () => {
    // the words are duplicated across packages on purpose — a member must not be
    // told two different stories depending on which layer caught them — so this
    // pins the shape that matters: what happened, and who can undo it
    expect(READ_ONLY_MESSAGE).toMatch(/view-only access/i);
    expect(READ_ONLY_MESSAGE).toMatch(/administrator can change your role/i);
  });
});
