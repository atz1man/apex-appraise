import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { verifyDownloadToken } from './download-token.js';

/**
 * Google Static Maps, fetched by this application rather than by the browser.
 *
 * Google's interactive JavaScript API cannot be used here without breaking a
 * promise the product makes. `maps.googleapis.com/maps/api/js` has to load in
 * the page, it phones home on its own, and the terms forbid proxying it — so
 * adopting it would hand Google the IP address of every valuer and the
 * coordinates of every site they open, on a privacy notice that lists a handful
 * of processors and then says "Nobody else." `e2e/third-party.spec.ts` enforces
 * that sentence with an EMPTY allowlist.
 *
 * The Static Maps API is a different shape and the shape is what makes this
 * work: it answers a single image to a single GET, so the server can fetch it
 * exactly as it already fetches tiles. The browser talks only to us. The
 * privacy notice stays true, the offline field app keeps working, and the
 * server-rendered PDFs render the same image the screen shows.
 *
 * The API key never reaches the browser. Neither does the signing secret —
 * which is the whole reason Google issues one: a signature proves the request
 * came from whoever holds the secret, and a secret in a page is not a secret.
 */

const KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const SIGNING_SECRET = process.env.GOOGLE_MAPS_SIGNING_SECRET || '';

/**
 * `||`, not `??`, and for the reason `tiles.ts` records: docker-compose passes
 * these as `${GOOGLE_MAPS_API_KEY:-}`, so an operator who has not set one gets
 * an EMPTY STRING rather than an absent variable, and `??` only catches absent.
 */
export const staticMapsEnabled = () => KEY.length > 0;

export const GOOGLE_ATTRIBUTION = 'Map data ©2026 Google';

/** Google's own ceiling on the free image size; `scale=2` doubles the pixels, not the ceiling. */
const MAX_DIM = 640;
const MAX_MARKERS = 40;
const MAX_ZOOM = 21;

/**
 * Sign a request path the way Google's URL signing expects.
 *
 * The secret is base64url. It is decoded to BYTES before use — signing with the
 * printable characters instead produces a plausible-looking signature that
 * Google rejects, which is the failure this comment exists to prevent somebody
 * rediscovering.
 */
export function signGoogleUrl(pathAndQuery: string, secret = SIGNING_SECRET): string {
  if (!secret) return pathAndQuery;
  const key = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const signature = createHmac('sha1', key)
    .update(pathAndQuery)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${pathAndQuery}&signature=${signature}`;
}

export interface StaticMapRequest {
  markers: Array<{ lat: number; lng: number; subject: boolean }>;
  width: number;
  height: number;
  maptype: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  zoom?: number;
}

/**
 * What a request may ask for, decided here rather than at the edge.
 *
 * This is a proxy, not an open relay: everything that reaches Google is rebuilt
 * from validated numbers. Passing a caller's query string through would let
 * anyone spend the workspace's quota on any image they liked, signed with our
 * secret — which is worse than an unsigned request, because it would look like
 * ours.
 */
export function parseStaticMapRequest(q: Record<string, string | undefined>): StaticMapRequest | null {
  const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
  const width = Math.min(MAX_DIM, Math.max(1, Math.round(num(q.w) ?? 640)));
  const height = Math.min(MAX_DIM, Math.max(1, Math.round(num(q.h) ?? 320)));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

  const maptype = (['roadmap', 'satellite', 'hybrid', 'terrain'] as const).find((t) => t === q.maptype) ?? 'roadmap';

  const zoomRaw = num(q.zoom);
  const zoom = zoomRaw === null ? undefined : Math.round(zoomRaw);
  if (zoom !== undefined && (!Number.isInteger(zoom) || zoom < 0 || zoom > MAX_ZOOM)) return null;

  /**
   * `lat,lng,isSubject` triples, semicolon-separated. A compact encoding
   * because it goes in a URL that a browser caches, and because every
   * component of it is validated below anyway.
   */
  const markers: StaticMapRequest['markers'] = [];
  for (const part of (q.pins ?? '').split(';').filter(Boolean)) {
    const [latS, lngS, subjectS] = part.split(',');
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    markers.push({ lat, lng, subject: subjectS === '1' });
    if (markers.length > MAX_MARKERS) return null;
  }
  if (markers.length === 0) return null;
  return { markers, width, height, maptype, zoom };
}

/**
 * The upstream URL, signed.
 *
 * No `center` and no `zoom` when the caller did not ask for one: given markers
 * alone Google frames them itself, which is exactly what a comparables map
 * wants — every pin in view without the caller computing a bounding box the
 * projection would then disagree with.
 */
export function googleStaticMapUrl(req: StaticMapRequest, key = KEY): string {
  const params = new URLSearchParams();
  params.set('size', `${req.width}x${req.height}`);
  // retina: the printed documents are rendered at 2x and a 1x image is visibly
  // soft in a valuation somebody signs
  params.set('scale', '2');
  params.set('maptype', req.maptype);
  params.set('format', 'png');
  if (req.zoom !== undefined) params.set('zoom', String(req.zoom));

  const subject = req.markers.filter((m) => m.subject);
  const comps = req.markers.filter((m) => !m.subject);
  /**
   * The subject reads as the destination, the comparables as evidence around it.
   *
   * These two are `brandInk` (#14503B) and the accent (#3FD894) from
   * `@apex/ui-tokens`, written out because the API does not depend on that
   * package and should not start doing so for two colours. That makes them a
   * DUPLICATE of the design tokens, which is worth saying out loud: change the
   * brand ramp and these do not follow, and the pins on a printed valuation
   * would quietly stop matching the pins everywhere else in the product.
   */
  if (subject.length) {
    params.append('markers', `color:0x14503b|label:S|${subject.map((m) => `${m.lat},${m.lng}`).join('|')}`);
  }
  if (comps.length) {
    params.append('markers', `color:0x3fd894|size:small|${comps.map((m) => `${m.lat},${m.lng}`).join('|')}`);
  }
  params.set('key', key);
  return signGoogleUrl(`/maps/api/staticmap?${params.toString()}`);
}

/** Bounded LRU, same reasoning as the tile cache: absorb N viewers of one site. */
const MAX_BYTES = 24 * 1024 * 1024;
const cache = new Map<string, { body: Buffer; type: string }>();
let bytes = 0;

function remember(key: string, body: Buffer, type: string) {
  while (bytes + body.byteLength > MAX_BYTES && cache.size) {
    const oldest = cache.keys().next().value as string;
    bytes -= cache.get(oldest)!.body.byteLength;
    cache.delete(oldest);
  }
  cache.set(key, { body, type });
  bytes += body.byteLength;
}

export function registerStaticMap(app: FastifyInstance) {
  app.get<{ Querystring: Record<string, string | undefined> }>('/staticmap', async (req, reply) => {
    /**
     * 404 rather than 500 when no key is configured, and that is load-bearing:
     * it is how the browser decides. `mapConfig` advertises the feature only
     * when a key exists, and the map component falls back to the tile map —
     * so a workspace with no Google account, the public demo, and CI all keep
     * a working map instead of an empty box.
     */
    if (!staticMapsEnabled()) return reply.code(404).send({ error: 'Static maps are not configured' });

    // the same token the tile proxy takes: "someone signed in is looking at a
    // map", which is all this needs to know and all it should learn
    if (!req.query.t || !verifyDownloadToken(req.query.t, { kind: 'tiles' })) {
      return reply.code(401).send({ error: 'Not authorised to load a map' });
    }

    const parsed = parseStaticMapRequest(req.query);
    if (!parsed) return reply.code(400).send({ error: 'Not a map request' });

    const key = JSON.stringify(parsed);
    const hit = cache.get(key);
    if (hit) {
      reply.header('content-type', hit.type);
      reply.header('cache-control', 'private, max-age=86400');
      reply.header('x-staticmap-cache', 'hit');
      return reply.send(hit.body);
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8_000);
      let res: Response;
      try {
        res = await fetch(`https://maps.googleapis.com${googleStaticMapUrl(parsed)}`, {
          headers: { accept: 'image/png,image/*' },
          signal: ctrl.signal,
          // a checked address stops being the address reached the moment a 302
          // is honoured — the same rule outbound.ts applies
          redirect: 'manual',
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        // the status, never the URL: it carries the key and the signature
        req.log.warn({ status: res.status }, 'static map upstream refused');
        return reply.code(502).send();
      }
      const body = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') ?? 'image/png';
      remember(key, body, type);
      reply.header('content-type', type);
      reply.header('cache-control', 'private, max-age=86400');
      return reply.send(body);
    } catch (err) {
      req.log.warn({ err }, 'static map upstream failed');
      return reply.code(502).send();
    }
  });
}
