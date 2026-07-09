import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
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

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/trpc',
        transformer: superjson,
        headers() {
          const token = getToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
