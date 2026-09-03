import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OutboundUrlError, assertPublicHttpsUrl, isPublicAddress } from '../src/outbound.js';
import { postWebhook } from '../src/webhook-delivery.js';
import { callerFor, makeTenant, resetDatabase, type Tenant } from './harness.js';

/**
 * The only URL in this product that a customer chooses and OUR server fetches.
 *
 * `createWebhook` asked two things of it: that it parsed, and that it began
 * `https://`. Neither says where the request lands. An admin on a plan with the
 * public API could point an endpoint at the database host, at another service on
 * the private network, or at this API's own loopback address, and every approved
 * appraisal would be posted to it.
 *
 * And the result came back. `org.webhookDeliveries` returns `responseCode` and
 * `error` per attempt to the same admin who chose the address, so an HTTP status
 * from an internal service, an ECONNREFUSED, or a TLS error naming the host it
 * reached are all readable — a port scanner with a results page.
 *
 * The tests below are a TABLE rather than a handful of examples, because the
 * failure mode of a guard like this is not being wrong about one address: it is
 * having a gap. One spelling nobody thought of is the whole defect back.
 */

describe('addresses this server will not be sent to', () => {
  const blocked: Array<[string, string]> = [
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'private'],
    ['127.0.0.1', 'loopback'],
    ['127.1.1.1', 'loopback, the whole /8'],
    ['100.100.0.1', 'carrier-grade NAT'],
    ['169.254.169.254', 'link-local — the cloud metadata service'],
    ['172.16.0.1', 'private, bottom of the range'],
    ['172.31.255.255', 'private, top of the range'],
    ['192.168.1.1', 'private'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['192.88.99.1', '6to4 relay anycast'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local, the other half of fc00::/7'],
    ['fe80::1', 'IPv6 link-local'],
    ['ff02::1', 'IPv6 multicast'],
    ['2001:db8::1', 'documentation'],
    ['100::1', 'discard prefix'],
    /**
     * One address, many spellings. This is why the check reads BYTES: a string
     * rule catches the spelling whoever wrote it happened to picture.
     */
    ['::ffff:127.0.0.1', 'loopback as IPv4-mapped IPv6'],
    ['::ffff:7f00:1', 'the same address written in hex'],
    ['0:0:0:0:0:ffff:7f00:1', 'the same address written out in full'],
    ['::ffff:169.254.169.254', 'the metadata service, IPv4-mapped'],
    ['::ffff:10.0.0.1', 'a private address, IPv4-mapped'],
    ['64:ff9b::127.0.0.1', 'loopback behind NAT64'],
    ['2002:7f00:1::', 'loopback wearing a 6to4 prefix'],
    ['2002:a00:1::1', 'a 10/8 address wearing a 6to4 prefix'],
  ];

  for (const [addr, why] of blocked) {
    it(`refuses ${addr} — ${why}`, () => {
      expect(isPublicAddress(addr)).toBe(false);
    });
  }
});

describe('addresses that are genuinely on the internet', () => {
  const allowed: Array<[string, string]> = [
    ['1.1.1.1', 'a public resolver'],
    ['8.8.8.8', 'a public resolver'],
    ['93.184.216.34', 'an ordinary host'],
    ['172.32.0.1', 'just above the private range'],
    ['172.15.255.255', 'just below the private range'],
    ['100.63.255.255', 'just below carrier NAT'],
    ['100.128.0.1', 'just above carrier NAT'],
    ['169.253.0.1', 'just below link-local'],
    ['169.255.0.1', 'just above link-local'],
    ['223.255.255.255', 'the last address before multicast'],
    ['2606:4700:4700::1111', 'a public IPv6 resolver'],
    ['2a00:1450:4009:81f::200e', 'a public IPv6 host'],
    ['::ffff:8.8.8.8', 'a public IPv4 address, mapped — still public'],
    ['2002:0808:0808::', 'a public IPv4 behind 6to4 — still public'],
  ];

  for (const [addr, why] of allowed) {
    it(`allows ${addr} — ${why}`, () => {
      expect(isPublicAddress(addr)).toBe(true);
    });
  }

  /**
   * The boundaries above are the point. A range check written with the wrong
   * comparison passes every address in the middle of a block and fails only at
   * its edges, so the edges are what is pinned.
   */
  it('does not refuse the whole internet', () => {
    expect(allowed.every(([a]) => isPublicAddress(a))).toBe(true);
  });
});

describe('nonsense is not an address', () => {
  for (const junk of ['', 'not-an-ip', '1.2.3', '1.2.3.4.5', '999.1.1.1', '::gggg', 'a:b:c:d:e:f:g:h']) {
    it(`refuses ${JSON.stringify(junk)}`, () => {
      expect(isPublicAddress(junk)).toBe(false);
    });
  }
});

describe('the URL a webhook endpoint may use', () => {
  const refused = (url: string) =>
    expect(assertPublicHttpsUrl(url)).rejects.toBeInstanceOf(OutboundUrlError);

  it('refuses a literal private address', async () => {
    await refused('https://10.0.0.5/hook');
    await refused('https://127.0.0.1:4100/trpc');
    await refused('https://169.254.169.254/latest/meta-data/');
  });

  it('refuses an IPv6 literal in brackets, which new URL keeps', async () => {
    // the brackets are part of url.hostname and a naive check compares them to
    // an address and finds no match, which reads as "public"
    await refused('https://[::1]/hook');
    await refused('https://[::ffff:127.0.0.1]/hook');
  });

  it('still refuses plain http, which was the only rule before', async () => {
    await refused('http://example.com/hook');
  });

  it('refuses a string that is not a URL at all', async () => {
    await refused('not a url');
  });

  /**
   * `localhost` is the case a string denylist would catch and a resolution check
   * catches for the right reason — it is refused because of where it POINTS,
   * not because of how it is spelt.
   */
  it('refuses a name that resolves to the loopback address', async () => {
    await refused('https://localhost/hook');
  });

  /**
   * Deliberately allowed, and the reasoning is in `outbound.ts`: this guard
   * refuses addresses it can PROVE are private, and a name with no answer
   * reaches nothing — the fetch that follows fails on the same resolution.
   * Refusing here instead would make the rule depend on the machine running it
   * having working DNS: green on a laptop, red in a sandboxed CI runner, green
   * again in production. That is the shape of guard that gets switched off.
   */
  it('allows a name that does not resolve, because it reaches nothing', async () => {
    await expect(assertPublicHttpsUrl('https://no-such-host.invalid/hook')).resolves.toBeUndefined();
  });

  it('allows an ordinary public endpoint', async () => {
    await expect(assertPublicHttpsUrl('https://hooks.example.com/apex')).resolves.toBeUndefined();
  });
});

/**
 * The predicate being right is not the same as the predicate being ASKED.
 *
 * Last time a guard went in on this codebase, the mutation that survived was the
 * one that deleted the call rather than the rule: every test drove the predicate
 * directly and nothing drove the thing that was supposed to consult it. So both
 * callers are exercised here through their real entry points.
 */
let T: Tenant;
beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('ssrf');
});

describe('the procedure that registers an endpoint', () => {
  const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

  it('refuses an endpoint pointing inside this network, and says why', async () => {
    await expect(
      admin().org.createWebhook({ url: 'https://127.0.0.1:4100/trpc', events: ['deal.created'] } as never),
    ).rejects.toThrow(/not a public address/i);
  });

  it('refuses the cloud metadata address', async () => {
    await expect(
      admin().org.createWebhook({ url: 'https://169.254.169.254/latest/meta-data/', events: ['deal.created'] } as never),
    ).rejects.toThrow(/not a public address/i);
  });

  it('still refuses plain http with the message it always used', async () => {
    await expect(
      admin().org.createWebhook({ url: 'http://hooks.example.com/apex', events: ['deal.created'] } as never),
    ).rejects.toThrow(/https/i);
  });

  it('still accepts an ordinary endpoint', async () => {
    const made = (await admin().org.createWebhook({
      url: 'https://hooks.example.com/apex',
      events: ['deal.created'],
    } as never)) as { id: string };
    expect(made.id).toBeTruthy();
  });
});

/**
 * Delivery re-checks, and has to.
 *
 * Creation-time validation alone is a check-once-use-later: a hostname that
 * resolved publicly when the endpoint was added can resolve inside the network
 * today, and every endpoint added before this guard existed was never checked at
 * all. `postWebhook` is the real delivery function — `drainWebhooks` replaces it
 * with an injected `deliver` in every other test, so a rule living only in the
 * default would be exercised by nothing.
 */
/**
 * Stubbing the global `fetch` rather than threading a seam through the code.
 *
 * Both rules under test are invisible from outside: one refuses before any
 * request is made, the other is an OPTION on a request going to an address no
 * test can stand up a server on. Adding a parameter to production code so a test
 * can watch is the wrong trade when the codebase already does this — the
 * narrative-guard tests drive the model path with a stubbed fetch for the same
 * reason — and stubbing exercises the real call site rather than a substitute
 * for it.
 */
function watchFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

let watching: { restore: () => void } | null = null;
afterEach(() => {
  // a stub left in place would silently answer 200 for every later test in this
  // worker, including ones that mean to reach the guard
  watching?.restore();
  watching = null;
});

describe('the delivery itself', () => {
  it('refuses to post to a private address even if the row already holds one', async () => {
    const w = watchFetch();
    watching = w;
    await expect(postWebhook('https://10.0.0.5/hook', '{}', {})).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(postWebhook('https://[::1]/hook', '{}', {})).rejects.toBeInstanceOf(OutboundUrlError);
    // and it refused BEFORE reaching out, not by discarding the answer afterwards
    expect(w.calls).toEqual([]);
  });

  /**
   * The second half of the same defect, and the half an address check cannot
   * reach on its own. `fetch` follows redirects by default, so a perfectly
   * public endpoint answering `302 Location: https://10.0.0.5/` lands the
   * payload inside the network anyway — the address that was checked is not the
   * address that is talked to.
   */
  it('does not follow redirects, so a 302 cannot land the payload inside the network', async () => {
    const w = watchFetch();
    watching = w;
    await postWebhook('https://hooks.example.com/apex', '{}', { 'apex-event': 'deal.created' });
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]!.init?.redirect, 'a followed redirect walks past the address check').toBe('manual');
  });

  it('posts what it was given to the address it was given', async () => {
    const w = watchFetch();
    watching = w;
    const { status } = await postWebhook('https://hooks.example.com/apex', '{"a":1}', { 'apex-event': 'x' });
    expect(status).toBe(200);
    expect(w.calls[0]!.url).toBe('https://hooks.example.com/apex');
    expect(w.calls[0]!.init?.method).toBe('POST');
    expect(w.calls[0]!.init?.body).toBe('{"a":1}');
  });
});

/**
 * The same defect, in the other place a customer's URL becomes our request.
 *
 * Single sign-on is worse than the webhook by two steps. `saveSso` took
 * `z.string().url()` and asked nothing else — not even https, so the cloud
 * metadata service, which is plain HTTP and was blocked from webhooks only by
 * the accident of that rule, was reachable here.
 *
 * And the issuer is only the FIRST address. `discover()` fetches it, and the
 * document that comes back supplies `token_endpoint` and `jwks_uri`, which
 * `exchangeCode()` and `fetchJwks()` then fetch — so two of the three URLs are
 * chosen by whoever answers the first one, and the token exchange carries the
 * firm's client secret in the body. A guard at the top of `discover()` would
 * have checked the one URL an administrator typed and none of the ones a
 * stranger supplied. It lives in the transport instead, which is the single
 * point all three go through.
 */
describe('single sign-on, where the response chooses the next address', () => {
  const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });
  const sso = (over: Record<string, unknown> = {}) =>
    admin().org.saveSso({
      issuer: 'https://idp.example.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      domains: ['example.com'],
      ...over,
    } as never);

  it('refuses an issuer inside this network', async () => {
    await expect(sso({ issuer: 'https://10.0.0.5' })).rejects.toThrow(/not a public address/i);
  });

  /**
   * The one the webhook rule blocked by accident and this one did not block at
   * all: `saveSso` never required https, so the metadata service — which speaks
   * plain HTTP — was reachable.
   */
  it('refuses the cloud metadata service, which is plain http', async () => {
    await expect(sso({ issuer: 'http://169.254.169.254' })).rejects.toThrow(/https|not a public address/i);
  });

  it('refuses a plain-http issuer, which OpenID Connect does not permit either', async () => {
    await expect(sso({ issuer: 'http://idp.example.com' })).rejects.toThrow(/https/i);
  });

  it('still accepts an ordinary provider', async () => {
    await expect(sso()).resolves.toBeTruthy();
  });
});

/**
 * And the guard is on the TRANSPORT, so the two addresses a stranger supplies
 * are checked on the same footing as the one an administrator typed.
 */
describe('the SSO transport itself', () => {
  it('refuses every URL it is handed, whoever chose it', async () => {
    const { realTransport } = await import('../src/sso.js');
    // discovery, token exchange and JWKS all go through this one function
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'https://10.0.0.5/token', 'https://[::1]/jwks']) {
      await expect(realTransport(url), url).rejects.toBeInstanceOf(OutboundUrlError);
    }
  });

  /**
   * And does not follow redirects, for the same reason webhook delivery does
   * not: the address that was checked stops being the address that is reached
   * the moment a 302 is honoured. This one matters more, because the response
   * to a redirected discovery request is what supplies `token_endpoint`.
   */
  it('does not follow redirects', async () => {
    const { realTransport } = await import('../src/sso.js');
    const w = watchFetch();
    watching = w;
    await realTransport('https://idp.example.com/.well-known/openid-configuration');
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]!.init?.redirect).toBe('manual');
  });
});
