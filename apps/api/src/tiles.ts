import type { FastifyInstance } from 'fastify';
import { verifyDownloadToken } from './download-token.js';

/**
 * Map tiles, served by this application rather than by the visitor's browser.
 *
 * Leaflet pointed straight at tile.openstreetmap.org, which meant every valuer
 * who opened a Site pack or a Comparables map handed OpenStreetMap their IP
 * address and the coordinates of the site they were looking at — on a privacy
 * notice that lists three companies and then says "Nobody else." It also put the
 * product on the wrong side of OSM's own tile usage policy in two ways:
 *
 *  - The policy requires a User-Agent that identifies the application, so the
 *    Operations Working Group can make contact about a problem. A browser sends
 *    the BROWSER's User-Agent, so there was nobody to contact.
 *  - It forbids heavy use by a distributed application without prior permission.
 *    A commercial SaaS aiming its whole user base at the public tile servers is
 *    the case that clause is about, and no amount of proxying makes it not so —
 *    see TILE_URL below, which is how an owner points this at a provider they
 *    actually pay.
 *
 * Proxying is not something OSM encourages, and this does not pretend otherwise.
 * What it does is make every axis better than the status quo: one identified
 * caller instead of thousands of anonymous ones, a cache in front of it so the
 * same tile is fetched once rather than once per viewer, and no third party
 * learning who is looking at which site.
 */

/** Where tiles come from. Point this at a paid provider for production use. */
/**
 * `||`, not `??`. docker-compose passes these through as `${TILE_URL:-}`, so an
 * operator who has not set one gets an EMPTY STRING rather than an absent
 * variable — and `??` only catches absent. The fallback below would have been
 * unreachable in the one environment that matters.
 */
const TILE_URL = process.env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const TILE_ATTRIBUTION =
  process.env.TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Who to contact about our traffic. The policy asks for something that identifies
 * the application; a contact address is the part that makes it useful, so it is
 * configurable and the default names the repository rather than inventing an
 * address nobody reads.
 */
const TILE_USER_AGENT = process.env.TILE_USER_AGENT || 'ApexAppraise/0.1 (+https://github.com/atz1man/apex-appraise)';

const MAX_ZOOM = 19;

/**
 * A bounded in-process cache.
 *
 * Deliberately memory and not the disk or the database: tiles are 5–20 KB of
 * binary, the openDataCache column is text, and the volume is for customer
 * files. The browser does the durable half — tiles come back immutable with a
 * long max-age, so a valuer revisiting a site fetches nothing at all. This layer
 * only stops N viewers of the same site becoming N requests upstream, which is
 * the part that matters to whoever is serving them.
 */
const MAX_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, { body: Buffer; type: string }>();
let bytes = 0;

function remember(key: string, body: Buffer, type: string) {
  // evict oldest-first; Map preserves insertion order, which is enough of an LRU
  // for a cache whose whole job is absorbing a burst of viewers on one postcode
  while (bytes + body.byteLength > MAX_BYTES && cache.size) {
    const oldest = cache.keys().next().value as string;
    bytes -= cache.get(oldest)!.body.byteLength;
    cache.delete(oldest);
  }
  cache.set(key, { body, type });
  bytes += body.byteLength;
}

/** Only real tile coordinates reach the upstream URL — this is a proxy, not an open relay. */
function tileCoords(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  const [zn, xn, yn] = [Number(z), Number(x), Number(y)];
  if (![zn, xn, yn].every((n) => Number.isInteger(n) && n >= 0)) return null;
  if (zn > MAX_ZOOM) return null;
  const span = 2 ** zn;
  if (xn >= span || yn >= span) return null;
  return { z: zn, x: xn, y: yn };
}

export function registerTiles(app: FastifyInstance) {
  app.get<{ Params: { z: string; x: string; y: string }; Querystring: { t?: string } }>(
    '/tiles/:z/:x/:y.png',
    async (req, reply) => {
      /**
       * Authenticated, because an open tile proxy is precisely the abuse the
       * policy above exists to prevent: anyone could point their own map at us
       * and spend OSM's bandwidth under our name.
       */
      if (!req.query.t || !verifyDownloadToken(req.query.t, { kind: 'tiles' })) {
        return reply.code(401).send({ error: 'Not authorised to load map tiles' });
      }

      const coords = tileCoords(req.params.z, req.params.x, req.params.y);
      if (!coords) return reply.code(400).send({ error: 'Not a tile' });

      const key = `${coords.z}/${coords.x}/${coords.y}`;
      const hit = cache.get(key);
      if (hit) {
        reply.header('content-type', hit.type);
        reply.header('cache-control', 'public, max-age=2592000, immutable');
        reply.header('x-tile-cache', 'hit');
        return reply.send(hit.body);
      }

      const url = TILE_URL.replace('{z}', String(coords.z)).replace('{x}', String(coords.x)).replace('{y}', String(coords.y));
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8_000);
        let res: Response;
        try {
          res = await fetch(url, { headers: { 'user-agent': TILE_USER_AGENT, accept: 'image/png,image/*' }, signal: ctrl.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          req.log.warn({ status: res.status, key }, 'tile upstream refused');
          // no body: a blank tile is what Leaflet does with a failed one anyway,
          // and inventing an image would put a picture on a valuation that no
          // mapping data supports
          return reply.code(502).send();
        }
        const body = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get('content-type') ?? 'image/png';
        remember(key, body, type);
        reply.header('content-type', type);
        reply.header('cache-control', 'public, max-age=2592000, immutable');
        reply.header('x-tile-cache', 'miss');
        return reply.send(body);
      } catch (e) {
        req.log.warn({ err: e, key }, 'tile upstream unreachable');
        return reply.code(502).send();
      }
    },
  );
}

/** Test seam: the cache is process-wide, and a test that shares one is not a test. */
export function __resetTileCache() {
  cache.clear();
  bytes = 0;
}
