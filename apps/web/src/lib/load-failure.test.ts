import { describe, expect, it } from 'vitest';
import { loadFailure } from './load-failure';

/**
 * A tRPC client error as the installed client actually builds it: a server
 * refusal carries `data.code`; a fetch that never got an answer carries only a
 * `cause` and NO `data`. The second shape is the whole point of this module.
 */
const refused = (code: string, httpStatus = 400) => ({ data: { code, httpStatus }, message: code });
const neverAnswered = () => ({ message: 'fetch failed' });

describe('what a screen says when its subject could not be loaded', () => {
  it('reads NOT_FOUND as "nothing at this address" and offers no retry', () => {
    const f = loadFailure(refused('NOT_FOUND', 404), 'deal');
    expect(f.kind).toBe('missing');
    expect(f.title).toBe('This deal could not be found');
    expect(f.retry).toBe(false);
    // it may be removed, mistyped or another firm's; the server does not say
    // which and neither does the screen — no sentence asserts one of them
    expect(f.detail).toMatch(/nothing at this address in your workspace/);
  });

  /**
   * THE DEFECT, stated as the boundary that failed. A network failure has no
   * `data`. It used to fall into the same branch as NOT_FOUND and print "it may
   * have been removed" over a record that was almost certainly fine. It must
   * be its own kind, say the server did not answer, and offer a retry —
   * because that is the one failure a second attempt most often fixes.
   */
  it('reads a client error with no data as the server not answering — never as the record being gone', () => {
    const f = loadFailure(neverAnswered(), 'deal');
    expect(f.kind).toBe('unreachable');
    expect(f.title).toBe('The server did not respond');
    expect(f.detail).not.toMatch(/removed/);
    expect(f.detail).not.toMatch(/access/);
    expect(f.retry).toBe(true);
    // `data: null` is the same fact as `data: undefined`
    expect(loadFailure({ data: null }, 'deal').kind).toBe('unreachable');
  });

  it('distinguishes the wrong kind of account from a session that has ended', () => {
    expect(loadFailure(refused('FORBIDDEN', 403), 'deal')).toMatchObject({ kind: 'forbidden', retry: false });
    expect(loadFailure(refused('FORBIDDEN', 403), 'deal').title).toBe("You don't have access to this deal");
    expect(loadFailure(refused('UNAUTHORIZED', 401), 'deal')).toMatchObject({ kind: 'signed-out', retry: false });
  });

  it('treats any other server answer as ours to fix, and worth one more try', () => {
    for (const code of ['INTERNAL_SERVER_ERROR', 'TOO_MANY_REQUESTS', 'BAD_REQUEST', 'TIMEOUT', 'SOMETHING_NEW']) {
      const f = loadFailure(refused(code, 500), 'deal');
      expect(f.kind, code).toBe('server');
      expect(f.retry, code).toBe(true);
      expect(f.title, code).toBe('The deal could not be loaded');
    }
  });

  it('with no error at all says the subject could not be found, not that anything broke', () => {
    // the query never ran (no id in the URL) or answered nothing: to the
    // reader that is the same fact as NOT_FOUND
    expect(loadFailure(null, 'deal').kind).toBe('missing');
    expect(loadFailure(undefined, 'deal').kind).toBe('missing');
  });

  it('names the subject the caller gives it, and has a default', () => {
    expect(loadFailure(refused('NOT_FOUND'), 'comparable').title).toBe('This comparable could not be found');
    expect(loadFailure(refused('NOT_FOUND')).title).toBe('This page could not be found');
  });

  it('offers a retry only where a second attempt could plausibly succeed', () => {
    const retriable = ['server', 'unreachable'];
    const cases = [
      loadFailure(refused('NOT_FOUND')),
      loadFailure(refused('FORBIDDEN')),
      loadFailure(refused('UNAUTHORIZED')),
      loadFailure(refused('INTERNAL_SERVER_ERROR')),
      loadFailure(neverAnswered()),
    ];
    for (const f of cases) expect(f.retry, f.kind).toBe(retriable.includes(f.kind));
  });
});
