import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Where this server is allowed to send a request somebody else chose the address for.
 *
 * Webhook endpoints are the only URLs in this product that a CUSTOMER supplies
 * and OUR server then fetches. Everything else we call out to is a fixed host we
 * chose — postcodes.io, Overpass, the Land Registry, Stripe, Anthropic.
 *
 * `createWebhook` validated two things: that the string parsed as a URL, and
 * that it began with `https://`. Neither says anything about WHERE the request
 * lands. An admin on a plan with the public API could point an endpoint at
 * `https://10.0.0.5/`, at the database host, or at the API's own loopback
 * address, and this server would post a signed payload to it every time an
 * appraisal was approved.
 *
 * The result is not silent, which is what makes it worth fixing rather than
 * merely noting. `org.webhookDeliveries` hands the same admin back
 * `responseCode` AND `error` for every attempt — so an HTTP status from an
 * internal service, or "ECONNREFUSED", or a TLS error naming the host it
 * reached, all come back to the person who chose the address. That is a
 * port scanner with a results page.
 *
 * The https-only rule already blocks the best-known target by accident: the
 * cloud instance-metadata services (169.254.169.254 on AWS, GCP and Azure) are
 * plain HTTP. By accident is not a guard, and it says nothing about the rest of
 * a private network.
 *
 * WHAT THIS DOES NOT DO. It resolves the hostname and refuses private answers,
 * then hands the ORIGINAL hostname to fetch — so a name that resolves publicly
 * here and privately a millisecond later (DNS rebinding) is not stopped. Closing
 * that needs the connection pinned to the address that was checked, which means
 * a custom undici dispatcher, which means adding undici as a real dependency of
 * this package. That is a deliberate, recorded limitation and not an oversight:
 * everything short of an attacker-controlled authoritative nameserver is
 * covered, and redirects — the cheap way to reach the same end — are refused
 * outright at the fetch.
 */

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundUrlError';
  }
}

/** The 16 bytes of an IPv6 address, or null if it will not parse. */
function v6Bytes(addr: string): Uint8Array | null {
  // a trailing dotted quad — ::ffff:127.0.0.1, 64:ff9b::192.0.2.1
  let tail: number[] = [];
  let head = addr;
  const dot = addr.lastIndexOf(':');
  const last = addr.slice(dot + 1);
  if (last.includes('.')) {
    if (isIP(last) !== 4) return null;
    tail = last.split('.').map(Number);
    head = addr.slice(0, dot + 1) + '0';
  }

  const halves = head.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s ? s.split(':').filter((x) => x !== '') : []);
  const left = toGroups(halves[0] ?? '');
  const right = halves.length === 2 ? toGroups(halves[1] ?? '') : [];
  const wanted = tail.length ? 7 : 8; // the dotted quad stands in for the last two groups
  const fill = halves.length === 2 ? wanted - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array(fill).fill('0'), ...right];
  if (groups.length !== wanted) return null;

  const out = new Uint8Array(16);
  for (let i = 0; i < groups.length; i++) {
    const n = Number.parseInt(groups[i]!, 16);
    if (!Number.isFinite(n) || n < 0 || n > 0xffff) return null;
    // the group standing in for a dotted quad is a placeholder; the quad fills it
    if (tail.length && i === groups.length - 1) break;
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  }
  if (tail.length) {
    out[12] = tail[0]!;
    out[13] = tail[1]!;
    out[14] = tail[2]!;
    out[15] = tail[3]!;
  }
  return out;
}

/** True for anything that is not a globally routable IPv4 address. */
function v4IsReserved(o: number[]): boolean {
  const [a, b] = [o[0]!, o[1]!];
  if (a === 0) return true; // 0.0.0.0/8   "this network"
  if (a === 10) return true; // 10/8        private
  if (a === 127) return true; // 127/8       loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10  carrier NAT
  if (a === 169 && b === 254) return true; // 169.254/16 link-local — the metadata service
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12   private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0/24  protocol assignments
  if (a === 192 && b === 0 && o[2] === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && o[2] === 99) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15   benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, 255.255.255.255
  return false;
}

/**
 * Is this literal address one we are willing to send a customer's payload to?
 *
 * Written over BYTES rather than over the text, because the same address has
 * many spellings and a string rule only ever catches the spelling somebody
 * thought of: `::ffff:127.0.0.1` and `::ffff:7f00:1` and
 * `0:0:0:0:0:ffff:7f00:1` are one address, and `2002:7f00:1::` is 127.0.0.1
 * wearing a 6to4 prefix.
 */
export function isPublicAddress(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) return !v4IsReserved(addr.split('.').map(Number));
  if (family !== 6) return false;
  const b = v6Bytes(addr);
  if (!b) return false;

  const allZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // :: and ::1
  if (allZero(0, 15) && (b[15] === 0 || b[15] === 1)) return false;
  // ::ffff:0:0/96 — an IPv4 address in v6 clothing, judged as the v4 it is
  if (allZero(0, 10) && b[10] === 0xff && b[11] === 0xff) return !v4IsReserved([...b.slice(12, 16)]);
  // 64:ff9b::/96 NAT64, same reasoning
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && allZero(4, 12)) {
    return !v4IsReserved([...b.slice(12, 16)]);
  }
  // 2002::/16 6to4 carries its IPv4 in the next four bytes
  if (b[0] === 0x20 && b[1] === 0x02) return !v4IsReserved([...b.slice(2, 6)]);
  if (b[0] === 0x01 && b[1] === 0x00 && allZero(2, 8)) return false; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32 docs
  if ((b[0]! & 0xfe) === 0xfc) return false; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (b[0] === 0xff) return false; // ff00::/8 multicast
  return true;
}

/**
 * Refuse a URL this server should not be made to fetch.
 *
 * Resolution is part of the check, not a formality: `https://internal.example`
 * is a perfectly ordinary-looking name and the whole question is what it points
 * at. `lookup(all)` is used rather than `resolve4`, so the answer is the one the
 * operating system would actually give the connection, hosts file included.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundUrlError('That is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new OutboundUrlError('Webhook URLs must be https — payloads carry deal figures.');
  }
  // new URL keeps the brackets on an IPv6 host
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (!isPublicAddress(host)) {
      throw new OutboundUrlError(
        `${host} is not a public address. A webhook endpoint has to be reachable from the internet — it cannot point inside the network this server runs in.`,
      );
    }
    return;
  }

  /**
   * A name that does not resolve is ALLOWED here, deliberately, and it is worth
   * being precise about why that is not a hole.
   *
   * This function refuses addresses it can prove are private. It cannot prove
   * anything about a name with no answer — and a name with no answer reaches
   * nothing, because the fetch that follows fails on the same resolution. The
   * check that has to hold is the one at DELIVERY, and it runs on every attempt.
   *
   * The alternative — refuse anything that does not resolve — would make this
   * guard depend on the machine running it having working DNS. It would pass on
   * a laptop, fail in a sandboxed CI runner, and pass again in production, which
   * is precisely the shape of guard that gets an exemption added to it and then
   * gets switched off. A rule about reachability should not be able to fail
   * because the checker could not reach anything.
   */
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return;
  }
  if (!addresses.length) return;
  // EVERY answer must be acceptable. One public address alongside a private one
  // is a round-robin that lands inside the network half the time.
  const bad = addresses.find((a) => !isPublicAddress(a.address));
  if (bad) {
    throw new OutboundUrlError(
      `${host} resolves to ${bad.address}, which is not a public address. A webhook endpoint cannot point inside the network this server runs in.`,
    );
  }
}
