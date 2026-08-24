import type { PrismaClient } from '@prisma/client';
import { pruneAuthThrottles } from './auth/password.js';
import { pruneOpenDataCache } from './opendata-cache.js';

/**
 * The two tables that only ever grow.
 *
 * Both sweepers existed before this file and both ran exactly once, at boot,
 * with a comment saying the table was small enough not to need a timer. That
 * reasoning holds for the open-data cache, whose keys are postcodes and whose
 * growth is bounded by how much of Britain a firm looks at. It does not hold at
 * all for AuthThrottle.
 *
 * AuthThrottle is keyed by the email SOMEBODY ELSE typed. recordFailure upserts
 * a row for every failed sign-in whether or not the account exists — it has to,
 * because a store that only remembers real accounts answers "does this address
 * have an account here?" for free — and tooManyResetRequests upserts on the
 * FIRST reset request, not the fourth. So the row count is set by a stranger,
 * and a credential-stuffing run through a list of a million addresses leaves a
 * million rows behind. The per-minute rate limit caps how fast they arrive; it
 * does nothing about how long they stay.
 *
 * A boot-only sweep bounds that by the deploy interval. An API that stays up
 * for two months — which is the goal — accumulates two months of rows that
 * stopped being able to affect a decision after twenty-four hours.
 */
export interface SweepResult {
  cache: number;
  throttles: number;
}

export async function sweepExpiredRows(prisma: PrismaClient): Promise<SweepResult> {
  const [cache, throttles] = await Promise.all([pruneOpenDataCache(prisma), pruneAuthThrottles(prisma)]);
  return { cache, throttles };
}

/** Hourly. The throttle cutoff is a day, so this is frequent enough to keep the
 *  table flat and rare enough to be invisible. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Sweep now, then keep sweeping. Returns the timer so a caller can stop it.
 *
 * Never allowed to throw: a sweeper that fails is a table that grows, which is
 * tomorrow's problem, while an API that will not boot is today's.
 */
export function startRowSweeper(
  prisma: PrismaClient,
  opts: { intervalMs?: number; onSweep?: (r: SweepResult) => void; onError?: (e: unknown) => void } = {},
): NodeJS.Timeout {
  const run = () => {
    void sweepExpiredRows(prisma).then(
      (r) => {
        if (r.cache || r.throttles) opts.onSweep?.(r);
      },
      (e: unknown) => opts.onError?.(e),
    );
  };
  run();
  const timer = setInterval(run, opts.intervalMs ?? SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
