import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAdmin } from '../src/admin.js';
import { prisma } from '../src/context.js';
import { registerHealth } from '../src/health.js';
import { registerPublicApi } from '../src/public-api.js';
import { registerReports } from '../src/reports.js';
import { registerTiles } from '../src/tiles.js';
import { registerStaticMap } from '../src/staticmap.js';
import { registerUploads } from '../src/uploads.js';
import { registerWebhooks } from '../src/webhooks.js';

/**
 * Every raw route the API registers is reachable THROUGH THE FRONT DOOR — in
 * production, where nginx is the door, and in development, where vite is.
 *
 * The browser never talks to the API directly. In production `apex-appraise-api`
 * is flycast-only and nginx on the web app proxies a fixed list of paths to it;
 * anything not on that list falls through to `location /`, which answers the
 * React shell with a 200. In development vite does the same job from its own
 * fixed list. Two lists, kept by hand, beside a router that grows.
 *
 * Measured on 4 September: `/staticmap` was on neither. The Static Maps feature
 * had merged that morning with a route, a signed proxy, tests for the signing
 * and tests for the fallback — and a browser that asked the public host for
 * `/staticmap?…` got `index.html` as the image. With the key set, the secret
 * set and the code deployed, the map could not work. Nothing in CI could see
 * it, because CI has no Google key and so only ever walks the tile fallback,
 * which never asks for that path. The Google path had never been driven
 * end-to-end anywhere, and the reason was two config files that a code review
 * of `staticmap.ts` had no reason to open.
 *
 * So the rule reads the routes the way `raw-route-sweep` does — a real Fastify
 * instance, the same registrars `main.ts` uses, collected through `onRoute`, so
 * a path written on the line after a generic type parameter is not missed —
 * and asks of each route's first path segment: is there an nginx `location`
 * for it, and a vite `proxy` entry for it? A new raw route that is reachable in
 * development and dead in production fails here, naming the route and the
 * file that lacks it.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const NGINX = readFileSync(join(ROOT, 'infra', 'nginx.conf.template'), 'utf8');
const VITE = readFileSync(join(ROOT, 'apps', 'web', 'vite.config.ts'), 'utf8');

async function realRoutes(): Promise<string[]> {
  const app = Fastify();
  const found: string[] = [];
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) if (method !== 'HEAD') found.push(r.url);
  });
  await registerUploads(app);
  registerReports(app);
  registerTiles(app);
  registerStaticMap(app);
  registerWebhooks(app);
  registerPublicApi(app);
  registerAdmin(app);
  registerHealth(app, prisma);
  await app.ready();
  return [...new Set(found)];
}

/** `/tiles/:z/:x/:y` → `/tiles`; `/staticmap` → `/staticmap`. */
export function segmentOf(url: string): string {
  return '/' + (url.split('/').filter(Boolean)[0] ?? '');
}

/**
 * The paths nginx has a `location` for, with their modifier stripped: a prefix
 * location (`/tiles/`, `/api/`), a `^~` prefix, or an exact `= /health`. The
 * regex location for static assets has no leading slash and is skipped — it
 * proxies nothing.
 */
export function nginxLocations(conf: string): string[] {
  return [...conf.matchAll(/^\s*location\s+(?:(?:=|\^~|~\*?)\s+)?(\/[^\s{]*)\s*\{/gm)].map((m) => m[1]!);
}

/** The keys of vite's `server.proxy` object. */
export function viteProxies(config: string): string[] {
  const block = config.match(/proxy:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  return [...block.matchAll(/'(\/[^']+)'\s*:/g)].map((m) => m[1]!);
}

/** A segment is covered by a location or proxy that IS it, or is its prefix form. */
export function covers(paths: string[], segment: string): boolean {
  return paths.some((p) => p === segment || p === `${segment}/` || p.startsWith(`${segment}/`));
}

describe('every raw API route is proxied by the front door', () => {
  it('in production (nginx) and in development (vite), by first path segment', async () => {
    const segments = [...new Set((await realRoutes()).map(segmentOf))].sort();
    const nginx = nginxLocations(NGINX);
    const vite = viteProxies(VITE);
    const missing = segments.flatMap((s) => [
      ...(covers(nginx, s) ? [] : [`${s} — no location in infra/nginx.conf.template`]),
      ...(covers(vite, s) ? [] : [`${s} — no proxy entry in apps/web/vite.config.ts`]),
    ]);
    expect(
      missing,
      `a route the browser asks the public host for will get index.html instead of the API:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  /** A sweep over an empty list passes in silence. This says it read the real things. */
  it('finds the routes and the config it is meant to be checking', async () => {
    const routes = await realRoutes();
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.map(segmentOf)).toContain('/staticmap');
    expect(routes.map(segmentOf)).toContain('/tiles');
    expect(nginxLocations(NGINX).length).toBeGreaterThan(8);
    expect(viteProxies(VITE).length).toBeGreaterThan(5);
  });
});

describe('the matchers', () => {
  it('read every nginx location form and skip the asset regex', () => {
    const conf = `
      location /trpc/ { }
      location ^~ /tiles/ { }
      location = /health { }
      location ~* \\.(png|webp)$ { }
      location / { }
    `;
    expect(nginxLocations(conf)).toEqual(['/trpc/', '/tiles/', '/health', '/']);
  });

  it('read vite proxy keys and nothing outside the proxy block', () => {
    const config = `
      server: { proxy: {
        '/trpc': { target: 'http://x' },
        // a comment naming '/nothere' is not an entry
        '/tiles': { target: 'http://x' },
      } },
      other: { '/elsewhere': 1 },
    `;
    expect(viteProxies(config)).toEqual(['/trpc', '/tiles']);
  });

  /**
   * The defect, stated as the case that failed: a segment covered in neither
   * file is named for both. And `location /` covers nothing — it is the SPA
   * fallback that answered index.html as an image, not a proxy.
   */
  it('name a segment that neither file proxies, and do not let the SPA fallback count', () => {
    expect(covers(['/trpc/', '/tiles/', '/'], '/staticmap')).toBe(false);
    expect(covers(['/trpc/', '/staticmap'], '/staticmap')).toBe(true);
    expect(covers(['/api/'], '/api')).toBe(true);
    expect(segmentOf('/tiles/:z/:x/:y')).toBe('/tiles');
    expect(segmentOf('/staticmap')).toBe('/staticmap');
  });
});
