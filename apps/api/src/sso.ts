import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { assertPublicHttpsUrl } from './outbound.js';

/**
 * Single sign-on, over OIDC.
 *
 * Microsoft Entra and Google Workspace are both OIDC providers, so this is one
 * code path rather than two. That is not tidiness: every provider-specific
 * implementation is another place a verification step can quietly go missing, and
 * the verification is the entire security of the thing.
 *
 * What an ID token is: a signed assertion, from the firm's identity provider,
 * that a person is who they say. Everything rests on checking that signature
 * against the provider's published keys. An implementation that decodes the token
 * without verifying it — which is the default behaviour of most JWT helpers, and
 * therefore a common bug — will accept an identity anyone on the internet can
 * write by hand.
 */

export interface OidcTransport {
  (url: string, init?: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number;
    json: () => Promise<unknown>;
  }>;
}

/**
 * The one place this module actually reaches the network — and it reaches three
 * different URLs, only the first of which anybody chose deliberately.
 *
 * `discover()` fetches the issuer an administrator typed. What it gets back then
 * supplies `token_endpoint` and `jwks_uri`, and `exchangeCode()` and
 * `fetchJwks()` fetch THOSE. So the second and third addresses come out of a
 * document downloaded from the first: an issuer that answers discovery with
 * `"token_endpoint": "http://169.254.169.254/…"` has this server post to it,
 * with the firm's client secret in the body. Validating only what the admin
 * typed would leave the two URLs a stranger supplies unchecked, which is why the
 * guard is here rather than at the top of discover().
 *
 * Requiring a PUBLIC address takes nothing away that ever worked. The same
 * provider has to serve `authorization_endpoint` to the person's BROWSER — an
 * identity provider this server can reach and the user cannot was never going to
 * sign anybody in.
 *
 * Redirects are refused for the same reason they are on webhook delivery: an
 * address that passes the check and then answers 302 is not the address the
 * request ends at.
 */
export const realTransport: OidcTransport = async (url, init) => {
  await assertPublicHttpsUrl(url);
  const res = await fetch(url, {
    ...(init ?? { method: 'GET', headers: {} }),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/** Discovery, so a firm supplies an issuer and nothing else. */
export async function discover(issuer: string, transport: OidcTransport = realTransport): Promise<OidcMetadata> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await transport(url);
  if (res.status !== 200) throw new Error(`Could not read OpenID configuration from ${issuer}`);
  const meta = (await res.json()) as OidcMetadata;
  // the document must agree about who it belongs to, or it is not this issuer's
  if (meta.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) {
    throw new Error(`That issuer publishes a configuration for ${meta.issuer}`);
  }
  return meta;
}

export interface AuthRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

const base64url = (b: Buffer) => b.toString('base64url');

/**
 * Where to send the person, and the three secrets to check when they return.
 *
 * state defeats a login being started by somebody else; nonce defeats an ID token
 * being replayed into a different session; PKCE defeats an intercepted code being
 * spent by whoever intercepted it. They guard different attacks and none of them
 * substitutes for the others.
 */
export function authRequest(meta: OidcMetadata, clientId: string, redirectUri: string): AuthRequest {
  const state = base64url(randomBytes(16));
  const nonce = base64url(randomBytes(16));
  const codeVerifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${meta.authorization_endpoint}?${params}`, state, nonce, codeVerifier };
}

export async function exchangeCode(
  meta: OidcMetadata,
  opts: { code: string; clientId: string; clientSecret: string; redirectUri: string; codeVerifier: string },
  transport: OidcTransport = realTransport,
): Promise<{ id_token: string }> {
  const res = await transport(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code_verifier: opts.codeVerifier,
    }).toString(),
  });
  const body = (await res.json()) as { id_token?: string; error_description?: string; error?: string };
  if (res.status !== 200 || !body.id_token) {
    throw new Error(`Sign-in failed at the identity provider: ${body.error_description ?? body.error ?? res.status}`);
  }
  return { id_token: body.id_token };
}

interface Jwk {
  kid?: string;
  kty: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

export async function fetchJwks(meta: OidcMetadata, transport: OidcTransport = realTransport): Promise<Jwk[]> {
  const res = await transport(meta.jwks_uri);
  if (res.status !== 200) throw new Error('Could not read the signing keys from the identity provider');
  return ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
}

export interface VerifiedIdentity {
  subject: string;
  email: string;
  name: string;
}

/**
 * Verify an ID token and return who it says the person is.
 *
 * Every check here has an attack behind it:
 *
 *   the SIGNATURE, against the provider's own published key — without it an
 *   identity is just JSON somebody typed;
 *   the ALGORITHM, pinned to RS256 — accepting "none", or letting an attacker
 *   nominate HS256 and sign with the public key as the secret, are both classic
 *   forgeries;
 *   the ISSUER and AUDIENCE — a genuine token, for a different application,
 *   signed by a provider we trust, is still not a login here;
 *   the NONCE — otherwise a token captured once can be replayed;
 *   email_verified — an unverified address is a claim, not an identity, and
 *   several providers let anyone assert one.
 */
export function verifyIdToken(
  idToken: string,
  opts: { jwks: Jwk[]; issuer: string; audience: string; nonce: string },
): VerifiedIdentity {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') throw new Error('The identity provider returned an unreadable token');

  const kid = (decoded.header as { kid?: string }).kid;
  const jwk = opts.jwks.find((k) => (kid ? k.kid === kid : true) && k.kty === 'RSA');
  if (!jwk) throw new Error('The token was signed with a key this provider does not publish');

  const key = createPublicKey({ key: jwk as never, format: 'jwk' });
  const claims = jwt.verify(idToken, key, {
    algorithms: ['RS256'],
    issuer: opts.issuer,
    audience: opts.audience,
  }) as jwt.JwtPayload & { email?: string; email_verified?: boolean | string; name?: string; preferred_username?: string };

  if (claims.nonce !== opts.nonce) throw new Error('That sign-in has expired — please start again');

  const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase();
  if (!email) throw new Error('The identity provider did not supply an email address');
  // some providers send the string "true"
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!verified) throw new Error('That address is not verified with your identity provider');

  return { subject: String(claims.sub), email, name: claims.name ?? email };
}

/** Which workspace, if any, handles this email domain. */
export async function connectionForEmail(prisma: PrismaClient, email: string) {
  const domain = email.toLowerCase().split('@')[1];
  if (!domain) return null;
  const all = await prisma.ssoConnection.findMany();
  return (
    all.find((c) =>
      c.domains
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
        .includes(domain),
    ) ?? null
  );
}

export const domainAllowed = (connection: { domains: string }, email: string) => {
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return connection.domains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .includes(domain);
};

/**
 * Find or create the person behind a verified identity.
 *
 * The domain check is repeated here deliberately. A provider can assert any
 * address it likes — including one at a domain this firm does not own — and
 * without this a misconfigured or hostile IdP would be a way into someone else's
 * workspace. Verifying the token proves who signed it, not that they are entitled
 * to be here.
 */
export async function resolveUser(
  prisma: PrismaClient,
  connection: { id: string; orgId: string; domains: string; defaultRole: string },
  identity: VerifiedIdentity,
) {
  if (!domainAllowed(connection, identity.email)) {
    throw new Error(`${identity.email} is not on a domain this workspace accepts`);
  }

  const existing = await prisma.user.findUnique({ where: { email: identity.email } });
  if (existing) {
    // an account in a DIFFERENT workspace is not this workspace's to sign in
    if (existing.orgId !== connection.orgId) {
      throw new Error('That address already belongs to another workspace');
    }
    return existing;
  }

  const initials =
    identity.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || identity.email.slice(0, 2).toUpperCase();

  return prisma.user.create({
    data: {
      orgId: connection.orgId,
      email: identity.email,
      // no password: this account exists only through the identity provider, and
      // a placeholder hash would be a credential nobody chose and nobody rotates
      password: '',
      name: identity.name,
      role: connection.defaultRole,
      principalType: 'internal',
      initials,
    },
  });
}
