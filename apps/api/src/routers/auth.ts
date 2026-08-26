import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { JWT_SECRET } from '../context.js';
import {
  checkLockout,
  hashPassword,
  hashResetToken,
  newResetToken,
  recordFailure,
  recordSuccess,
  tooManyResetRequests,
  verifyPassword,
} from '../auth/password.js';
import { APP_URL, resetEmail, sendMail, ssoResetEmail } from '../email.js';
import { authedProcedure, publicProcedure, router } from '../trpc.js';
import { AUDIT, recordAudit } from '../audit.js';
import { authRequest, connectionForEmail, discover, exchangeCode, fetchJwks, resolveUser, verifyIdToken } from '../sso.js';
import { openFor } from '../sealed-fields.js';

/** Pending SSO sign-ins. Ten minutes, single use, in memory — a restart costs
 *  someone one retry, which is a better trade than a table. */
/**
 * Pending single sign-on states, in memory.
 *
 * An entry was only ever removed by the `ssoComplete` that presented its exact
 * state. Every abandoned sign-in — a closed tab, a failed redirect — left one
 * behind for the life of the process, and `ssoStart` is PUBLIC, so the size of
 * this map was set by whoever was calling it rather than by how many people
 * actually sign in. The ten-minute check on read rejects a stale entry without
 * ever deleting it, which is the part that reads as a TTL and is not one.
 *
 * Same criterion `row-sweeper.ts` names for AuthThrottle — "the row count is set
 * by a stranger" — in a Map rather than a table, and with no sweeper.
 *
 * Pruned on write rather than on a timer: entries are only created here, so the
 * map is bounded by the arrival rate times the TTL without any extra machinery.
 * `xeroStates` in ops.ts has the same shape and is left alone deliberately —
 * it is behind `adminProcedure`, so its size is set by trusted users.
 */
const SSO_STATE_TTL_MS = 10 * 60_000;
const ssoStates = new Map<string, { connectionId: string; nonce: string; codeVerifier: string; at: number }>();

/** Drop states that can no longer complete. Exported so the bound can be tested. */
export function pruneSsoStates(now = Date.now()): number {
  let dropped = 0;
  for (const [state, pending] of ssoStates) {
    if (now - pending.at > SSO_STATE_TTL_MS) {
      ssoStates.delete(state);
      dropped++;
    }
  }
  return dropped;
}

/** test seam: the map is module-private, and its SIZE is the property under test */
export const __ssoStateCount = () => ssoStates.size;

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const user = await ctx.prisma.user.findUnique({ where: { email } });
      /**
       * Failures are filed against the account's OWN organisation — the firm whose
       * accounts are being guessed at is exactly who needs to see the attempts. An
       * unknown address is recorded nowhere: there is no organisation to file it
       * against, and inventing one would fill every workspace with noise about
       * people who have never had an account here.
       */
      const audit = (action: string, target: string) =>
        user ? recordAudit(ctx.prisma, { orgId: user.orgId, userId: user.id, actor: user.name, action, target, ip: ctx.ip }) : undefined;

      const lock = await checkLockout(ctx.prisma, email);
      if (lock.locked) {
        await audit(AUDIT.lockedOut, email);
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Account locked after repeated failures — try again in ${lock.retryAfterMins} min`,
        });
      }
      /**
       * A workspace that enforces SSO does not accept passwords, including from
       * accounts that had one before SSO was turned on. Leaving that door open
       * would make enforcement a preference rather than a control — which is the
       * whole reason a security team asks for it.
       */
      if (user) {
        const sso = await ctx.prisma.ssoConnection.findUnique({ where: { orgId: user.orgId } });
        if (sso?.enforced) {
          await audit(AUDIT.signInFailed, email);
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Your organisation signs in with single sign-on. Use the SSO button instead.',
          });
        }
      }
      // an account created by SSO carries no password; an empty one must never
      // authenticate, whatever a future change to the hash format does
      if (user && !user.password) {
        await audit(AUDIT.signInFailed, email);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
      if (!user || !verifyPassword(input.password, user.password)) {
        await recordFailure(ctx.prisma, email);
        await audit(AUDIT.signInFailed, email);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
      await recordSuccess(ctx.prisma, email);
      await audit(AUDIT.signIn, email);
      const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' });
      return {
        token,
        principal: {
          userId: user.id,
          name: user.name,
          initials: user.initials,
          role: user.role,
          principalType: user.principalType,
        },
      };
    }),

  me: authedProcedure.query(({ ctx }) => ctx.principal),

  /**
   * Home-realm discovery: does this address belong to a firm that uses SSO?
   *
   * Answers the same shape either way. "No SSO here" for an unknown address and
   * "SSO" for a known one would turn the login screen into a way to ask which
   * companies use this product and who works there.
   */
  ssoAvailable: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ ctx, input }) => {
      const conn = await connectionForEmail(ctx.prisma, input.email);
      return { sso: !!conn, enforced: !!conn?.enforced };
    }),

  /** Begin an SSO sign-in for whichever workspace claims this domain. */
  ssoStart: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await connectionForEmail(ctx.prisma, input.email);
      if (!conn) throw new TRPCError({ code: 'NOT_FOUND', message: 'No single sign-on is configured for that address.' });
      const meta = await discover(conn.issuer);
      const req = authRequest(meta, conn.clientId, `${APP_URL()}/sso/callback`);
      pruneSsoStates();
      ssoStates.set(req.state, { connectionId: conn.id, nonce: req.nonce, codeVerifier: req.codeVerifier, at: Date.now() });
      return { url: req.url };
    }),

  /** Finish it: verify the assertion, then issue our own session. */
  ssoComplete: publicProcedure
    .input(z.object({ code: z.string().min(1), state: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const pending = ssoStates.get(input.state);
      // single use: a state that can be replayed is a login that can be
      ssoStates.delete(input.state);
      if (!pending || Date.now() - pending.at > SSO_STATE_TTL_MS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That sign-in has expired — please start again.' });
      }
      const conn = await ctx.prisma.ssoConnection.findUnique({ where: { id: pending.connectionId } });
      if (!conn) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That sign-in is no longer available.' });

      const meta = await discover(conn.issuer);
      const { id_token } = await exchangeCode(meta, {
        code: input.code,
        clientId: conn.clientId,
        clientSecret: openFor('ssoConnection', 'clientSecret', conn.orgId, conn.clientSecret),
        redirectUri: `${APP_URL()}/sso/callback`,
        codeVerifier: pending.codeVerifier,
      });
      const jwks = await fetchJwks(meta);
      const identity = verifyIdToken(id_token, { jwks, issuer: conn.issuer, audience: conn.clientId, nonce: pending.nonce });

      const user = await resolveUser(ctx.prisma, conn, identity);
      await ctx.prisma.ssoConnection.update({ where: { id: conn.id }, data: { lastLoginAt: new Date() } });
      await recordAudit(ctx.prisma, {
        orgId: user.orgId, userId: user.id, actor: user.name,
        action: AUDIT.signIn, target: `${user.email} (single sign-on)`, ip: ctx.ip,
      });

      const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' });
      return {
        token,
        principal: {
          userId: user.id,
          name: user.name,
          initials: user.initials,
          role: user.role,
          principalType: user.principalType,
        },
      };
    }),

  /**
   * Request a reset link.
   *
   * Always returns the same shape, whether or not the address exists. An endpoint
   * that says "no such user" is an account-enumeration oracle, and for a product
   * whose users are named surveyors at named firms, confirming who holds an
   * account is itself a disclosure.
   */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      if (await tooManyResetRequests(ctx.prisma, email)) return { ok: true };

      const user = await ctx.prisma.user.findUnique({ where: { email } });
      if (user) {
        /**
         * A workspace that enforces SSO has no password to reset, and issuing a
         * token anyway is worse than useless. The password set through it cannot
         * sign in — login refuses enforced orgs before it looks at the hash — so
         * the person is walked through the whole flow to a dead end. Worse, the
         * hash is now stored: a credential nobody's IdP knows about, which goes
         * live the moment enforcement is turned off for an outage. And the flow
         * is a ready-made phishing setup, since anyone can make us mail "reset
         * your password" to a firm that does not use passwords.
         *
         * Same uniform { ok: true } either way — whether an address has an
         * account here is still not something this endpoint tells anyone.
         */
        const sso = await ctx.prisma.ssoConnection.findUnique({ where: { orgId: user.orgId } });
        if (sso?.enforced) {
          const mail = ssoResetEmail(user.name, APP_URL());
          await sendMail(user.orgId, user.email, mail.subject, mail.text);
          await recordAudit(ctx.prisma, {
            orgId: user.orgId, userId: user.id, actor: user.name,
            action: AUDIT.passwordResetRequested, target: `${user.email} (SSO — no token issued)`, ip: ctx.ip,
          });
          return { ok: true };
        }

        const { token, hash, expiresAt } = newResetToken();
        await ctx.prisma.user.update({
          where: { id: user.id },
          data: { resetTokenHash: hash, resetTokenExpiresAt: expiresAt },
        });
        const mail = resetEmail(user.name, APP_URL(), token);
        await sendMail(user.orgId, user.email, mail.subject, mail.text);
        await recordAudit(ctx.prisma, {
          orgId: user.orgId, userId: user.id, actor: user.name,
          action: AUDIT.passwordResetRequested, target: user.email, ip: ctx.ip,
        });
      }
      return { ok: true };
    }),

  resetPassword: publicProcedure
    .input(z.object({ token: z.string().min(1), password: z.string().min(8, 'Password must be at least 8 characters') }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findFirst({
        where: { resetTokenHash: hashResetToken(input.token), resetTokenExpiresAt: { gt: new Date() } },
      });
      // one message for a bad token and an expired one: distinguishing them tells
      // an attacker which of their guesses was once real
      if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'That reset link is invalid or has expired' });
      }
      /**
       * Checked again here, not only where the token is issued. Enforcement can
       * be turned on in the window between a link being sent and clicked, and
       * this is the write that would leave a password behind.
       */
      const sso = await ctx.prisma.ssoConnection.findUnique({ where: { orgId: user.orgId } });
      if (sso?.enforced) {
        // clear the token: it is dead either way, and leaving it live invites a retry
        await ctx.prisma.user.update({
          where: { id: user.id },
          data: { resetTokenHash: null, resetTokenExpiresAt: null },
        });
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Your organisation signs in with single sign-on — there is no password to set. Use the SSO button on the sign-in page.',
        });
      }
      await ctx.prisma.user.update({
        where: { id: user.id },
        // cleared in the same write that sets the password: single use is not a
        // policy, it is the absence of a second chance
        // sessionsValidFrom cuts every token already issued for this account. A
        // reset is the flow for someone who may have LOST control of the
        // credential, so leaving the old sessions alive is the one outcome it
        // must not have. There is no replacement token here on purpose: this
        // procedure is public and unauthenticated, and handing out a session
        // from it would make the reset link a sign-in link.
        data: {
          password: hashPassword(input.password),
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          sessionsValidFrom: new Date(),
        },
      });
      // a reset is how someone locked out gets back in — leaving the lockout in
      // place would hand them a new password and still refuse the login
      await recordSuccess(ctx.prisma, user.email);
      await recordAudit(ctx.prisma, {
        orgId: user.orgId, userId: user.id, actor: user.name,
        action: AUDIT.passwordReset, target: user.email, ip: ctx.ip,
      });
      return { ok: true };
    }),

  changePassword: authedProcedure
    .input(z.object({ current: z.string().min(1), next: z.string().min(8, 'New password must be at least 8 characters') }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({ where: { id: ctx.principal.userId } });
      if (!user || !verifyPassword(input.current, user.password)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
      }
      await ctx.prisma.user.update({
        where: { id: user.id },
        // every other session goes with the old password — a phone left on a
        // train, a shared machine, whoever prompted the change in the first
        // place
        data: { password: hashPassword(input.next), sessionsValidFrom: new Date() },
      });
      await recordAudit(ctx.prisma, {
        orgId: user.orgId, userId: user.id, actor: user.name,
        action: AUDIT.passwordChanged, target: user.email, ip: ctx.ip,
      });
      // except this one. The browser doing the changing gets a replacement, so
      // "change your password" does not also mean "and then sign in again" —
      // a security step that costs the user something is a security step people
      // put off.
      return { ok: true, token: jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' }) };
    }),
});
