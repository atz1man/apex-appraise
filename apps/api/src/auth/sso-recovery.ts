/**
 * Break-glass codes: the way back into a workspace whose identity provider has
 * stopped letting anyone in.
 *
 * `enforced` makes `auth.login` refuse every password in the workspace and
 * `requestPasswordReset` issue no token, and turning it back off needs
 * `org.saveSso` or `org.deleteSso` — both admin-only, reachable only by someone
 * who can sign IN, which by then means only through the identity provider. So
 * the control had exactly one failure mode and no remedy: a wrong issuer, a
 * wrong client id, an expired signing certificate or an IdP that is simply down
 * locked a firm out of its own records permanently, and the only answer this
 * product had was the platform operator editing `enforced` in the database.
 *
 * `org.saveSso`'s `lastLoginAt` precondition stops a firm ARRIVING there on a
 * configuration nobody has tested. It cannot help with the other three causes,
 * and no precondition can: an IdP that worked this morning and is down this
 * afternoon passes every check there is, and a changed issuer is
 * indistinguishable from a legitimate migration to a new provider. Prevention
 * was never going to be the whole answer, which is why this is a RECOVERY path.
 *
 * The shape is the one every identity product settles on — Okta, Google
 * Workspace and GitHub all issue single-use codes when a second factor is
 * enforced — and the reasons it is that shape are worth keeping:
 *
 *   IT DOES NOT DEPEND ON THE THING THAT BROKE. A code is verified against a
 *   digest in this server's own database. No network call, no discovery
 *   document, no certificate, nothing of the identity provider's.
 *
 *   IT IS WRITTEN DOWN. Codes are shown once, at the moment enforcement is
 *   turned on, and never again — so they live on paper or in a password manager
 *   rather than in the workspace they unlock, which would be a circle. That is
 *   also why they are short and typable: see `normaliseRecoveryCode`.
 *
 *   USING ONE DOES NOT DISABLE THE CONTROL. A code grants a SESSION, nothing
 *   more. The admin then decides whether to correct the issuer or stand
 *   enforcement down, and until they do the door still refuses every password.
 *   Clearing `enforced` automatically would make one leaked code a silent way to
 *   switch a security control off.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Ten, because a firm prints them once and then spends them one at a time over
 * years, and running out is this feature failing in exactly the state it exists
 * for. `org.regenerateSsoRecoveryCodes` is the top-up; the panel warns before
 * the last one goes.
 */
export const RECOVERY_CODE_COUNT = 10;

/** Characters per group, and groups per code: `A1B2C-D3E4F`. */
const GROUP = 5;
const GROUPS = 2;

/**
 * Crockford base32: the decimal digits and the letters, less I, L, O and U.
 *
 * I/L/O are out because a code is READ OFF PAPER and typed by somebody who is
 * locked out of their workspace and in a hurry — 1 against l against I, and 0
 * against O, is the one confusion that matters here, since a code refused for a
 * transcription error is indistinguishable from a code that does not work. U is
 * out for the usual reason: with 32 characters and ten codes, a generator that
 * can spell at somebody is a generator that eventually does.
 *
 * 10 characters × 5 bits = 50 bits per code, and a wrong guess goes through the
 * same per-account lockout as a wrong password (five attempts), so there is
 * nothing to brute-force. Length is bounded by what a person will type, not by
 * what is cryptographically generous: the digest is what is stored, and 50 bits
 * behind a five-attempt lockout is already far past reach.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * What a typed code is compared as.
 *
 * Everything a person can plausibly do to a code between the paper and the box
 * is undone here, because the moment this runs is the moment a firm is locked
 * out: lower case, the group separator missing or typed as a space, and the
 * three substitutions the alphabet was chosen to make unambiguous — O for 0, I
 * or L for 1. Anything still outside the alphabet is dropped rather than
 * rejected, so a stray punctuation mark from a copy-paste does not cost an
 * attempt against the lockout.
 *
 * Mapping rather than merely accepting is safe BECAUSE the alphabet excludes
 * those letters: there is no code containing an O to confuse with one
 * containing a zero. The same mapping the other way round would be ambiguous.
 */
export function normaliseRecoveryCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('');
}

/** Grouped for printing. Verification never reads this form. */
export const formatRecoveryCode = (normalised: string): string =>
  (normalised.match(new RegExp(`.{1,${GROUP}}`, 'g')) ?? []).join('-');

/**
 * SHA-256 of the normalised code, as the reset tokens do and for the same
 * reason: a leaked database row must not be a working way in, and the row that
 * leaks is exactly this one.
 *
 * A digest rather than scrypt, which is the opposite of the choice made for
 * passwords, and the difference is the entropy. A password is whatever a person
 * chose and has to be made expensive to guess; a code is 50 random bits behind
 * a lockout, so there is nothing a slow hash would buy except a slower recovery
 * at the worst possible moment.
 */
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');

/**
 * A fresh set: the codes to show the admin once, and the digests to store.
 *
 * Returned together and never again — nothing in this server can recover a code
 * from a digest, which is the property that makes the row safe to hold.
 */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  while (codes.length < count) {
    const bytes = randomBytes(GROUP * GROUPS);
    // rejection-free: the alphabet is exactly 32 long, so five bits of each byte
    // map to one character with no modulo bias to argue about
    const normalised = [...bytes].map((b) => ALPHABET[b & 31]!).join('');
    const code = formatRecoveryCode(normalised);
    // a duplicate would be a code that stops working the first time either is
    // spent, which reads as a code that was never valid
    if (!codes.includes(code)) codes.push(code);
  }
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/**
 * Which stored code a typed one is, or null.
 *
 * Compared in CONSTANT time against every unused digest, and the loop does not
 * stop at the first match: a verification that returns early leaks, through its
 * timing, how far down the list the code sat — which over enough attempts is
 * how many codes remain and in what order they were minted.
 *
 * Both sides are hex digests of the same length, so `timingSafeEqual` cannot
 * throw on a length mismatch; a row carrying anything else is skipped rather
 * than trusted.
 */
export function matchRecoveryCode<T extends { id: string; codeHash: string }>(
  typed: string,
  unused: readonly T[],
): T | null {
  const want = Buffer.from(hashRecoveryCode(typed), 'utf8');
  let found: T | null = null;
  for (const row of unused) {
    const have = Buffer.from(row.codeHash, 'utf8');
    if (have.length !== want.length) continue;
    if (timingSafeEqual(have, want)) found ??= row;
  }
  return found;
}
