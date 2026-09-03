import { TRPCError } from '@trpc/server';
import type { Principal } from '../context.js';

/**
 * Who may change the workspace.
 *
 * The product has said for as long as it has had a team screen that a VIEWER's
 * permission is "View" — `ops.access` maps the role to that word, Settings
 * offers it in the invite picker and the role dropdown, and an SSO connection
 * can be configured to hand it to everyone who signs in. Nothing enforced it.
 * `internalProcedure` asked whether the principal was internal and whether the
 * trial was live; no layer anywhere asked what the member was allowed to do,
 * and `adminProcedure` — the only role gate in the codebase — guards the
 * thirty admin mutations and says nothing about the rest.
 *
 * Measured against the real router before this file existed: of 87 mutations,
 * 30 were refused by the admin gate and 3 were buyer-only, leaving 47
 * authed-only mutations that a VIEWER reached. Among them `deals.create`,
 * `deals.update`, `appraisal.save`, `appraisal.restore`,
 * `appraisal.submitForReview`, `engagement.issue`, `engagement.withdraw`,
 * `sales.deleteUnit`, `sales.deleteTenancy`, `cost.upsertPackage` and
 * `integrations.saveCredentials`. A read-only account could rewrite an
 * appraisal, delete a tenancy and re-point an integration's credentials.
 *
 * ONE function, called from both chains, because that is the lesson this
 * codebase has already paid for twice: `trpc.ts` says a rule repeated in forty
 * places is forty chances to forget it, and `http-guards.ts` exists because the
 * upload routes fell out of that chain twice for two different rules. A shared
 * predicate cannot drift the way two copies of it can.
 *
 * Deliberately a denylist of one rather than an allowlist of three. ADMIN,
 * ANALYST and SURVEYOR all write today, and the product describes them together
 * as "Edit"; a role added tomorrow should get whatever the product decides it
 * gets, and defaulting a new role to silently read-only would be its own quiet
 * defect. VIEWER is the role that means one specific thing, and it is the one
 * named here.
 */
export const VIEW_ONLY_ROLE = 'VIEWER';

/** May this principal change anything in the workspace? */
export const canWrite = (role: string): boolean => role !== VIEW_ONLY_ROLE;

/**
 * Refuse a write by someone whose account is view-only.
 *
 * The message is written to be read by the person who hit it, and to name the
 * way out: they are not broken, and the person who can fix it is their admin.
 */
export function assertCanWrite(principal: Pick<Principal, 'role'>): void {
  if (!canWrite(principal.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'Your account has view-only access to this workspace, so it cannot make changes. An administrator can change your role under Settings → Team.',
    });
  }
}
