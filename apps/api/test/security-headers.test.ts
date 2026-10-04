import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The security headers the documentation says are enforced at the front door.
 *
 * They were not there at all. `docker-compose.yml` says "nginx is the front
 * door, and the security headers, tile proxy and download routes are enforced
 * there"; `README.md` says the same sentence. The tile proxy and the download
 * routes were real. The only `add_header` directives in the whole template were
 * five `Cache-Control` lines — no CSP, no HSTS, no `X-Frame-Options`, no
 * `nosniff`, no `Referrer-Policy`, and no helmet-equivalent anywhere in the API
 * either. Two files asserted a protection that did not exist, which is worse
 * than the absence: somebody reading either of them stops looking.
 *
 * THE RULE THIS HOLDS is not "the headers exist somewhere" — it is the nginx
 * footgun that makes a careful one-liner useless. `add_header` inside a
 * location REPLACES the inherited set rather than adding to it, so a block of
 * security headers at server level is dropped by every location that sets a
 * header of its own. Five here do, all for caching, and they are the five that
 * matter most: `/assets/` (the JavaScript bundle), `/fonts/`, the image regex,
 * `/ready`, and `location /` — which serves index.html, i.e. the document the
 * policy is meant to govern. A server-level block alone would have protected
 * every path in the product except the page and its script.
 *
 * So the headers live in `infra/security-headers.conf` and every location that
 * sets a header re-includes it, the way those locations already re-include
 * `client-ip.conf`. This fails naming any location that sets a header and
 * forgets.
 *
 * WHAT IT DOES NOT PROVE: that nginx parses the result, or that the policy is
 * right. There is no nginx binary and no docker daemon in the environment these
 * tests run in, so the template is read as text. That limit is also why the
 * CSP is served `-Report-Only` — the file says why at length, and the short
 * version is that the only clause a wrong policy would break is Stripe's
 * injected payment form, which no spec opens because a card number should
 * reach Stripe and never us.
 */

const ROOT = new URL('../../../', import.meta.url).pathname;
const template = readFileSync(`${ROOT}infra/nginx.conf.template`, 'utf8');
const snippet = readFileSync(`${ROOT}infra/security-headers.conf`, 'utf8');
const dockerfile = readFileSync(`${ROOT}infra/web.Dockerfile`, 'utf8');

const INCLUDE = 'include /etc/nginx/security-headers.conf;';

/** Top-level blocks of the template: `location …{ … }`, one entry each. */
export function locationBlocks(conf = template): Array<{ header: string; body: string }> {
  const out: Array<{ header: string; body: string }> = [];
  const re = /^\s{2}(location[^\n{]*)\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(conf))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < conf.length && depth > 0) {
      if (conf[i] === '{') depth++;
      else if (conf[i] === '}') depth--;
      i++;
    }
    out.push({ header: m[1]!.trim(), body: conf.slice(re.lastIndex, i - 1) });
  }
  return out;
}

describe('the front door sets the headers the docs say it sets', () => {
  it.each([
    ['X-Content-Type-Options', /nosniff/],
    ['Referrer-Policy', /strict-origin-when-cross-origin/],
    ['X-Frame-Options', /DENY/],
    // the value is a VARIABLE, so the max-age lives on the `set` line above it;
    // the dedicated HSTS case below checks both halves
    ['Strict-Transport-Security', /\$apex_hsts/],
    ['Content-Security-Policy-Report-Only', /default-src 'self'/],
  ])('sets %s', (name, value) => {
    const line = snippet.match(new RegExp(`^add_header ${name}\\s+(.+)$`, 'm'));
    expect(line, `${name} is not set in infra/security-headers.conf`).toBeTruthy();
    expect(line![1], `${name} is set to something unexpected`).toMatch(value);
  });

  /** Without `always` the one response served bare is the error page. */
  it('sets every one of them on error responses too', () => {
    const headers = [...snippet.matchAll(/^add_header\s+(\S+)\s+(.+)$/gm)];
    expect(headers.length).toBeGreaterThanOrEqual(5);
    for (const h of headers) {
      expect(h[2], `add_header ${h[1]} is missing "always", so 4xx/5xx go without it`).toMatch(/always;$/);
    }
  });

  it('includes them for every response, at the server level', () => {
    expect(template, 'the server block does not include the headers at all').toContain(INCLUDE);
  });

  /**
   * The rule. A location that sets its own header discards the inherited set,
   * so it has to ask for these again.
   */
  it('includes them again in every location that sets a header of its own', () => {
    const offenders = locationBlocks()
      .filter((b) => /^\s*add_header/m.test(b.body) && !b.body.includes(INCLUDE))
      .map((b) => b.header);
    expect(
      offenders,
      `these set add_header, which REPLACES the inherited set, and do not include the security ` +
        `headers — so they answer without them:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /** A header file that never reaches the image protects nothing. */
  it('ships the file in the web image', () => {
    expect(dockerfile).toMatch(/^COPY infra\/security-headers\.conf \/etc\/nginx\/security-headers\.conf$/m);
  });

  /**
   * HSTS is a variable on purpose: compose publishes :8080 over plain HTTP, and
   * HSTS applies to the host while ignoring the port, so a literal would pin a
   * self-hoster's host to HTTPS and lock them out of a stack serving none.
   */
  it('emits HSTS only when the request arrived over TLS', () => {
    expect(snippet).toMatch(/if \(\$http_x_forwarded_proto = "https"\)/);
    expect(snippet).toMatch(/add_header Strict-Transport-Security \$apex_hsts always;/);
    // empty by default, and a real max-age only inside the https branch
    expect(snippet).toMatch(/set \$apex_hsts "";/);
    expect(snippet).toMatch(/set \$apex_hsts "max-age=\d+[^"]*";/);
  });

  /**
   * A sweep over an empty list passes in silence. This says the parser found
   * the real locations, and that the rule reports one that forgets.
   */
  it('finds the locations it is meant to be checking', () => {
    const blocks = locationBlocks();
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.map((b) => b.header)).toContain('location /');
    const withOwnHeader = blocks.filter((b) => /^\s*add_header/m.test(b.body));
    expect(withOwnHeader.length, 'no location sets a header, so the rule proved nothing').toBeGreaterThanOrEqual(5);

    const planted = locationBlocks(
      'server {\n  location /x {\n    add_header Cache-Control "no-cache";\n  }\n}',
    ).filter((b) => /^\s*add_header/m.test(b.body) && !b.body.includes(INCLUDE));
    expect(planted.map((b) => b.header)).toEqual(['location /x']);
  });
});
