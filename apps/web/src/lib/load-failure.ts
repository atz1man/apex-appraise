/**
 * What a screen says when the thing it exists to show could not be loaded.
 *
 * `DealOverview` used to print one sentence for every failure — "it may have
 * been removed or you may not have access" — from a branch that read
 * `if (dealError || !deal)`. That names two specific causes it had not
 * established, and a 500, a rate limit and an API that never answered all
 * printed the same two guesses. Measured on 4 September: an hour of diagnosis
 * pointed at "removed" and "access" while the actual question was whether the
 * API machine was up. It was the same defect the funding pack carried
 * (`isLoading || !exposure` is true of an error too), fixed there and still
 * standing here.
 *
 * The client CAN tell these apart, and this says only what it can tell:
 *
 *   missing      — the server answered NOT_FOUND. For a query shaped
 *                  `findFirst({ id, orgId })` that means exactly "nothing at
 *                  this address in your workspace": removed, mistyped, or
 *                  another firm's, and the server does not say which on
 *                  purpose. So neither does this.
 *   forbidden    — FORBIDDEN: the account is the wrong kind for this screen.
 *   signed-out   — UNAUTHORIZED: no session, or one that has ended.
 *   server       — the server answered with any other error. Ours to fix;
 *                  worth a retry because the next attempt may land elsewhere.
 *   unreachable  — the server did not answer at all. A tRPC client error with
 *                  no `data` is the signature (verified in the installed
 *                  `@trpc/client`: `TRPCClientError.from(fetchError)` sets
 *                  `cause` and leaves `data` undefined). This is the case that
 *                  was being reported as "removed", and it is the one where
 *                  the record is most likely fine.
 *
 * Only the two that might succeed a second time offer a retry. Retrying a
 * NOT_FOUND teaches people that buttons do nothing.
 */

export type LoadFailureKind = 'missing' | 'forbidden' | 'signed-out' | 'server' | 'unreachable';

export interface LoadFailure {
  kind: LoadFailureKind;
  title: string;
  detail: string;
  /** whether a second attempt could plausibly succeed */
  retry: boolean;
}

/** The parts of a `TRPCClientError` this decision reads. */
export interface TRPCErrorLike {
  data?: { code?: string; httpStatus?: number } | null;
  message?: string;
}

export function loadFailure(error: TRPCErrorLike | null | undefined, what = 'page'): LoadFailure {
  // no error and no data: the query never ran (no id) or answered nothing —
  // the same fact as NOT_FOUND from the reader's side, and it should say so
  if (!error) return missing(what);
  if (!error.data) {
    return {
      kind: 'unreachable',
      title: 'The server did not respond',
      detail: `The ${what} may be fine — this device could not reach it. Check your connection and try again.`,
      retry: true,
    };
  }
  switch (error.data.code) {
    case 'NOT_FOUND':
      return missing(what);
    case 'FORBIDDEN':
      return {
        kind: 'forbidden',
        title: `You don't have access to this ${what}`,
        detail: `Your account isn't allowed to open it. Ask an admin of the workspace if you think it should be.`,
        retry: false,
      };
    case 'UNAUTHORIZED':
      return {
        kind: 'signed-out',
        title: 'Your session has ended',
        detail: 'Sign in again to carry on — nothing has been lost.',
        retry: false,
      };
    default:
      return {
        kind: 'server',
        title: `The ${what} could not be loaded`,
        detail: 'Something went wrong on our side. Try again in a moment.',
        retry: true,
      };
  }
}

function missing(what: string): LoadFailure {
  return {
    kind: 'missing',
    title: `This ${what} could not be found`,
    detail: `There is nothing at this address in your workspace — it may have been removed, or the link may be out of date.`,
    retry: false,
  };
}
