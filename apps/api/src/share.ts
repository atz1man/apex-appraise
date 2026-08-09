import { createHash, randomBytes } from 'node:crypto';

/**
 * Read-only links to a report.
 *
 * The link serves the rendered PDF and nothing else. An unauthenticated JSON
 * endpoint over a firm's valuation inputs would be a far larger thing to get
 * right, and it is not what anyone asked for — they asked to send a lender the
 * appraisal.
 *
 * Three properties the link has to have, none of them optional for a document
 * that carries a professional opinion:
 *
 *   it EXPIRES, because a link that works forever is a document a firm can never
 *   take back;
 *
 *   it can be REVOKED, because circumstances change faster than any expiry;
 *
 *   it is stored HASHED, so a database leak is not also a set of working links to
 *   every valuation the firm has ever shared.
 */

export const SHARE_DEFAULT_DAYS = 30;
export const SHARE_MAX_DAYS = 180;

/** 32 bytes: long enough that guessing is not a strategy. */
export function newShareToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashShareToken(token) };
}

export const hashShareToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface ShareState {
  expiresAt: Date;
  revokedAt: Date | null;
}

export type ShareRefusal = 'expired' | 'revoked' | null;

/**
 * Why a link will not open, or null when it will.
 *
 * Revocation is checked before expiry because a link that was withdrawn and has
 * since also aged out was WITHDRAWN — and that is the fact the firm's own records
 * and screens should show.
 *
 * The holder is told neither. They get one message whichever it is: "revoked"
 * says a decision was made about them specifically, and "expired" invites a
 * request for a fresh link. Both are the sender's business to explain, not the
 * server's to disclose to whoever holds the URL.
 */
export function shareRefusal(share: ShareState, now = new Date()): ShareRefusal {
  if (share.revokedAt) return 'revoked';
  if (share.expiresAt.getTime() <= now.getTime()) return 'expired';
  return null;
}

/** What the holder of a dead link is told — deliberately the same either way. */
export const SHARE_REFUSAL_MESSAGE =
  'This link is no longer available. Ask the sender for a new one.';
