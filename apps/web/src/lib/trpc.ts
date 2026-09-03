import { createTRPCReact } from '@trpc/react-query';
import { TRPCClientError, httpBatchLink } from '@trpc/client';
import { READ_ONLY_MESSAGE, isViewOnly, refusedForViewer } from './read-only';
import superjson from 'superjson';
import type { AppRouter } from '../../../api/src/router';

export const trpc = createTRPCReact<AppRouter>();

export const TOKEN_KEY = 'apex_token';
export const PRINCIPAL_KEY = 'apex_principal';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export interface StoredPrincipal {
  userId: string;
  name: string;
  initials: string;
  role: string;
  principalType: 'internal' | 'buyer' | 'investor';
}

export function getPrincipal(): StoredPrincipal | null {
  try {
    const raw = localStorage.getItem(PRINCIPAL_KEY);
    return raw ? (JSON.parse(raw) as StoredPrincipal) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, principal: StoredPrincipal) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(principal));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PRINCIPAL_KEY);
}

/**
 * A view-only member's writes stop here, before the network.
 *
 * The server already refuses them — see `auth/roles.ts` — so this is not the
 * security boundary and must never be mistaken for one; anyone can edit their
 * own browser. It is the only place in the web app that sees ALL ninety-eight
 * mutations, which makes it the one place a rule about writing can be complete
 * without being written down ninety-eight times.
 *
 * What it buys is honesty and latency: the refusal is instant, carries the same
 * words the server would have used, and never leaves a form half-submitted
 * against a request that was doomed. The `writes` prop on Button greys the
 * control out beforehand; a control nobody has marked yet lands here instead of
 * on the server, which is a worse experience than being greyed out and a much
 * better one than a spinner followed by a shrug.
 */
const readOnlyLink: Parameters<typeof trpc.createClient>[0]['links'][number] =
  () =>
  ({ op, next }) => {
    if (op.type !== 'mutation' || !refusedForViewer(op.path) || !isViewOnly(getPrincipal())) {
      return next(op);
    }
    /**
     * The observable is built by hand rather than with tRPC's `observable()`
     * helper, which lives in `@trpc/server`. That package is not a dependency of
     * this app and must not become one: it would put the server runtime into the
     * browser bundle to save four lines. The contract a link returns is small and
     * stable — subscribe, hand the observer an error, give back an unsubscribe.
     */
    const refusal = new TRPCClientError(READ_ONLY_MESSAGE, {
      // shaped like the server's refusal so everything upstream — toasts, retries,
      // the query cache — cannot tell the two apart and behave differently
      result: { error: { code: -32003, message: READ_ONLY_MESSAGE, data: { code: 'FORBIDDEN', httpStatus: 403 } } } as never,
    });
    return {
      subscribe(observer: { error?: (e: unknown) => void }) {
        observer.error?.(refusal);
        return { unsubscribe() {} };
      },
    } as never;
  };

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      readOnlyLink,
      httpBatchLink({
        url: '/trpc',
        transformer: superjson,
        // safety net: split batches before the URL hits server limits (HTTP 414)
        maxURLLength: 2000,
        headers() {
          const token = getToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
