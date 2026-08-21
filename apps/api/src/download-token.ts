import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './context.js';

/**
 * A token for one document, for two minutes.
 *
 * A browser cannot send an Authorization header when it opens a PDF in a new
 * tab, so the credential has to travel in the URL — and a URL is not a private
 * place. It lands in browser history, in the proxy's access log, in the nginx
 * log, and in whatever the user pastes to a colleague when they mean to send the
 * document.
 *
 * Every PDF link used to carry the user's SESSION token, which is a twelve-hour
 * credential for their whole account. Anyone who came across one of those URLs —
 * in a log, in a shared screenshot, in a browser someone else uses — held the
 * account, not the document.
 *
 * So the URL now carries a token that can do exactly one thing: fetch one report
 * of one kind for one deal, for two minutes. It cannot log in, it cannot read a
 * different deal, and it is stale before most log pipelines have finished
 * indexing it.
 */

export const DOWNLOAD_TOKEN_TTL = '2m';
const AUDIENCE = 'apex.report-download';

export type DownloadKind = 'appraisal' | 'redbook' | 'engagement' | 'portfolio' | 'file' | 'tiles';

export interface DownloadClaims {
  sub: string;
  kind: DownloadKind;
  /** absent for portfolio-wide documents, which are not scoped to one deal */
  dealId?: string;
  /** for kind 'file': the stored upload key this token may fetch, and only that one */
  key?: string;
}

/**
 * Files live longer than reports. A report is opened once from a click; an
 * uploaded photo or document sits in a page the user may leave open, and a
 * two-minute URL would break the moment they came back from lunch. Half an hour,
 * still scoped to a single file.
 */
export const FILE_TOKEN_TTL = '30m';

/**
 * Map tiles are the same problem in a different shape: Leaflet loads them as
 * <img> elements, which cannot carry an Authorization header either. A tile
 * token names no deal and no file — it says only "someone signed in is looking
 * at a map", which is all the tile proxy needs to know and all it should learn.
 *
 * It has to outlive a session someone leaves open on a map, hence the same half
 * hour as files rather than the two minutes a report click needs.
 */
export const TILE_TOKEN_TTL = FILE_TOKEN_TTL;

export function signDownloadToken(claims: DownloadClaims): string {
  return jwt.sign({ kind: claims.kind, dealId: claims.dealId, key: claims.key }, JWT_SECRET, {
    subject: claims.sub,
    audience: AUDIENCE,
    expiresIn: claims.kind === 'file' || claims.kind === 'tiles' ? FILE_TOKEN_TTL : DOWNLOAD_TOKEN_TTL,
  });
}

/**
 * Verify a download token for the document being asked for.
 *
 * Returns null for anything that does not match — including a perfectly valid
 * SESSION token, which is the point: accepting one here would leave the original
 * hole open behind a new door.
 */
export function verifyDownloadToken(
  token: string,
  want: { kind: DownloadKind; dealId?: string; key?: string },
): { userId: string } | null {
  try {
    const claims = jwt.verify(token, JWT_SECRET, { audience: AUDIENCE }) as {
      sub?: string;
      kind?: string;
      dealId?: string;
      key?: string;
    };
    if (!claims.sub) return null;
    if (claims.kind !== want.kind) return null;
    // a token for one deal must not fetch another's, and a deal-scoped token must
    // not stand in for the portfolio-wide one
    if ((claims.dealId ?? null) !== (want.dealId ?? null)) return null;
    // a file token names the one file it may fetch
    if ((claims.key ?? null) !== (want.key ?? null)) return null;
    return { userId: claims.sub };
  } catch {
    return null;
  }
}
