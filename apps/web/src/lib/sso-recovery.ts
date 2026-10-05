/**
 * What the screen says about break-glass codes.
 *
 * `apps/api/src/auth/sso-recovery.ts` holds why they exist. This holds the one
 * judgement with boundaries worth pinning: of the four states a workspace can
 * be in, which are worth saying something about and how loudly.
 *
 * The state that matters is ENFORCED WITH NONE LEFT. It is indistinguishable on
 * screen from a healthy connection — single sign-on works, everybody signs in,
 * the chip reads REQUIRED — and it is the exact state this whole feature was
 * built to prevent: the firm's only way in is the identity provider, and if that
 * stops working there is no second door and nobody left who can ask for one. A
 * count in a corner is not enough for that, so it is an ALERT; and a connection
 * enforced before codes existed is in it from the moment this ships, which is
 * why the panel has a Generate button rather than only a mint-on-enable path.
 *
 * Deliberately NOT said: anything at all when the connection is optional. Where
 * passwords still work there is nothing to recover from — `auth.recoveryLogin`
 * refuses such a workspace outright — so a warning there would be noise about a
 * risk the firm does not carry, which is how a channel stops being read.
 */

export type RecoveryLevel = 'alert' | 'warn' | 'info';

export type RecoveryStatus = { level: RecoveryLevel; text: string };

/**
 * Below this, say so. Two is the point at which one incident and one
 * transcription error leave a firm with nothing, and the sheet takes a minute to
 * replace while they can still sign in.
 */
export const LOW_WATER = 3;

export function recoveryStatus(opts: {
  hasConnection: boolean;
  enforced: boolean;
  remaining: number;
}): RecoveryStatus | null {
  const { hasConnection, enforced, remaining } = opts;
  if (!hasConnection) return null;

  /**
   * Codes a firm HOLDS are always acknowledged, enforced or not.
   *
   * The first version returned null for any unenforced connection, which read
   * sensibly as a rule about warnings and was wrong about the count: an admin
   * who had just generated ten codes, dismissed them and looked at the panel
   * was told "codes are generated when you require single sign-on", as though
   * the sheet in their hand did not exist. Found by the browser spec reaching
   * its last assertion. What depends on enforcement is the WARNING below, not
   * whether the firm is told what it has.
   */
  if (!enforced) {
    return remaining > 0
      ? { level: 'info', text: `${codeCount(remaining)} unused, ready for when you require single sign-on.` }
      : null;
  }

  if (remaining === 0) {
    return {
      level: 'alert',
      text:
        'No recovery codes left. If this identity provider stops letting anyone in — a changed issuer, '
        + 'an expired certificate, an outage — nobody here can sign in to turn single sign-on off. '
        + 'Generate a set and keep it somewhere outside this workspace.',
    };
  }
  if (remaining < LOW_WATER) {
    return {
      level: 'warn',
      text:
        `${codeCount(remaining)} left. Generate a fresh set while you can still sign in — running out `
        + 'is this safeguard failing in the one situation it exists for.',
    };
  }
  return {
    level: 'info',
    text: `${codeCount(remaining)} unused. Each one signs an admin in once, without the identity provider.`,
  };
}

/** Agreement, in the one place that has to get it right. */
export const codeCount = (n: number): string => `${n} recovery code${n === 1 ? '' : 's'}`;
