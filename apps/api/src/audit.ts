import type { PrismaClient } from '@prisma/client';

/**
 * The audit trail.
 *
 * This exists for the questions asked after something has gone wrong: who signed
 * in, who changed the valuation, who was given access, and when. For a firm whose
 * output is a signed Red Book valuation carried by professional indemnity, those
 * questions arrive from an insurer, a lender's credit committee, or an RICS
 * review — and "we don't record that" is not an answer any of them accept.
 *
 * Two rules the shape depends on:
 *
 * `userId` is the identity; `actor` is only the display name as it stood at the
 * time. Names change and two people can share one, so a trail keyed on a name
 * cannot survive a rename — but a trail that shows only an id is unreadable, so
 * it records both and means different things by them.
 *
 * Nothing in the API updates or deletes an event. Append-only is what makes it
 * evidence rather than a feed; the only path that removes events is the GDPR
 * workspace deletion, which removes the workspace entirely.
 */

export interface AuditEvent {
  orgId: string;
  /** omitted for org-level events — a sign-in belongs to no deal */
  dealId?: string | null;
  userId?: string | null;
  actor: string;
  action: string;
  target: string;
  ip?: string | null;
}

export async function recordAudit(prisma: PrismaClient, e: AuditEvent) {
  try {
    await prisma.activityEvent.create({
      data: {
        orgId: e.orgId,
        dealId: e.dealId ?? null,
        userId: e.userId ?? null,
        actor: e.actor,
        action: e.action,
        target: e.target,
        ip: e.ip ?? null,
      },
    });
  } catch {
    // Auditing must never be the reason a legitimate action fails. A sign-in that
    // is refused because the audit write failed turns a logging fault into an
    // outage — the event is lost, which is bad, but the alternative is worse.
  }
}

/** Security-relevant actions, named once so the trail reads consistently. */
export const AUDIT = {
  signIn: 'signed in',
  signInFailed: 'failed sign-in',
  lockedOut: 'locked out after repeated failures',
  passwordResetRequested: 'requested a password reset',
  passwordReset: 'reset their password',
  passwordChanged: 'changed their password',
} as const;
