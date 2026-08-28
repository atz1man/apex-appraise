import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { JWT_SECRET, principalFromAuthHeader } from '../src/context.js';
import { signDownloadToken, type DownloadKind } from '../src/download-token.js';

/**
 * A token minted for a named purpose cannot be spent as a sign-in.
 *
 * `download-token.ts` guards one direction and says so: `verifyDownloadToken`
 * refuses a session token, "which is the point: accepting one here would leave
 * the original hole open behind a new door". `download-token.test.ts` proves
 * that door locked from seven angles.
 *
 * Nobody asked about the wall. Download tokens are signed with the same secret
 * and carry a `sub`, and `principalFromAuthHeader` called `jwt.verify` with no
 * audience — so it verified them, found the user and returned a full internal
 * principal. Every one of those tokens exists precisely BECAUSE it travels in a
 * URL, which is why it was made weak in the first place:
 *
 *   /reports/:dealId/appraisal.pdf?t=…      2 minutes
 *   /uploads/files/123-cost-plan.pdf?t=…   30 minutes
 *   /tiles/:z/:x/:y.png?t=…                30 minutes, in the <img> URL of
 *                                          every tile Leaflet loads
 *
 * The tile token is the one that hurt: it is documented as saying only "someone
 * signed in is looking at a map", and it was a half-hour credential for the whole
 * account, written to the access log a screenful at a time on every pan.
 *
 * This sweeps the REAL `DownloadKind` union rather than a list kept by hand, so
 * a sixth kind is covered the day it is added.
 */

const SRC = join(import.meta.dirname, '..', 'src');

/** the union as `download-token.ts` actually declares it, not as anyone remembers it */
function declaredKinds(): DownloadKind[] {
  const source = readFileSync(join(SRC, 'download-token.ts'), 'utf8');
  const decl = /export type DownloadKind =([^;]+);/.exec(source);
  if (!decl) throw new Error('DownloadKind is no longer declared as a union — this sweep cannot see it');
  return [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as DownloadKind);
}

/**
 * Resolving the principal must not depend on the user being missing. A fake that
 * hands back a perfectly good row for any id makes the refusal about the TOKEN,
 * which is the claim; against the real database a typo in the subject would pass
 * this test for the wrong reason.
 */
const anyUserExists = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      orgId: 'org-1',
      principalType: 'internal',
      role: 'admin',
      name: 'Arthur',
      initials: 'A',
      investorId: null,
      buyerUnitId: null,
      sessionsValidFrom: new Date(0),
    }),
  },
} as unknown as Parameters<typeof principalFromAuthHeader>[0];

describe('a token minted for a named purpose', () => {
  const kinds = declaredKinds();

  it('is a union this sweep can actually read', () => {
    // a sweep over an empty list passes silently, reporting success for a
    // question it never asked
    expect(kinds).toEqual(expect.arrayContaining(['appraisal', 'redbook', 'engagement', 'portfolio', 'file', 'tiles']));
  });

  it.each(kinds)('cannot sign in — kind %s', async (kind) => {
    const token = signDownloadToken({
      sub: 'user-1',
      kind,
      dealId: kind === 'portfolio' || kind === 'file' || kind === 'tiles' ? undefined : 'deal-1',
      key: kind === 'file' ? 'k' : undefined,
    });
    // it is a valid signature over a real subject; only the purpose refuses it
    expect(jwt.verify(token, JWT_SECRET)).toMatchObject({ sub: 'user-1' });
    expect(await principalFromAuthHeader(anyUserExists, `Bearer ${token}`)).toBeNull();
  });

  it('stays shut for a purpose nobody has invented yet', async () => {
    // the check is "carries an audience", not "carries THE download audience",
    // so a new token kind is refused before anyone remembers to come back here
    const future = jwt.sign({ sub: 'user-1' }, JWT_SECRET, { audience: 'apex.something.later', expiresIn: '30m' });
    expect(await principalFromAuthHeader(anyUserExists, `Bearer ${future}`)).toBeNull();
  });

  it('still admits an ordinary sign-in token', async () => {
    // the four mints in auth.ts and org.ts name no audience; refusing those
    // would sign out every user in the product
    const session = jwt.sign({ sub: 'user-1' }, JWT_SECRET, { expiresIn: '12h' });
    expect(await principalFromAuthHeader(anyUserExists, `Bearer ${session}`)).toMatchObject({
      userId: 'user-1',
      orgId: 'org-1',
      principalType: 'internal',
    });
  });
});

describe('the PDF renderer', () => {
  /**
   * The hole was load-bearing. Two of the three report routes handed the headless
   * browser the caller's DOWNLOAD token as `apex_token` and relied on the API
   * accepting it as a session — so closing the wall above breaks PDF rendering
   * unless they mint their own. `/shared/:token.pdf` already did it correctly and
   * says why: "a short-lived token for the RENDERER only; it never leaves this
   * process". It is in localStorage of a browser we own, never in a URL.
   */
  it('signs in as itself, never with the token from the request', () => {
    const source = readFileSync(join(SRC, 'reports.ts'), 'utf8');
    const handed = [...source.matchAll(/addInitScript\([\s\S]*?\n\s*\[\s*(\w+),/g)].map((m) => m[1]);
    // three routes render PDFs; a fourth must not slip past this sweep
    expect(handed).toHaveLength(3);
    expect(handed).toEqual(['renderToken', 'renderToken', 'renderToken']);
  });
});
