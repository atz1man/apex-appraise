import { describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';
import { isSensitive } from '../src/security.js';

/**
 * Every procedure a stranger can make send an email.
 *
 * `security.ts` names the hazard in its own words — "using the reset endpoint to
 * mail-bomb a user" — and gives `auth.requestPasswordReset` a budget of ten a
 * minute against the general six hundred. `org.register` has the same shape and
 * was not on the list: public, sends a welcome email to an address the caller
 * supplies, with the caller's own `name` and `orgName` inside it. At the general
 * budget that is a relay for somebody else's text, from this firm's domain,
 * sixty times a minute — and each call also leaves an Organisation, a User and a
 * connector row behind, which no sweeper removes.
 *
 * The throttle inside the procedure reads as cover and is not. It is keyed
 * `register:<email>` and only records a failure when the address is already
 * taken, so it limits probing ONE address rather than registering a thousand new
 * ones. Its comment says "reuse the login throttle so registration can't be
 * hammered either"; that is true of the case it was written for and not of the
 * case that costs something.
 *
 * Same shape as `reachable.test.ts` and `ai-disclosure-provenance.test.ts`: two
 * halves of a boundary compared to each other rather than either trusted to a
 * person's memory. Here, everything that can mail without signing in must be in
 * the bucket built for exactly that.
 */

type Proc = { _def: { resolver?: unknown; middlewares?: unknown[] } };

const procedures = () =>
  Object.entries((appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures);

const depth = (p: Proc) => (p._def.middlewares ?? []).length;

/**
 * Public means the shallowest middleware stack in the router.
 *
 * Measured rather than written down: `publicProcedure` itself reports zero, but
 * `.input().mutation()` adds tRPC's own, so the builder's depth is not the
 * built procedure's. Taking the minimum across the real router means adding a
 * global middleware moves the baseline with it, and the anchor below keeps that
 * minimum honest — `auth.login` has to be reachable by someone with no account,
 * or nobody could ever sign in.
 */
const PUBLIC_DEPTH = Math.min(...procedures().map(([, p]) => depth(p)));
const isPublic = (p: Proc) => depth(p) === PUBLIC_DEPTH;

const sendsMail = (p: Proc) =>
  typeof p._def.resolver === 'function' && /sendMail\s*\(/.test(String(p._def.resolver));

describe('the strict rate-limit bucket', () => {
  it('finds the procedures it is meant to be sweeping', () => {
    // a sweep that matches nothing passes silently, which is worse than none
    const all = procedures();
    expect(all.length, 'no procedures found — the router shape has changed').toBeGreaterThan(50);
    expect(all.filter(([, p]) => sendsMail(p)).length, 'no mail-sending procedure found').toBeGreaterThan(0);
    expect(all.filter(([, p]) => isPublic(p)).length, 'no public procedure found').toBeGreaterThan(0);
    // the anchor: if signing in needed an account, the baseline would be wrong
    const login = all.find(([path]) => path === 'auth.login');
    expect(login, 'auth.login has moved — the public baseline needs a new anchor').toBeTruthy();
    expect(isPublic(login![1]), 'auth.login is not at the shallowest depth').toBe(true);
  });

  it('covers every procedure a stranger can make send an email', () => {
    const escaping = procedures()
      .filter(([, p]) => isPublic(p) && sendsMail(p))
      .map(([path]) => path)
      .filter((path) => !isSensitive(`/trpc/${path}`));
    expect(
      escaping,
      'public, sends mail, and runs on the general budget — add it to SENSITIVE in security.ts',
    ).toEqual([]);
  });

  it('does not put an authenticated procedure in the strict bucket by accident', () => {
    /**
     * The list is matched by substring, so a careless entry ("org.") would drag
     * every workspace call into a ten-a-minute budget and throttle the product
     * rather than the attacker.
     */
    const authedAndThrottled = procedures()
      .filter(([, p]) => !isPublic(p))
      .map(([path]) => path)
      .filter((path) => isSensitive(`/trpc/${path}`));
    expect(authedAndThrottled, 'signed-in traffic is sharing the anti-brute-force budget').toEqual([]);
  });
});
