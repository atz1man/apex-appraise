import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  authRequest,
  connectionForEmail,
  discover,
  resolveUser,
  verifyIdToken,
  type OidcMetadata,
  type OidcTransport,
} from '../src/sso.js';
import { anonymous, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * SSO, against a fake identity provider with a REAL key pair.
 *
 * The forgeries below are actually attempted rather than described: a token
 * signed by the wrong key, one with the algorithm swapped, one for a different
 * audience, one replayed with an old nonce. A test that only checks the happy
 * path would pass just as well against an implementation that never verified
 * anything — which is the usual way this goes wrong.
 */

const ISSUER = 'https://login.example-idp.com';
const CLIENT_ID = 'apex-client-id';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', kty: 'RSA', alg: 'RS256', use: 'sig' } as never;

const meta: OidcMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/keys`,
};

const idToken = (over: Record<string, unknown> = {}, key: unknown = privateKey, alg: jwt.Algorithm = 'RS256') =>
  jwt.sign(
    {
      sub: 'idp-user-1',
      email: 'sam@clientfirm.co.uk',
      email_verified: true,
      name: 'Sam Surveyor',
      nonce: 'the-nonce',
      ...over,
    },
    key as never,
    { algorithm: alg, issuer: ISSUER, audience: CLIENT_ID, expiresIn: '5m', keyid: 'key-1' },
  );

let A: Tenant;

beforeAll(async () => {
  resetDatabase();
}, 120_000);

beforeEach(async () => {
  A = await makeTenant('Enterprise');
}, 60_000);

/** Each test gets its own domain, so no two share an identity. */
const domainFor = (t: Tenant) => `${t.orgId.slice(-8)}.example`;
const emailFor = (t: Tenant) => `sam@${domainFor(t)}`;

const connect = (t: Tenant, over: Record<string, unknown> = {}) =>
  prisma.ssoConnection.create({
    data: {
      orgId: t.orgId,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: 'shh',
      domains: domainFor(t),
      createdById: t.userId,
      ...over,
    },
  });

describe('discovery', () => {
  it('refuses a configuration document that belongs to a different issuer', async () => {
    const transport: OidcTransport = async () => ({
      status: 200,
      json: async () => ({ ...meta, issuer: 'https://someone-else.example' }),
    });
    // otherwise a firm could be pointed at an issuer that hands off to anywhere
    await expect(discover(ISSUER, transport)).rejects.toThrow(/publishes a configuration for/);
  });
});

describe('the redirect', () => {
  it('carries state, nonce and PKCE, all different every time', () => {
    const a = authRequest(meta, CLIENT_ID, 'https://apex.test/sso/callback');
    const b = authRequest(meta, CLIENT_ID, 'https://apex.test/sso/callback');
    expect(a.url).toContain('code_challenge_method=S256');
    expect(a.url).toContain('scope=openid+email+profile');
    // they guard different attacks; none substitutes for the others
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('verifying the assertion', () => {
  const good = { jwks: [jwk], issuer: ISSUER, audience: CLIENT_ID, nonce: 'the-nonce' };

  it('accepts a properly signed token', () => {
    const who = verifyIdToken(idToken(), good);
    expect(who).toMatchObject({ email: 'sam@clientfirm.co.uk', name: 'Sam Surveyor', subject: 'idp-user-1' });
  });

  it('refuses a token signed by somebody else’s key', () => {
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => verifyIdToken(idToken({}, attacker.privateKey), good)).toThrow();
  });

  it('refuses the algorithm-confusion forgery', () => {
    /**
     * The classic one: sign with HS256 using the provider's PUBLIC key as the
     * shared secret. A verifier that does not pin the algorithm accepts it, and
     * the public key is published by definition.
     */
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const forged = jwt.sign({ sub: 'x', email: 'sam@clientfirm.co.uk', email_verified: true, nonce: 'the-nonce' }, pem, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: CLIENT_ID,
    });
    expect(() => verifyIdToken(forged, good)).toThrow();
  });

  it('refuses a genuine token issued for a different application', () => {
    const other = jwt.sign({ sub: 'x', email: 'sam@clientfirm.co.uk', email_verified: true, nonce: 'the-nonce' }, privateKey, {
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: 'some-other-app',
      keyid: 'key-1',
    });
    expect(() => verifyIdToken(other, good)).toThrow();
  });

  it('refuses a replay carrying an old nonce', () => {
    expect(() => verifyIdToken(idToken({ nonce: 'yesterdays-nonce' }), good)).toThrow(/expired/i);
  });

  it('refuses an expired token', () => {
    const stale = jwt.sign(
      { sub: 'x', email: 'sam@clientfirm.co.uk', email_verified: true, nonce: 'the-nonce', exp: Math.floor(Date.now() / 1000) - 60 },
      privateKey,
      { algorithm: 'RS256', issuer: ISSUER, audience: CLIENT_ID, keyid: 'key-1' },
    );
    expect(() => verifyIdToken(stale, good)).toThrow();
  });

  it('refuses an unverified address', () => {
    // an unverified address is a claim, not an identity
    expect(() => verifyIdToken(idToken({ email_verified: false }), good)).toThrow(/not verified/i);
  });

  it('accepts the string "true", which some providers send', () => {
    expect(verifyIdToken(idToken({ email_verified: 'true' }), good).email).toBe('sam@clientfirm.co.uk');
  });

  it('refuses a token signed with a key the provider does not publish', () => {
    expect(() => verifyIdToken(idToken(), { ...good, jwks: [] })).toThrow(/does not publish/);
  });
});

describe('who gets in', () => {
  it('creates an account on first sign-in, with the configured role', async () => {
    const conn = await connect(A, { defaultRole: 'SURVEYOR' });
    const user = await resolveUser(prisma, conn, { subject: 's', email: emailFor(A), name: 'Sam Surveyor' });
    expect(user).toMatchObject({ orgId: A.orgId, role: 'SURVEYOR', initials: 'SS' });
    // no password: the account exists only through the provider, and a
    // placeholder hash would be a credential nobody chose and nobody rotates
    expect(user.password).toBe('');
  });

  it('returns the existing account on later sign-ins', async () => {
    const conn = await connect(A);
    const first = await resolveUser(prisma, conn, { subject: 's', email: emailFor(A), name: 'Sam Surveyor' });
    const again = await resolveUser(prisma, conn, { subject: 's', email: emailFor(A), name: 'Sam Renamed' });
    expect(again.id).toBe(first.id);
  });

  it('refuses an address on a domain the workspace does not claim', async () => {
    /**
     * The token can be perfectly valid and still not entitle its holder to be
     * here. A provider may assert any address; only the firm's own domains are
     * accepted into the firm's workspace.
     */
    const conn = await connect(A);
    await expect(
      resolveUser(prisma, conn, { subject: 's', email: 'attacker@gmail.com', name: 'Not Us' }),
    ).rejects.toThrow(/not on a domain/);
  });

  it('refuses to hand another workspace’s account to this provider', async () => {
    const other = await makeTenant('Neighbour');
    const existing = await prisma.user.findFirstOrThrow({ where: { orgId: other.orgId, principalType: 'internal' } });
    const conn = await connect(A, { domains: `${domainFor(A)},${existing.email.split('@')[1]}` });
    await expect(
      resolveUser(prisma, conn, { subject: 's', email: existing.email, name: 'Someone' }),
    ).rejects.toThrow(/another workspace/);
  });
});

describe('home-realm discovery', () => {
  it('finds the workspace that claims a domain, and nothing for one nobody claims', async () => {
    const second = `alt-${domainFor(A)}`;
    await connect(A, { domains: `${domainFor(A)}, ${second}` });
    expect((await connectionForEmail(prisma, `anyone@${domainFor(A)}`))?.orgId).toBe(A.orgId);
    // matching is case-insensitive and tolerant of the spacing people type
    expect((await connectionForEmail(prisma, `ANYONE@${second.toUpperCase()}`))?.orgId).toBe(A.orgId);
    expect(await connectionForEmail(prisma, 'someone@nobody-claims-this.test')).toBeNull();
  });

  it('tells a stranger nothing they could not already guess', async () => {
    await connect(A);
    const known = await anonymous().auth.ssoAvailable({ email: emailFor(A) } as never);
    const unknown = await anonymous().auth.ssoAvailable({ email: 'nobody@nowhere.test' } as never);
    // same shape either way — otherwise the login screen answers "which firms use
    // this product, and who works there?"
    expect(Object.keys(known!).sort()).toEqual(Object.keys(unknown!).sort());
  });
});

describe('enforcement', () => {
  it('refuses a password when the workspace requires SSO', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { orgId: A.orgId, principalType: 'internal' } });
    await connect(A, { enforced: true, domains: user.email.split('@')[1]! });
    await expect(anonymous().auth.login({ email: user.email, password: 'anything' } as never)).rejects.toThrow(
      /single sign-on/i,
    );
  });

  it('never authenticates an account with no password', async () => {
    const conn = await connect(A);
    const sso = await resolveUser(prisma, conn, { subject: 's', email: emailFor(A), name: 'Sam Surveyor' });
    expect(sso.password).toBe('');
    // whatever a future change to the hash format does, an empty password is not
    // a way in
    for (const attempt of ['', ' ', 'password']) {
      await expect(anonymous().auth.login({ email: sso.email, password: attempt } as never)).rejects.toThrow();
    }
  });
});
