import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { JWT_SECRET } from '../src/context.js';
import { signDownloadToken, verifyDownloadToken } from '../src/download-token.js';
import { signFileUrl } from '../src/uploads.js';
import { callerFor, expectDenied, makeTenant, resetDatabase, type Tenant } from './harness.js';

/**
 * A PDF opens in a new tab, so the credential has to travel in the URL — and a
 * URL is not private. It reaches browser history, the proxy log, the nginx log
 * and whatever gets pasted into an email.
 *
 * These links used to carry the user's SESSION token: a twelve-hour credential
 * for the whole account. Anyone who came across one held the account, not the
 * document.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Downloads');
  B = await makeTenant('Others');
}, 120_000);

describe('a download token', () => {
  it('opens exactly the document it was minted for', () => {
    const token = signDownloadToken({ sub: 'user-1', kind: 'appraisal', dealId: 'deal-1' });
    expect(verifyDownloadToken(token, { kind: 'appraisal', dealId: 'deal-1' })).toEqual({ userId: 'user-1', issuedAt: expect.any(Number) });
  });

  it('will not open a different deal', () => {
    const token = signDownloadToken({ sub: 'user-1', kind: 'appraisal', dealId: 'deal-1' });
    expect(verifyDownloadToken(token, { kind: 'appraisal', dealId: 'deal-2' })).toBeNull();
  });

  it('will not open a different kind of document', () => {
    // the Red Book is a regulated deliverable; a link to the working appraisal
    // must not fetch it
    const token = signDownloadToken({ sub: 'user-1', kind: 'appraisal', dealId: 'deal-1' });
    expect(verifyDownloadToken(token, { kind: 'redbook', dealId: 'deal-1' })).toBeNull();
  });

  it('will not let a deal token stand in for the whole portfolio', () => {
    const token = signDownloadToken({ sub: 'user-1', kind: 'appraisal', dealId: 'deal-1' });
    expect(verifyDownloadToken(token, { kind: 'portfolio' })).toBeNull();
  });

  it('REFUSES a valid session token', () => {
    /**
     * The point of the whole change. A session token is signed with the same
     * secret and is perfectly valid — accepting it here would leave the original
     * hole open behind a new door.
     */
    const session = jwt.sign({ sub: 'user-1' }, JWT_SECRET, { expiresIn: '12h' });
    expect(verifyDownloadToken(session, { kind: 'appraisal', dealId: 'deal-1' })).toBeNull();
  });

  it('refuses a token signed by someone else, and rubbish', () => {
    const forged = jwt.sign({ sub: 'user-1', kind: 'appraisal' }, 'not-the-secret', { audience: 'apex.report-download' });
    expect(verifyDownloadToken(forged, { kind: 'appraisal' })).toBeNull();
    expect(verifyDownloadToken('nonsense', { kind: 'appraisal' })).toBeNull();
  });

  it('expires', () => {
    const stale = jwt.sign({ kind: 'appraisal' }, JWT_SECRET, {
      subject: 'user-1',
      audience: 'apex.report-download',
      expiresIn: '-1s',
    });
    expect(verifyDownloadToken(stale, { kind: 'appraisal' })).toBeNull();
  });
});

describe('minting one', () => {
  it('checks the deal belongs to you before handing over a token', async () => {
    await expectDenied('downloadToken for another firm’s deal', () =>
      callerFor(A.principal).appraisal.downloadToken({ kind: 'appraisal', dealId: B.dealId } as never),
    );
  });

  it('mints for your own deal, scoped to it', async () => {
    const { token } = (await callerFor(A.principal).appraisal.downloadToken({
      kind: 'appraisal',
      dealId: A.dealId,
    } as never)) as { token: string };
    expect(verifyDownloadToken(token, { kind: 'appraisal', dealId: A.dealId })).toEqual({ userId: A.userId, issuedAt: expect.any(Number) });
    expect(verifyDownloadToken(token, { kind: 'appraisal', dealId: B.dealId })).toBeNull();
  });

  it('needs a deal for anything that is not portfolio-wide', async () => {
    await expect(
      callerFor(A.principal).appraisal.downloadToken({ kind: 'appraisal' } as never),
    ).rejects.toThrow();
    // the portfolio pack covers the org, so it takes none
    const { token } = (await callerFor(A.principal).appraisal.downloadToken({ kind: 'portfolio' } as never)) as {
      token: string;
    };
    expect(verifyDownloadToken(token, { kind: 'portfolio' })).toEqual({ userId: A.userId, issuedAt: expect.any(Number) });
  });
});

describe('file tokens', () => {
  it('name the single file they may fetch', () => {
    const token = signDownloadToken({ sub: 'user-1', kind: 'file', key: '123-cost-plan.pdf' });
    expect(verifyDownloadToken(token, { kind: 'file', key: '123-cost-plan.pdf' })).toEqual({ userId: 'user-1', issuedAt: expect.any(Number) });
    // the keys are `<Date.now()>-<original filename>`, so a neighbouring file is
    // a very short guess away — the token has to be the thing that stops it
    expect(verifyDownloadToken(token, { kind: 'file', key: '124-cost-plan.pdf' })).toBeNull();
    expect(verifyDownloadToken(token, { kind: 'file', key: '123-planning-decision.pdf' })).toBeNull();
  });

  it('cannot be used as a report token, or the reverse', () => {
    const file = signDownloadToken({ sub: 'user-1', kind: 'file', key: 'k' });
    expect(verifyDownloadToken(file, { kind: 'appraisal', dealId: 'deal-1' })).toBeNull();
    const report = signDownloadToken({ sub: 'user-1', kind: 'appraisal', dealId: 'deal-1' });
    expect(verifyDownloadToken(report, { kind: 'file', key: 'k' })).toBeNull();
  });

  it('signs only our own upload URLs, leaving anything else alone', () => {
    const signed = signFileUrl('/uploads/files/123-plan.pdf', 'user-1');
    expect(signed).toMatch(/^\/uploads\/files\/123-plan\.pdf\?t=/);
    // not ours to sign — rewriting these would break them
    expect(signFileUrl('https://example.com/x.pdf', 'user-1')).toBe('https://example.com/x.pdf');
    expect(signFileUrl('', 'user-1')).toBe('');
    expect(signFileUrl(null, 'user-1')).toBe('');
  });
});
