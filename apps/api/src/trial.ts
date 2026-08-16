import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';

/**
 * When the trial ends, and what "ended" is allowed to mean.
 *
 * TRIAL used to carry Starter's volumes and no clock — three deals and two seats,
 * forever, for nothing. That is not a trial, it is a free tier that nobody
 * decided to offer, and it is the reason a product can look adopted and earn
 * nothing.
 *
 * The rule chosen here is deliberately narrow: an expired trial goes READ-ONLY.
 * Every appraisal, document and report stays visible, exportable and printable;
 * what stops is writing. A valuer whose trial lapsed mid-instruction must still
 * be able to open the file they are on the hook for, and holding a firm's own
 * valuations hostage to a card detail is not a collections strategy, it is a
 * complaint to their regulator waiting to happen.
 */

export const TRIAL_DAYS = 14;

export const trialEndFrom = (start: Date) => new Date(start.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

export interface TrialState {
  /** null when the workspace is on a paid plan, or has no clock */
  endsAt: Date | null;
  expired: boolean;
  daysLeft: number | null;
}

export function trialStateOf(org: { plan: string; trialEndsAt: Date | null }, now = new Date()): TrialState {
  if (org.plan !== 'TRIAL' || !org.trialEndsAt) return { endsAt: null, expired: false, daysLeft: null };
  const ms = org.trialEndsAt.getTime() - now.getTime();
  return {
    endsAt: org.trialEndsAt,
    expired: ms <= 0,
    // rounded UP, so the last partial day still reads as "1 day left" rather
    // than "0 days left" on a trial that has not actually ended
    daysLeft: Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000))),
  };
}

/**
 * Procedures a lapsed trial may still call.
 *
 * Paying is obviously on the list. So are the two that a firm on the way OUT
 * needs — taking their data with them and closing the workspace — because a
 * product that can only be left by paying first is one nobody should trust with
 * a client file in the first place.
 */
const ALLOWED_WHILE_EXPIRED = [
  /^billing\./,
  // signing in, resetting and changing a password all live under auth.*
  /^auth\./,
  /^org\.(exportData|deleteWorkspace)$/,
];

export const allowedWhileExpired = (path: string) => ALLOWED_WHILE_EXPIRED.some((re) => re.test(path));

export async function assertTrialLive(prisma: PrismaClient, orgId: string, path: string) {
  if (allowedWhileExpired(path)) return;
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { plan: true, trialEndsAt: true } });
  if (!org) return;
  const state = trialStateOf(org);
  if (!state.expired) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `Your ${TRIAL_DAYS}-day trial ended on ${state.endsAt!.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}. Everything you have stays here and stays readable — choose a plan to start editing again.`,
  });
}
